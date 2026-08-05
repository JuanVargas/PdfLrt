const CACHE_NAME = 'pdflrt-cache-v10';

const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/worker.js',
  '/transformers.min.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/wasm/tasks-genai.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened static assets PWA cache for PdfLrt');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  // Ignore non-http/https schemes
  if (!event.request.url.startsWith('http')) return;
  // Bypass backend API calls (important: never cache POST API calls or syncs!)
  if (event.request.url.includes('/api/')) return;
  // Bypass model directories (never intercept or try to cache massive models!)
  if (event.request.url.includes('/models/')) return;
  // Bypass raw database directory (loaded dynamically in memory)
  if (event.request.url.includes('/PdfDir/')) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then(response => {
        // Return static cache hit if found
        if (response) {
          return response;
        }
        
        // Fetch from network otherwise
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200) {
            return response;
          }

          // Dynamically cache other GET assets (like fonts, scripts, TFLite/LiteRT model tasks)
          var responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            if (event.request.method === "GET") {
              cache.put(event.request, responseToCache).catch(err => {
                console.warn('PWA dynamic cache error:', err);
              });
            }
          });

          return response;
        }).catch(err => {
          console.error('Offline fetch failure:', event.request.url, err);
          // If HTML navigation request failed, fall back to index
          if (event.request.mode === 'navigate') {
            return caches.match('/', { ignoreSearch: true });
          }
          return Response.error();
        });
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    Promise.all([
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
      self.clients.claim()
    ])
  );
});
