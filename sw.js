// Prana-Prompter Service Worker — Offline Cache
const CACHE_NAME = 'prana-prompter-v0.1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/styles/dark.css',
  '/styles/light.css',
  '/scripts/session.js',
  '/scripts/app.js',
  '/manifest.json',
];

// Install: cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for assets, network-first for sessions
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Session JSON files: network-first (they change)
  if (url.pathname.startsWith('/sessions/')) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return resp;
      });
    })
  );
});
