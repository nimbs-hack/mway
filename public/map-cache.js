// Only immutable map products belong here. App code and layer metadata stay fresh.
const CACHE = 'mars-map-tiles-v1'
const MAX_TILES = 2048
const pending = new Map()
let writes = Promise.resolve()
let entries

function isTile(url) {
  return (url.origin === self.location.origin &&
    (/^\/api\/science\/(themis-day|themis-night|mola-color|tes-albedo|mola-roughness)\/\d+\/\d+\/\d+\.png$/.test(url.pathname) ||
     /^\/api\/imagery\/ctx-v01\/\d+\/\d+\/\d+\.png$/.test(url.pathname) ||
     /^\/api\/imagery\/viking\/\d+\/\d+\/\d+\.jpg$/.test(url.pathname) ||
     /^\/api\/terrain\/mars-v14\/\d+\/\d+\/\d+\.terrain$/.test(url.pathname))) ||
    (url.origin === 'https://trek.nasa.gov' &&
    /^\/tiles\/Mars\/EQ\/.+\/\d+\/\d+\/\d+\.(png|jpg)$/.test(url.pathname)) ||
    (url.origin === 'https://marshub.s3.amazonaws.com' &&
    /^\/mars_v14\/\d+\/\d+\/\d+\.terrain$/.test(url.pathname))
}

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

async function load(request, event) {
  // Images and our terrain proxy have one representation. Prefetch and image
  // element Accept headers must share it. Direct terrain can vary extensions.
  const accept = new URL(request.url).origin === 'https://marshub.s3.amazonaws.com'
    ? request.headers.get('accept') || '' : ''
  const key = `${request.url}|${accept}`
  const cacheUrl = new URL(request.url)
  cacheUrl.searchParams.set('__mars_accept', accept)
  const cacheKey = new Request(cacheUrl)
  if (pending.has(key)) return (await pending.get(key)).clone()
  let persisted = Promise.resolve()
  const job = (async () => {
    const cache = await caches.open(CACHE).catch(() => null)
    const cached = await cache?.match(cacheKey).catch(() => null)
    if (cached) return cached
    const response = await fetch(request)
    const type = response.headers.get('content-type') || ''
    if (cache && response.ok && !type.includes('text/html') && response.type !== 'opaque') {
      const copy = response.clone()
      // Serialize writes so concurrent responses cannot exceed the cache limit.
      writes = writes.then(async () => {
        // Index once per worker lifetime, not once for every arriving tile.
        entries ??= new Map((await cache.keys()).map((entry) => [entry.url, entry]))
        await cache.put(cacheKey, copy)
        entries.delete(cacheKey.url)
        entries.set(cacheKey.url, cacheKey)
        for (const [url, old] of entries) {
          if (entries.size <= MAX_TILES) break
          await cache.delete(old)
          entries.delete(url)
        }
      }).catch(() => { entries = undefined })
      persisted = writes
      event.waitUntil(persisted)
    }
    return response
  })()
  pending.set(key, job)
  try {
    return (await job).clone()
  } finally {
    // Keep coalescing until persistence finishes, without delaying the image.
    event.waitUntil(persisted.finally(() => pending.delete(key)))
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method === 'GET' && isTile(new URL(event.request.url))) {
    event.respondWith(load(event.request, event))
  }
})
