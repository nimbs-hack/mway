import type { LatLon } from './geo'
import { MIL2525C_BY_ID } from './mil2525c'

// Map markers placed by the planner, each a MIL-STD-2525C symbol at a point.
// Planetocentric latitude, east longitude -180 to 180. Mission maps store
// these in the mission file; standalone maps use browser storage.

export type Marker = {
  id: string
  symbol: string
  point: LatLon
  label: string
}

const KEY = 'nimbs.markers.v1'

function valid(item: unknown): item is Marker {
  const m = item as Marker
  return Boolean(m) && typeof m.id === 'string' && typeof m.label === 'string'
    && typeof m.symbol === 'string' && Boolean(MIL2525C_BY_ID[m.symbol])
    && Array.isArray(m.point) && m.point.length === 2
    && Math.abs(m.point[0]) <= 90 && Math.abs(m.point[1]) <= 180
}

// Bad entries are dropped, not fatal. Storage can be missing entirely.
export function loadMarkers(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): Marker[] {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(valid) : []
  } catch {
    return []
  }
}

export function saveMarkers(markers: Marker[], storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null) {
  try {
    storage?.setItem(KEY, JSON.stringify(markers))
  } catch {
    // Nothing to do without storage.
  }
}

export function addMarker(markers: Marker[], symbol: string, point: LatLon, id = crypto.randomUUID()): Marker[] {
  const name = MIL2525C_BY_ID[symbol]?.name ?? 'Marker'
  return [...markers, { id, symbol, point, label: name }]
}

export function updateMarker(markers: Marker[], id: string, change: Partial<Omit<Marker, 'id'>>): Marker[] {
  return markers.map((m) => (m.id === id ? { ...m, ...change } : m))
}

export function removeMarker(markers: Marker[], id: string): Marker[] {
  return markers.filter((m) => m.id !== id)
}

// SVG image of a symbol for the map: the symbol in `color` on a dark tile, so
// it reads on any ground.
export function symbolImage(symbol: string, color: string, background: string, size = 32) {
  const inner = MIL2525C_BY_ID[symbol]?.svgInner ?? ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" style="color:${color}">`
    + `<rect x="0.5" y="0.5" width="23" height="23" fill="${background}" fill-opacity="0.82"/>`
    + `<g color="${color}">${inner}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
