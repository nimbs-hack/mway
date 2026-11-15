import { CTX_LATITUDE_LIMIT, CTX_MAX_LEVEL, ctxTileUrl } from '../data/ctx'

export function registerMapCache() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}map-cache.js`).catch((error) => {
      console.warn('Map cache unavailable', error)
    })
  }
}

// Planetocentric latitude, east-positive longitude in [-180, 180].
export function siteTileUrls(lon, lat, source = 'v01') {
  const urls = new Set()
  if (Math.abs(lat) > CTX_LATITUDE_LIMIT) return []
  for (let z = 8; z <= CTX_MAX_LEVEL; z++) {
    const rows = 2 ** z
    const cols = rows * 2
    const x = Math.floor(((lon + 180) / 360) * cols)
    const y = Math.min(rows - 1, Math.max(0, Math.floor(((90 - lat) / 180) * rows)))
    for (let dy = -1; dy <= 1; dy++) {
      if (y + dy < 0 || y + dy >= rows) continue
      for (let dx = -1; dx <= 1; dx++) {
        urls.add(ctxTileUrl(z, y + dy, (x + dx + cols) % cols, source))
      }
    }
  }
  return [...urls]
}

// One background request at a time, only after visible tiles have settled.
export function warmSiteImagery(viewer, site, source) {
  if (!navigator.serviceWorker?.controller || navigator.connection?.saveData) return () => {}
  const controller = new AbortController()
  const [lat, lon] = site.traverse?.position ?? [site.lat, site.lon]
  const urls = siteTileUrls(lon, lat, source)
  let timer
  const next = async () => {
    if (controller.signal.aborted || viewer.isDestroyed()) return
    if (viewer.scene.globe.tilesLoaded) {
      const url = urls.shift()
      if (!url) return
      await fetch(url, { signal: controller.signal, priority: 'low' }).catch(() => {})
    }
    if (!controller.signal.aborted) timer = setTimeout(next, 500)
  }
  timer = setTimeout(next, 1500)
  return () => {
    clearTimeout(timer)
    controller.abort()
  }
}
