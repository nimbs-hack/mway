// Run against a local API: bun scripts/benchmark-routes.js [http://127.0.0.1:3000] [meters].
// Search timing excludes Thermal costs; infrared downloads are timed separately.
import { CesiumTerrainProvider, Resource } from 'cesium'
import { MARS_SPHERE, prepareTerrainTile } from '../src/data/terrain'
import { sampleSurface } from '../src/data/terrain-sample'
import { buildGrid, gridSlopes, routeOptions } from '../src/data/route-options'
import { DEFAULT_LIMITS } from '../src/data/plan'
import { offset } from '../src/data/geo'
import { SITES } from '../src/data/sites'
import { tileFor, tileUrl } from '../src/data/raster-sample'
import { SAMPLED_RASTERS } from '../src/data/science-layers'

const base = process.argv[2] ?? 'http://127.0.0.1:3000'
const meters = Number(process.argv[3] ?? 2000)
const level = meters > 20_000 ? 12 : 14
const requestTimes = []
Resource.prototype.fetchJson = async function () {
  const response = await fetch(this.url)
  if (!response.ok) throw Error(`HTTP ${response.status}`)
  return response.json()
}
Resource.prototype.fetchArrayBuffer = async function () {
  const start = performance.now()
  const response = await fetch(this.url)
  const bytes = await response.arrayBuffer()
  requestTimes.push({ url: this.url, ms: performance.now() - start, status: response.status })
  if (!response.ok) throw Error(`HTTP ${response.status}`)
  return bytes
}
const provider = await CesiumTerrainProvider.fromUrl(`${base}/api/terrain/mars-v14/`, { ellipsoid: MARS_SPHERE, requestVertexNormals: true })
const request = provider.requestTileGeometry.bind(provider)
let prepareMs = 0
provider.requestTileGeometry = (x, y, level) => request(x, y, level)?.then((data) => {
  const start = performance.now()
  const result = prepareTerrainTile(data, provider.tilingScheme.tileXYToRectangle(x, y, level))
  prepareMs += performance.now() - start
  return result
})
for (const site of SITES.filter((s) => s.traverse)) {
  const start = site.traverse.position
  const grid = buildGrid(start, offset(start, meters, 0))
  const night = SAMPLED_RASTERS.find((layer) => layer.id === 'themis-night')
  const urls = [...new Set(grid.points.map((p) => {
    const { x, y } = tileFor(p, night.maxLevel, night.tileSize)
    return tileUrl(night, night.maxLevel, x, y)
  }))]
  for (const pass of ['first', 'repeat']) {
    requestTimes.length = 0
    prepareMs = 0
    const begin = performance.now()
    console.log(JSON.stringify({ site: site.id, start, pass, stage: 'sampling', points: grid.points.length }))
    const [surface, imagery] = await Promise.all([
      sampleSurface(provider, grid.points, level).then((surface) => ({ surface, ms: performance.now() - begin })),
      Promise.all(urls.map(async (url) => {
        const response = await fetch(base + url)
        await response.arrayBuffer()
        return { status: response.status, ms: performance.now() - begin }
      })),
    ])
    const elevation = surface.surface.map((s) => s.elevation)
    const coarse = gridSlopes(grid, elevation)
    const field = { elevation, slope: surface.surface.map((s, i) => s.slope ?? coarse[i]), thermal: grid.points.map(() => null) }
    const searchStart = performance.now()
    const result = routeOptions(grid, field, DEFAULT_LIMITS)
    console.log(JSON.stringify({ site: site.id, pass, surfaceMs: surface.ms, prepareMs, imagery,
      searchMs: performance.now() - searchStart, status: result.status, known: elevation.filter((e) => e !== null).length,
      terrainRequests: requestTimes.length, slowest: requestTimes.toSorted((a,b) => b.ms-a.ms).slice(0,3) }))
  }
}
