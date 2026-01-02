// MedCheck Service Worker v2.0
// Network-first strategy for active development + PWA support

// Auto-versioning: includes date for cache-busting on deploy
const VERSION = '20260102';
const CACHE_NAME = `medcheck-${VERSION}`;

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
    console.log('[SW] Installing version:', VERSION);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting()) // Activate immediately
    );
});

// Activate event - clean ALL old caches aggressively
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating version:', VERSION);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('[SW] Claiming all clients');
            return self.clients.claim(); // Take control immediately
        })
    );
});

// Fetch event - NETWORK-FIRST strategy (best for active development)
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip CIMA API calls - always fresh, never cache
    if (url.origin.includes('cima.aemps.es') || url.hostname.includes('corsproxy')) {
        return;
    }

    // NETWORK-FIRST: Try network, fallback to cache for offline
    event.respondWith(
        fetch(request)
            .then((response) => {
                // Got network response - update cache and return
                if (response.ok && url.origin === self.location.origin) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, clone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Network failed - try cache (offline mode)
                console.log('[SW] Network failed, trying cache for:', request.url);
                return caches.match(request).then((cached) => {
                    if (cached) {
                        console.log('[SW] Serving from cache:', request.url);
                        return cached;
                    }
                    // Nothing in cache - return offline page or error
                    return new Response('Offline - contenido no disponible', {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                });
            })
    );
});

// Listen for messages from main thread (for manual cache invalidation)
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
    if (event.data === 'clearCache') {
        caches.keys().then((names) => {
            names.forEach((name) => caches.delete(name));
        });
    }
});
