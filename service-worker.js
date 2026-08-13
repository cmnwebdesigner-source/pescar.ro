/* Pescar.ro — Service Worker v1.4.0
   Fișierul trebuie să se numească exact "service-worker.js" și să stea în rădăcina aplicației,
   pentru că index.html îl înregistrează cu navigator.serviceWorker.register('./service-worker.js'). */

const CACHE_NAME = 'pescar-ro-v1.4.0';
const OFFLINE_URL = './index.html';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-1024.png',
  './assets/icon-maskable-512.png',
  './assets/icon-maskable-1024.png',
  './assets/apple-touch-icon.png',
  './assets/favicon-64.png',
  './assets/logo-loading.webp',
  './assets/logo-header.webp'
];

/* Instalare tolerantă la erori: un singur asset lipsă (404) nu mai împiedică
   instalarea service worker-ului, cum se întâmpla cu cache.addAll(). */
async function precache() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(
    APP_SHELL.map(async url => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (error) {
        console.warn('[SW] Asset lipsă, ignorat la precache:', url);
      }
    })
  );
}

self.addEventListener('install', event => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );

      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable();
        } catch (error) {
          /* opțional, ignorăm */
        }
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  let url;

  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  /* Niciodată nu punem în cache apelurile către Supabase (API/Storage). */
  if (
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/storage/v1/')
  ) {
    return;
  }

  /* Navigări: network-first, cu shell offline ca rezervă.
     Punem în cache DOAR răspunsurile valide (altfel o pagină 404/500 otrăvea shell-ul). */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);

          if (response && response.ok) {
            const clone = response.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(OFFLINE_URL, clone);
          }

          return response;
        } catch (error) {
          const cached = await caches.match(OFFLINE_URL);

          return (
            cached ||
            new Response(
              '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
                '<body style="font-family:system-ui;padding:24px">' +
                '<h1>Ești offline</h1><p>Reconectează-te pentru a folosi Pescar.ro.</p></body>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
          );
        }
      })()
    );

    return;
  }

  /* Restul resurselor: stale-while-revalidate, dar cu răspuns garantat
     (varianta anterioară putea ajunge la respondWith(undefined) și arunca eroare). */
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then(async response => {
          if (response && response.ok && response.type !== 'opaque') {
            await cache.put(request, response.clone());
          }

          return response;
        })
        .catch(() => null);

      if (cached) {
        network.catch(() => null);
        return cached;
      }

      const fresh = await network;

      return (
        fresh ||
        new Response('', { status: 504, statusText: 'Offline și fără cache' })
      );
    })()
  );
});
