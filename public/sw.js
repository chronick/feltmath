/* Feltmath service worker.
 *
 * Network-first for navigations (so a deploy is picked up immediately when
 * online), cache-first for content-hashed static assets. The Vite build
 * manifest lets installation cache entry points and lazy chunks before the
 * app is expected to work offline. Same-origin GET only.
 *
 * The production build replaces CACHE_VERSION with a hash of Vite's manifest,
 * so a changed bundle automatically installs a fresh cache.
 */

// Replaced with a manifest hash by the production build. Keeping the template
// value valid JavaScript also makes this file easy to lint directly.
const CACHE_VERSION = '__FELTMATH_BUILD_VERSION__'
const CACHE_NAME = `feltmath-${CACHE_VERSION}`
const BUILD_ASSETS = /*__FELTMATH_BUILD_ASSETS__*/ []
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
]

async function cacheResource(cache, url) {
  const response = await fetch(url, { cache: 'reload' })
  if (!response.ok) throw new Error(`Unable to precache ${url}: ${response.status}`)
  await cache.put(url, response)
}

async function precache() {
  const cache = await caches.open(CACHE_NAME)
  await Promise.all([...APP_SHELL, ...BUILD_ASSETS].map((url) => cacheResource(cache, url)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
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
