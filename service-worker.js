/*
  Pescar.ro PWA service worker
  Strategie gandita ca sa NU fie nevoie sa schimbi manual versiunea cache-ului
  atunci cand editezi index.html.

  - Pagina/app shell: NETWORK FIRST -> primesti versiunea noua cand exista internet.
  - Fisiere statice: STALE WHILE REVALIDATE -> se afiseaza rapid, apoi se actualizeaza in fundal.
  - Supabase/API: nu este cache-uit de service worker.
  - Offline: revine la ultima versiune salvata a index.html.
*/

const CACHE_NAME = 'pescar-ro-auto-cache-v2';
const OFFLINE_URL = './index.html';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/logo-loading.webp',
  './assets/logo-header.webp'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Cache best-effort: un singur asset lipsa nu trebuie sa blocheze instalarea SW-ului.
    await Promise.allSettled(
      APP_SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })))
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('pescar-ro-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nu intervenim peste requesturile externe sau Supabase.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/rest/v1/') || url.pathname.includes('/storage/v1/')) return;

  // Navigarea si index.html: mereu incearca intai reteaua.
  // Astfel, cand editezi index.html si il urci pe hosting, utilizatorul primeste versiunea noua
  // la urmatoarea deschidere/reincarcare, fara sa schimbi manual CACHE_NAME.
  if (
    request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Manifestul trebuie de asemenea verificat intai online daca il modifici vreodata.
  if (url.pathname.endsWith('/manifest.json')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Imagini/CSS/JS locale: raspuns rapid din cache, cu refresh in fundal.
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const freshRequest = new Request(request, { cache: 'no-store' });
    const response = await fetch(freshRequest);

    if (response && response.ok) {
      await cache.put(request, response.clone());

      // Pastreaza si o copie standard a indexului pentru fallback offline.
      if (request.mode === 'navigate') {
        await cache.put(OFFLINE_URL, response.clone());
      }
    }

    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response(
      '<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pescar.ro</title><body><h2>Nu exista conexiune la internet</h2><p>Reconecteaza-te si incearca din nou.</p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(new Request(request, { cache: 'no-store' }))
    .then(async response => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Lasa actualizarea sa continue chiar daca returnam imediat cache-ul.
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;

  return new Response('', { status: 504, statusText: 'Offline' });
}
