import { useEffect } from 'react';
import { authenticatedFetch } from '../utils/api';

const PUSH_PROMPT_STORAGE_KEY = 'cloudcli_push_permission_prompted_v1';

function base64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const safeBase64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(safeBase64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export function usePushNotifications() {
  useEffect(() => {
    let isCancelled = false;

    const setupPushNotifications = async () => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        return;
      }

      if (Notification.permission === 'default') {
        const wasPrompted = localStorage.getItem(PUSH_PROMPT_STORAGE_KEY) === '1';
        if (!wasPrompted) {
          localStorage.setItem(PUSH_PROMPT_STORAGE_KEY, '1');
          try {
            await Notification.requestPermission();
          } catch (error) {
            console.warn('Failed to request notification permission:', error);
          }
        }
      }

      if (Notification.permission !== 'granted') {
        return;
      }

      try {
        const publicKeyResponse = await authenticatedFetch('/api/notifications/public-key');
        if (!publicKeyResponse.ok) {
          return;
        }

        const keyPayload = await publicKeyResponse.json();
        const publicKey = keyPayload?.publicKey;
        if (!publicKey) {
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        if (isCancelled) {
          return;
        }

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64ToUint8Array(publicKey),
          });
        }

        if (!subscription) {
          return;
        }

        const rawSubscription = subscription.toJSON();
        await authenticatedFetch('/api/notifications/subscriptions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subscription: rawSubscription,
            device: {
              userAgent: navigator.userAgent,
              platform: navigator.platform || 'unknown',
            },
          }),
        });
      } catch (error) {
        console.warn('Push notification setup failed:', error);
      }
    };

    setupPushNotifications();

    return () => {
      isCancelled = true;
    };
  }, []);
}

