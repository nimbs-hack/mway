import { distance } from './geo'
import type { LatLon } from './geo'

// Rover weather stations, read through the Go server at /api/weather/{id}.
// Temperatures are kelvin and pressure pascals. Coordinates are
// planetocentric latitude and east longitude, -180 to 180.

export type Reading = {
  sol: number
  date: string
  ls: number | null
  season?: string
  airMinK: number | null
  airMaxK: number | null
  groundMinK: number | null
  groundMaxK: number | null
  pressurePa: number | null
  opacity?: string
  uv?: string
  sunrise?: string
  sunset?: string
}

export type Report = {
  station: string
  rover: string
  instrument: string
  site: string
  sourceUrl: string
  fetchedAt: string
  stale: boolean
  latest: Reading | null
  history: Reading[]
}

// Where each station sits: the rover's last reported position, matching
// src/data/sites.js.
export const STATIONS: { id: string, siteId: string }[] = [
  { id: 'gale', siteId: 'curiosity' },
  { id: 'jezero', siteId: 'perseverance' },
]

export async function fetchWeather(id: string, signal?: AbortSignal): Promise<Report> {
  const response = await fetch(`/api/weather/${id}`, { signal })
  if (!response.ok) throw new Error(`Weather ${id} returned ${response.status}`)
  return response.json()
}

// The station closest to a point, from station positions given in order.
export function nearestStation(point: LatLon, positions: Record<string, LatLon>) {
  let best: { id: string, distance: number } | null = null
  for (const { id } of STATIONS) {
    const at = positions[id]
    if (!at) continue
    const d = distance(point, at)
    if (!best || d < best.distance) best = { id, distance: d }
  }
  return best
}

// Martian atmospheric scale height, as deploy-v1 uses it. Pressure falls by
// e for every 10.8 km of climb.
export const SCALE_HEIGHT = 10_800

/**
 * Pressure at another elevation from a station reading, assuming the same
 * air column. A rough estimate: it ignores weather between the two places,
 * so it is only good near the station.
 */
export function pressureAt(stationPa: number, stationElevation: number, elevation: number) {
  return stationPa * Math.exp(-(elevation - stationElevation) / SCALE_HEIGHT)
}

export function celsius(kelvin: number) {
  return kelvin - 273.15
}

export function formatTemp(kelvin: number | null | undefined) {
  if (kelvin == null) return '—'
  return `${Math.round(celsius(kelvin))} °C`
}

export function formatPressure(pascals: number | null | undefined) {
  if (pascals == null) return '—'
  return `${(pascals / 100).toFixed(2)} hPa`
}

// Days between the reading and now, from its Earth date.
export function ageDays(reading: Reading, now = Date.now()) {
  const at = Date.parse(`${reading.date}T12:00:00Z`)
  return Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 86_400_000)) : null
}

export function formatAge(days: number | null) {
  if (days === null) return '—'
  if (days < 1) return 'today'
  if (days < 60) return `${days} d ago`
  if (days < 730) return `${Math.round(days / 30)} mo ago`
  return `${(days / 365).toFixed(1)} yr ago`
}
