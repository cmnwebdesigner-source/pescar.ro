const CACHE_NAME = 'pescar-ro-v1.4.0';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-1024.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/favicon-64.png',
  './assets/logo-loading.webp',
  './assets/logo-header.webp'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );

  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
  );

  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/storage/v1/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();

          caches
            .open(CACHE_NAME)
            .then(cache => cache.put('./index.html', clone));

          return response;
        })
        .catch(() => caches.match('./index.html'))
    );

    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const networkPromise = fetch(request)
        .then(response => {
          const clone = response.clone();

          caches
            .open(CACHE_NAME)
            .then(cache => cache.put(request, clone));

          return response;
        })
        .catch(() => cached);

      return cached || networkPromise;
    })
  );
});
