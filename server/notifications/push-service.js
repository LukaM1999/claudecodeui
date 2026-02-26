import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import webpush from 'web-push';
import { pushSubscriptionsDb } from '../database/db.js';

const CLOUDCLI_DIR = path.join(os.homedir(), '.cloudcli');
const VAPID_KEYS_PATH = path.join(CLOUDCLI_DIR, 'webpush-vapid.json');
const VAPID_SUBJECT = process.env.PUSH_VAPID_SUBJECT || 'mailto:cloudcli@localhost';
const NOTIFICATION_DEDUPE_WINDOW_MS = 10_000;

let vapidInitPromise = null;
const notificationDedupMap = new Map();

function pruneNotificationDedupMap() {
  const now = Date.now();
  for (const [key, timestamp] of notificationDedupMap.entries()) {
    if (now - timestamp > NOTIFICATION_DEDUPE_WINDOW_MS) {
      notificationDedupMap.delete(key);
    }
  }
}

function shouldSkipDuplicateNotification(userId, payload = {}) {
  pruneNotificationDedupMap();
  const dedupeKey = [
    userId,
    payload.eventType || 'unknown',
    payload.provider || 'unknown',
    payload.sessionId || 'none',
    payload.body || '',
  ].join('|');

  if (notificationDedupMap.has(dedupeKey)) {
    return true;
  }

  notificationDedupMap.set(dedupeKey, Date.now());
  return false;
}

async function readVapidKeysFromDisk() {
  try {
    const raw = await fs.readFile(VAPID_KEYS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.publicKey && parsed?.privateKey) {
      return {
        publicKey: parsed.publicKey,
        privateKey: parsed.privateKey,
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[PUSH] Failed to read VAPID keys file:', error.message);
    }
  }
  return null;
}

async function writeVapidKeysToDisk(keys) {
  await fs.mkdir(CLOUDCLI_DIR, { recursive: true });
  await fs.writeFile(
    VAPID_KEYS_PATH,
    JSON.stringify(
      {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function ensureWebPushConfigured() {
  if (!vapidInitPromise) {
    vapidInitPromise = (async () => {
      let vapidKeys = null;

      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        vapidKeys = {
          publicKey: process.env.VAPID_PUBLIC_KEY,
          privateKey: process.env.VAPID_PRIVATE_KEY,
        };
      } else {
        vapidKeys = await readVapidKeysFromDisk();
        if (!vapidKeys) {
          vapidKeys = webpush.generateVAPIDKeys();
          await writeVapidKeysToDisk(vapidKeys);
          console.log('[PUSH] Generated VAPID keys at', VAPID_KEYS_PATH);
        }
      }

      webpush.setVapidDetails(VAPID_SUBJECT, vapidKeys.publicKey, vapidKeys.privateKey);
      return vapidKeys;
    })().catch((error) => {
      vapidInitPromise = null;
      throw error;
    });
  }

  return vapidInitPromise;
}

export async function getWebPushPublicKey() {
  const keys = await ensureWebPushConfigured();
  return keys.publicKey;
}

export async function upsertPushSubscription(userId, subscription, metadata = {}) {
  await ensureWebPushConfigured();
  return pushSubscriptionsDb.upsertSubscription(userId, subscription, metadata);
}

export function removePushSubscription(userId, endpoint) {
  return pushSubscriptionsDb.deleteSubscriptionByEndpoint(userId, endpoint);
}

export async function sendPushNotificationToUser(userId, payload) {
  await ensureWebPushConfigured();

  if (!userId) {
    return { delivered: 0, total: 0 };
  }

  if (shouldSkipDuplicateNotification(userId, payload)) {
    return { delivered: 0, total: 0, skipped: true };
  }

  const subscriptions = pushSubscriptionsDb.getActiveSubscriptions(userId);
  if (!subscriptions.length) {
    return { delivered: 0, total: 0 };
  }

  const body = JSON.stringify(payload || {});
  let delivered = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        body,
      );
      delivered += 1;
      pushSubscriptionsDb.markDeliverySuccess(subscription.id);
    } catch (error) {
      pushSubscriptionsDb.markDeliveryError(subscription.id, error?.message || 'Push delivery failed');

      // Subscription is no longer valid. Clean it up.
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        pushSubscriptionsDb.deleteSubscriptionById(subscription.id);
      }
    }
  }

  return { delivered, total: subscriptions.length };
}

