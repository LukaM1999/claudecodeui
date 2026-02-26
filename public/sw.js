// Service Worker for CloudCLI UI PWA + Web Push notifications
const CACHE_NAME = 'cloudcli-ui-v2';
const URLS_TO_CACHE = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request);
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'CloudCLI notification';
  const body = payload.body || '';
  const targetUrl = payload.url || '/';
  const tag = `cloudcli-${payload.eventType || 'event'}-${payload.sessionId || 'none'}`;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag,
      renotify: true,
      data: {
        url: targetUrl,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const sameOrigin = client.url.startsWith(self.location.origin);
        if (!sameOrigin) {
          continue;
        }

        if ('focus' in client) {
          client.focus();
        }

        if ('navigate' in client) {
          return client.navigate(targetUrl);
        }

        return Promise.resolve();
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return Promise.resolve();
    }),
  );
});

