// MedCheck Service Worker v1.0
// Provides offline caching for PWA functionality

const CACHE_NAME = 'medcheck-v1';
const STATIC_ASSETS = [
    '/medcheck.html',
    '/assets/css/cima-app.css',
    '/assets/js/cima-api.js',
    '/assets/js/cima-app.js',
    '/assets/icons/medcheck-icon-192.png',
    '/assets/icons/medcheck-icon-512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests and API calls (CIMA API should always be fresh)
    if (request.method !== 'GET' || url.origin.includes('cima.aemps.es')) {
        return;
    }

    // For static assets, use cache-first strategy
    if (STATIC_ASSETS.some(asset => url.pathname.endsWith(asset.replace('/', '')))) {
        event.respondWith(
            caches.match(request).then((cached) => {
                return cached || fetch(request).then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // For other requests, network first with cache fallback
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok && request.url.startsWith(self.location.origin)) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});
