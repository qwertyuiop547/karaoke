/* Offline app shell + selective API cache */
const CACHE_VERSION = 'v4'
const SHELL_CACHE = `platino-shell-${CACHE_VERSION}`
const API_CACHE = `platino-api-${CACHE_VERSION}`
const APP_SHELL = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/pwa-192.png',
  '/pwa-512.png',
  '/pwa-192.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Network-first for safe public song reads only (not auth/admin/mutations)
  if (url.pathname.startsWith('/api/songs/') && !url.pathname.includes('upload-csv')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(API_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => caches.match(request)),
    )
    return
  }

  /* Do not cache other API routes (auth/billing/presence) — needed for live connectivity probes */
  if (url.pathname.startsWith('/api/')) {
    return
  }

  // Cache-first for same-origin assets (JS/CSS/fonts after first online visit)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          })
          .catch(() => cached)
        return cached || fetched
      }),
    )
  }
})
