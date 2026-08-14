/* Offline app shell + selective API cache */
// Bump this when cache rules change so a previously cached protected response
// is deleted during activation.
const CACHE_VERSION = 'v7'
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

  // 1. Navigation / HTML requests: Network-first to always fetch latest app version
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/'))),
    )
    return
  }

  // 2. Network-first for safe *public* song reads only. The offline pack is a
  // protected entitlement endpoint, so it must never be stored in Cache
  // Storage or be available after a Pass expires.
  const isProtectedOfflinePack = url.pathname === '/api/songs/offline-pack/'
  if (
    url.pathname.startsWith('/api/songs/') &&
    !url.pathname.includes('upload-csv') &&
    !isProtectedOfflinePack
  ) {
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

  // 3. Same-origin assets: Network-first with cache fallback for instant updates
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => caches.match(request)),
    )
  }
})
