// Service Worker for handling push notifications
// This service worker runs in the background to handle notifications even when the browser is closed

const CACHE_NAME = 'shikumika-v2';
const urlsToCache = [];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Fetch event - this worker is for notifications; keep app/assets network-first
// so a deploy cannot be hidden behind stale service-worker cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'SHOW_NOTIFICATION') {
    event.waitUntil(
      self.registration.showNotification(event.data.title || 'Shikumika', event.data.options || {})
    );
  }
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  try {
    const data = event.data.json();

    const options = {
      body: data.body || '',
      icon: data.icon || '/icon-192x192.png',
      badge: data.badge || '/badge-72x72.png',
      image: data.image,
      data: {
        url: data.actionUrl || '/',
        notificationId: data.notificationId,
      },
      requireInteraction: false,
      silent: data.silent || false,
      tag: data.tag || 'default',
      timestamp: data.timestamp ? Date.parse(data.timestamp) : Date.now(),
    };

    // Add vibration if supported
    if ('vibrate' in options) {
      options.vibrate = [200, 100, 200];
    }

    event.waitUntil(
      self.registration.showNotification(data.title || 'Shikumika', options)
    );
  } catch (error) {
    console.error('Error handling push event:', error);

    // Fallback for simple text messages
    event.waitUntil(
      self.registration.showNotification('Shikumika', {
        body: event.data.text(),
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
      })
    );
  }
});

// Notification click event - handle user clicking on notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window' })
      .then((clientList) => {
        // Check if a window with the target URL is already open
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }

        // If no window is open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Notification close event - handle user dismissing notification
self.addEventListener('notificationclose', (event) => {
  // Track if notification was dismissed without action
  console.log('Notification closed:', event.notification.tag);
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
