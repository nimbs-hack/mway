// Warm only useful landing-site views. Keep upstream concurrency low and reuse
// the same validation and disk cache as interactive requests.
import { startAPI } from './api-server.js'
import { CTX_MAX_LEVEL, ctxTileUrl } from '../src/data/ctx.js'
import { TERRAIN_API_PATH } from '../src/data/terrain-source.js'
import { SITES } from '../src/data/sites.js'

const args = process.argv.slice(2)
const source = args.includes('--backup') ? 'beta01' : 'v01'
const names = args.filter((arg) => arg !== '--backup')
const selected = names.length ? names : ['curiosity', 'perseverance', 'pathfinder']
const sites = selected.map((id) => {
  const site = SITES.find((s) => s.id === id)
  if (!site) throw new Error(`Unknown site: ${id}`)
  return site
})
const api = await startAPI()
try {
  const metadataResponse = await fetch(`${api.url}${TERRAIN_API_PATH}/layer.json`)
  if (!metadataResponse.ok) throw new Error('Cannot load terrain availability')
  type TileRange = { startX: number; endX: number; startY: number; endY: number }
  const metadata: { available: TileRange[][] } = await metadataResponse.json()
  const jobs = new Map<string, 'ctx' | 'terrain'>()

  // Planetocentric latitude and east longitude [-180, 180]. Imagery rows start
  // in the north; the terrain source and its availability use TMS, from the south.
  function addNeighborhood(lon: number, lat: number, z: number, kind: 'ctx' | 'terrain') {
    const rows = 2 ** z
    const cols = rows * 2
    const centerX = Math.floor((lon + 180) / 360 * cols)
    const centerY = Math.min(rows - 1, Math.max(0, Math.floor((90 - lat) / 180 * rows)))
    for (let dy = -1; dy <= 1; dy++) {
      const y = centerY + dy
      if (y < 0 || y >= rows) continue
      for (let dx = -1; dx <= 1; dx++) {
        const x = (centerX + dx + cols) % cols
        const tmsY = rows - 1 - y
        if (kind === 'ctx') {
          jobs.set(ctxTileUrl(z, y, x, source), kind)
        } else if (metadata.available[z]?.some((r) => x >= r.startX && x <= r.endX && tmsY >= r.startY && tmsY <= r.endY)) {
          jobs.set(`${TERRAIN_API_PATH}/${z}/${x}/${tmsY}.terrain`, kind)
        }
      }
    }
  }

  for (const site of sites) {
    const points = [[site.lat, site.lon]]
    if (site.traverse) {
      const step = Math.max(1, Math.ceil(site.traverse.path.length / 16))
      points.push(...site.traverse.path.filter((_, i) => i % step === 0), site.traverse.position)
    }
    for (const [lat, lon] of points) {
      for (let z = 4; z <= CTX_MAX_LEVEL; z++) addNeighborhood(lon, lat, z, 'ctx')
      for (let z = 0; z <= 14; z++) addNeighborhood(lon, lat, z, 'terrain')
    }
  }

  const queue = [...jobs]
  let completed = 0
  let bytes = 0
  const failures: string[] = []
  console.log(`Precaching ${queue.length} tiles, CTX ${source}, for ${selected.join(', ')} with 6 concurrent requests`)
  async function run() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [path] = job
      const response = await fetch(`${api.url}${path}`)
      if (response.ok) bytes += (await response.arrayBuffer()).byteLength
      else failures.push(`${response.status} ${path}`)
      completed++
      if (completed % 50 === 0) console.log(`${completed}/${jobs.size} tiles, ${(bytes / 1e6).toFixed(1)} MB`)
    }
  }
  await Promise.all(Array.from({ length: 6 }, run))
  console.log(`${completed - failures.length}/${jobs.size} tiles ready, ${(bytes / 1e6).toFixed(1)} MB served or fetched`)
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exitCode = 1
  }
} finally {
  await api.stop()
}
