import { Cartographic } from 'cesium'
import type { TerrainProvider } from 'cesium'
import { MARS_RADIUS } from './geo'
import type { LatLon } from './geo'

// How fine the terrain is at a point. Mars Trek's tileset only goes deep
// where a high resolution elevation model exists (HiRISE at Jezero and
// Gale, CTX and HRSC elsewhere), so the deepest available tile level is a
// good stand-in for the source resolution. A tile level is 2^(z+1) by 2^z
// tiles on the Mars sphere, and a quantized mesh tile is nominally 64 cells
// across. Coordinates are planetocentric latitude and east longitude.

const CELLS_PER_TILE = 64

// Ground spacing in meters for a tile level: about 326 m at level 9 (the
// MOLA base), 41 m at level 12 and 1.3 m at level 17.
export function detailMeters(level: number) {
  return (2 * Math.PI * MARS_RADIUS) / 2 ** (level + 1) / CELLS_PER_TILE
}

// Finer than this resolves scarps a few meters high. 5 m at level 15.
export const FINE_DETAIL = 5
// Coarser than this hides boulders and small scarps, so slopes there are a
// smoothed lower bound. Planning assumption, shown with the reason.
export const COARSE_DETAIL = 20

export function detailLabel(meters: number) {
  return meters < 10 ? `${meters.toFixed(1)} m` : `${Math.round(meters)} m`
}

type Availability = { computeMaximumLevelAtPosition(position: Cartographic): number }

// Deepest tile level at a point, or null before availability is known.
export function levelAt(provider: TerrainProvider | null, [lat, lon]: LatLon) {
  const availability = (provider as unknown as { availability?: Availability } | null)?.availability
  if (!availability) return null
  const level = availability.computeMaximumLevelAtPosition(Cartographic.fromDegrees(lon, lat))
  return Number.isFinite(level) && level >= 0 ? level : null
}

export function detailAt(provider: TerrainProvider | null, point: LatLon) {
  const level = levelAt(provider, point)
  return level === null ? null : detailMeters(level)
}

// Tile ranges from layer.json, TMS order: y counts up from the south.
export type TileRange = { startX: number, startY: number, endX: number, endY: number }
// south, west, north, east in degrees.
export type Box = [south: number, west: number, north: number, east: number]

// Footprints of every area with tiles at `level` or deeper. Each range in
// layer.json is a rectangle of tiles, so this is a short list of boxes.
export function coverage(available: TileRange[][], level: number): Box[] {
  const ranges = available[level] ?? []
  const width = 360 / 2 ** (level + 1)
  const height = 180 / 2 ** level
  return ranges.map((r) => [
    -90 + r.startY * height,
    -180 + r.startX * width,
    -90 + (r.endY + 1) * height,
    -180 + (r.endX + 1) * width,
  ])
}

// The outline of a box as a closed line of points, for drawing.
export function outline([south, west, north, east]: Box): LatLon[] {
  return [[north, west], [north, east], [south, east], [south, west], [north, west]]
}

// Slope baseline in meters for terrain of a given detail: a few cells, so
// it follows the real surface without amplifying mesh noise. Never under
// 5 m and never over the 60 m the global terrain uses.
export function slopeBaseline(detail: number) {
  return Math.min(60, Math.max(5, 4 * detail))
}

// The coarsest tile level whose detail is at most half of `spacing`, so a
// grid of that spacing reads real terrain without fetching tiles finer than
// it can use. Kept within the levels Trek serves and `finest`, the deepest
// level available at the route.
export function levelForSpacing(spacing: number, finest = 17) {
  let level = 9
  while (level < Math.min(17, finest) && detailMeters(level) > spacing / 2) level++
  return level
}
