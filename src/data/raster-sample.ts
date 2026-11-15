import type { LatLon } from './geo'
import type { ScienceRaster } from './science-types'

// Reads pixels from the science overlay tiles the map already draws. The
// overlays are rendered images, not calibrated data, so a sample is a
// relative position on the layer's legend from 0 (low end) to 1 (high end),
// or null where the tile has no data. Never present it as a physical value.

export type Pixels = { width: number; height: number; data: Uint8ClampedArray }
export type TileLoader = (url: string) => Promise<Pixels | null>

// Tiles use a north-origin geographic grid with 2^(z+1) columns and 2^z rows.
export function tileFor([lat, lon]: LatLon, level: number, size: number) {
  const cols = 2 ** (level + 1)
  const rows = 2 ** level
  const fx = ((((lon + 180) % 360) + 360) % 360) / 360 * cols
  const fy = Math.min(rows - 1e-9, Math.max(0, (90 - lat) / 180 * rows))
  const x = Math.min(cols - 1, Math.floor(fx))
  const y = Math.floor(fy)
  return { x, y, px: Math.min(size - 1, Math.floor((fx - x) * size)), py: Math.min(size - 1, Math.floor((fy - y) * size)) }
}

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Position of a color on a multi-stop legend, by projecting onto the
// nearest segment between two stops.
export function rampPosition(rgb: number[], stops: string[]) {
  const colors = stops.map(hexToRgb)
  let best = { distance: Infinity, t: 0 }
  for (let i = 0; i < colors.length - 1; i++) {
    const a = colors[i]
    const b = colors[i + 1]
    const ab = a.map((v, k) => b[k] - v)
    const length = ab.reduce((sum, v) => sum + v * v, 0) || 1
    const t = Math.min(1, Math.max(0, ab.reduce((sum, v, k) => sum + v * (rgb[k] - a[k]), 0) / length))
    const distance = a.reduce((sum, v, k) => sum + (v + ab[k] * t - rgb[k]) ** 2, 0)
    if (distance < best.distance) best = { distance, t: (i + t) / (colors.length - 1) }
  }
  return best.t
}

export function pixelValue(pixels: Pixels, px: number, py: number, stops: string[]) {
  const i = (py * pixels.width + px) * 4
  const [r, g, b, a] = pixels.data.slice(i, i + 4)
  if (a < 128) return null
  if (stops.length > 2) return rampPosition([r, g, b], stops)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// Downloads and decodes one tile, with no cache. Null when it is missing.
export const fetchTile: TileLoader = (url) => fetch(url)
  .then((response) => (response.ok ? response.blob() : null))
  .then((blob) => (blob ? createImageBitmap(blob) : null))
  .then((bitmap) => {
    if (!bitmap) return null
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(bitmap, 0, 0)
      const { width, height, data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      return { width, height, data }
    } finally {
      bitmap.close()
    }
  })
  .catch(() => null)

const cache = new Map<string, Promise<Pixels | null>>()

export const loadTile: TileLoader = (url) => {
  const hit = cache.get(url)
  if (hit) {
    cache.delete(url)
    cache.set(url, hit)
    return hit
  }
  const promise = fetchTile(url).then((pixels) => {
    // A failed request must not turn Retry into a permanent cache hit.
    if (!pixels && cache.get(url) === promise) cache.delete(url)
    return pixels
  })
  cache.set(url, promise)
  if (cache.size > 256) cache.delete(cache.keys().next().value as string)
  return promise
}

export function tileUrl(source: ScienceRaster, level: number, x: number, y: number) {
  return source.url.replace('{z}', String(level)).replace('{y}', String(y)).replace('{x}', String(x))
}

export async function sampleRaster(source: ScienceRaster, points: LatLon[], load: TileLoader = loadTile, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const level = source.maxLevel
  const groups = new Map<string, { index: number; px: number; py: number }[]>()
  points.forEach((point, index) => {
    const { x, y, px, py } = tileFor(point, level, source.tileSize)
    const url = tileUrl(source, level, x, y)
    const group = groups.get(url) ?? []
    group.push({ index, px, py })
    groups.set(url, group)
  })
  const values: (number | null)[] = points.map(() => null)
  await Promise.all([...groups].map(async ([url, group]) => {
    const pixels = await load(url)
    signal?.throwIfAborted()
    if (!pixels) return
    for (const { index, px, py } of group) values[index] = pixelValue(pixels, px, py, source.legend.colors)
  }))
  return values
}
