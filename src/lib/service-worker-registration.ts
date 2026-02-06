/**
 * Service Worker Registration
 * Register the service worker for handling background notifications
 */

export function register() {
  if (typeof window === 'undefined') {
    return;
  }

  if (typeof window.navigator.serviceWorker === 'undefined') {
    console.warn('Service Workers are not supported in this browser');
    return;
  }

  // Check if we're in development and if HTTPS
  if (process.env.NODE_ENV === 'development' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    console.warn('Service Workers are only served over HTTPS (or localhost)');
    return;
  }

  window.addEventListener('load', () => {
    const swUrl = '/service-worker.js';

    window.navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log('Service Worker registered successfully:', registration);

        // Check for updates periodically
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New service worker is available
                console.log('New Service Worker available');
              }
            });
          }
        });

        // Poll for service worker updates (every hour)
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
  });
}

export function unregister() {
  if (typeof window === 'undefined') {
    return;
  }

  if (typeof window.navigator.serviceWorker === 'undefined') {
    return;
  }

  window.navigator.serviceWorker.ready
    .then((registration) => {
      registration.unregister();
    })
    .catch((error) => {
      console.error(error.message);
    });
}

/**
 * Request notification permission and subscribe to push notifications
 */
export async function subscribeToNotifications() {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    throw new Error('Notifications are not supported');
  }

  const permission = await window.Notification.requestPermission();

  if (permission !== 'granted') {
    throw new Error('Notification permission not granted');
  }

  // Register service worker and subscribe to push
  const registration = await window.navigator.serviceWorker.ready;

  // Note: This is for local notifications only
  // For actual push notifications, you would need to:
  // 1. Set up VAPID keys on your server
  // 2. Use PushManager.subscribe() to get a push subscription
  // 3. Send the subscription to your server

  return {
    permission,
    serviceWorkerRegistration: registration,
  };
}

/**
 * Send a local notification (without server-side push)
 */
export async function sendLocalNotification(title: string, options: NotificationOptions = {}) {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return;
  }

  if (window.Notification.permission === 'granted') {
    // If service worker is active, use it for better reliability
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      // Service worker will handle the notification
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_NOTIFICATION',
        title,
        options,
      });
    } else {
      // Fallback to regular notification
      new Notification(title, options);
    }
  }
}
