import express from 'express';
import {
  getWebPushPublicKey,
  upsertPushSubscription,
  removePushSubscription,
  sendPushNotificationToUser,
} from '../notifications/push-service.js';

const router = express.Router();

router.get('/public-key', async (req, res) => {
  try {
    const publicKey = await getWebPushPublicKey();
    res.json({ success: true, publicKey });
  } catch (error) {
    console.error('[PUSH] Failed to fetch VAPID public key:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch public key' });
  }
});

router.post('/subscriptions', async (req, res) => {
  try {
    const userId = req.user?.id;
    const subscription = req.body?.subscription || req.body;
    const device = req.body?.device || {};

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ success: false, error: 'Invalid push subscription' });
    }

    await upsertPushSubscription(userId, subscription, {
      userAgent: device.userAgent || req.headers['user-agent'] || null,
      platform: device.platform || null,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[PUSH] Failed to save push subscription:', error);
    res.status(500).json({ success: false, error: 'Failed to save subscription' });
  }
});

router.delete('/subscriptions', async (req, res) => {
  try {
    const userId = req.user?.id;
    const endpoint = req.body?.endpoint;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ success: false, error: 'Endpoint is required' });
    }

    const deleted = removePushSubscription(userId, endpoint);
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('[PUSH] Failed to remove push subscription:', error);
    res.status(500).json({ success: false, error: 'Failed to remove subscription' });
  }
});

router.post('/test', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const result = await sendPushNotificationToUser(userId, {
      title: 'CloudCLI push test',
      body: 'Push notifications are configured.',
      eventType: 'test_notification',
      provider: 'codex',
      sessionId: null,
      url: '/',
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[PUSH] Failed to send test push notification:', error);
    res.status(500).json({ success: false, error: 'Failed to send test notification' });
  }
});

export default router;

