/* Blackjack Trainer service worker.
 *
 * Deliberately minimal: one versioned cache, network-first for navigations
 * (so a deploy is picked up immediately when online), cache-first for static
 * assets (which Vite content-hashes, so a hit is always correct). Same-origin
 * GET only — never touches cross-origin or mutating requests.
 *
 * Bump CACHE_VERSION to invalidate everything on the next activation.
 */

const CACHE_VERSION = 'v1'
const CACHE_NAME = `bjt-${CACHE_VERSION}`
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        /* a missing shell entry must not block installation */
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

function cachePut(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return
  const copy = response.clone()
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Navigations: network first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cachePut(request, response)
          return response
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match('./index.html'))
            .then((hit) => hit || Response.error()),
        ),
    )
    return
  }

  // Static assets: cache first, populate on miss.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          cachePut(request, response)
          return response
        }),
    ),
  )
})
