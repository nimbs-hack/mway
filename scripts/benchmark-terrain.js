// Run with bun scripts/benchmark-terrain.js [path/to/cache/mars-v14-v2].
// Reads cached NASA tiles without writing to the cache or contacting upstreams.
import { CesiumTerrainProvider, Cartographic, Math as CesiumMath, Resource } from 'cesium'
import { prepareTerrainTile, MARS_SPHERE } from '../src/data/terrain'
import { indexTerrainHeights } from '../src/data/terrain-height'

const cacheDir = process.argv[2]
if (!cacheDir) throw Error('Pass a terrain cache directory')
const fetchArrayBuffer = Resource.prototype.fetchArrayBuffer
Resource.prototype.fetchArrayBuffer = async function () {
  const path = new URL(this.url).pathname.slice(1)
  const file = path === 'layer.json' ? path : path.replaceAll('/', '-')
  const source = Bun.file(`${cacheDir}/${file}`)
  if (!await source.exists()) throw Error(`Missing fixture ${file}`)
  return source.arrayBuffer()
}
// Metadata uses the same local fixture.
const fetchJson = Resource.prototype.fetchJson
Resource.prototype.fetchJson = async function () {
  return Bun.file(`${cacheDir}/layer.json`).json()
}
try {
  const provider = await CesiumTerrainProvider.fromUrl('https://terrain.test/', { ellipsoid: MARS_SPHERE })
  const results = []
  // TMS rows on disk, north-origin rows in Cesium.
  for (const [level, x, tmsY] of [[14, 23430, 9867], [14, 28888, 7757]]) {
    const y = 2 ** level - 1 - tmsY
    const data = await provider.requestTileGeometry(x, y, level)
    const rectangle = provider.tilingScheme.tileXYToRectangle(x, y, level)
    const triangles = data._indices.length / 3
    prepareTerrainTile(data, rectangle)
    const points = Array.from({ length: 8845 }, (_, i) => new Cartographic(
      CesiumMath.lerp(rectangle.west, rectangle.east, ((i * 7919) % 8845) / 8844),
      CesiumMath.lerp(rectangle.south, rectangle.north, ((i * 3571) % 8845) / 8844),
    ))
    const start = performance.now()
    const heights = points.map((p) => data.interpolateHeight(rectangle, p.longitude, p.latitude))
    const originalMs = performance.now() - start
    const indexedStart = performance.now()
    indexTerrainHeights(data)
    const indexed = points.map((p) => data.interpolateHeight(rectangle, p.longitude, p.latitude))
    const indexedMs = performance.now() - indexedStart
    if (heights.some((height, i) => height !== indexed[i])) throw Error('Height mismatch')
    results.push({ tile: `${level}-${x}-${tmsY}`, triangles, samples: points.length, originalMs, indexedMs,
      checksum: heights.reduce((sum, height) => sum + (height ?? 0), 0), missing: heights.filter((h) => h === undefined).length })
  }
  console.log(JSON.stringify(results, null, 2))
} finally {
  Resource.prototype.fetchArrayBuffer = fetchArrayBuffer
  Resource.prototype.fetchJson = fetchJson
}
