// MedCheck Service Worker v2.0
// Network-first strategy for active development + PWA support

// Auto-versioning: includes date for cache-busting on deploy
const VERSION = '20260401a';
const CACHE_NAME = `medcheck-${VERSION}`;

// Install event — sin precache: NETWORK-FIRST ya cachea dinámicamente.
// Precachear sin query string (?v=...) crearía entradas que nunca coinciden
// con las URLs versionadas que pide el HTML.
self.addEventListener('install', (event) => {
    console.log('[SW] Installing version:', VERSION);
    event.waitUntil(self.skipWaiting());
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

    // Skip API calls - always fresh, never cache
    // Includes CIMA direct, CORS proxy, and our Cloudflare Worker (analytics must reach it)
    if (url.origin.includes('cima.aemps.es') || url.hostname.includes('corsproxy') || url.hostname.includes('workers.dev')) {
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
                return caches.match(request, { ignoreSearch: true }).then((cached) => {
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
