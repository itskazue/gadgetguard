const CACHE_NAME = 'gadgetguard-v2';
const STATIC_ASSETS = [
  '/',
  '/student/',
  '/osa/',
  '/css/style.css',
  '/css/public.css',
  '/student/student.css',
  '/osa/osa.css',
  '/js/api.js',
  '/js/scanner.js',
  '/student/student.js',
  '/osa/osa.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pre-caching assets in service worker:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass-through API and non-GET requests to network
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
