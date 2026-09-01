// CACHE_NAME below is rewritten at build time by scripts/stamp-sw.js --
// see that file and "How the service worker works" in README.md for why.
const CACHE_NAME = 'pipeline-cache-v2'
const CORE_ASSETS = ['/', '/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  )
  self.clients.claim()
})

// Network-first for navigation/API calls, cache-first for static assets.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  // Never cache Supabase API calls — always go to network.
  if (request.url.includes('supabase.co')) return

  // Page navigations (the app shell, index.html) — always try the network
  // first. A cached shell can point at JS/CSS chunk filenames from a
  // previous build that no longer exist once a new one's deployed, which
  // is exactly what caused a stale/blank app after a redeploy until
  // reloading a second time. Only fall back to the cached shell when
  // genuinely offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    )
    return
  }

  // Everything else (hashed JS/CSS/images) — cache-first, revalidating in
  // the background. Safe here because Vite fingerprints these filenames
  // by content, so a URL that's still referenced by the current shell is
  // never stale under a different name.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => cached)
      return cached || networkFetch
    })
  )
})
