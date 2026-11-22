const SHELL_CACHE = 'marchland-shell-v3';
const ASSET_CACHE = 'marchland-assets-v3';

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // 1. HTML navigation requests: network-first so updates arrive immediately when online,
  //    falling back to cached index.html (ignoring ?q=minimal / ?lang=pl query params) when offline.
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() =>
          caches
            .open(SHELL_CACHE)
            .then((cache) =>
              cache
                .match('./index.html', { ignoreSearch: true })
                .then((hit) => hit || cache.match('./', { ignoreSearch: true })),
            ),
        ),
    );
    return;
  }

  // 2. offline-manifest.json: network-first with shell-cache fallback so offline readiness check works offline.
  if (url.pathname.endsWith('/offline-manifest.json')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match(event.request))),
    );
    return;
  }

  // 3. Game assets (/assets/): cache-first from ASSET_CACHE, direct network pass-through on miss.
  //    Critically: NEVER calls response.clone() or cache.put() during fetch so iPadOS Safari boot
  //    never stalls on concurrent ReadableStream cloning; ASSET_CACHE is populated sequentially
  //    post-boot by src/ui/offlineCache.ts!
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches
        .open(ASSET_CACHE)
        .then((cache) => cache.match(event.request))
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  // 4. Other same-origin static files (manifest, icons): cache-first with network fallback.
  event.respondWith(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            cache.put(event.request, copy).catch(() => undefined);
          }
          return response;
        });
      }),
    ),
  );
});
