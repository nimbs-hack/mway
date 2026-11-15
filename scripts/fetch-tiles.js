// Downloads the low zoom levels of the basemap into public/tiles so the
// first view of the map does not wait on the NASA tile server.
// Files that already exist are skipped, so it is safe to re-run.
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_MAX_ZOOM, localTilePath, remoteTileUrl } from '../src/data/basemap.js'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const CONCURRENCY = 6

const jobs = []
for (let z = 0; z <= LOCAL_MAX_ZOOM; z++) {
  // The grid is twice as wide as it is tall.
  for (let y = 0; y < 2 ** z; y++) {
    for (let x = 0; x < 2 ** (z + 1); x++) {
      jobs.push({ url: remoteTileUrl(z, y, x), file: join(PUBLIC_DIR, localTilePath(z, y, x)) })
    }
  }
}

let fetched = 0
let skipped = 0
let bytes = 0
const failures = []

async function download({ url, file }) {
  if (await stat(file).catch(() => null)) {
    skipped++
    return
  }
  const response = await fetch(url)
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !type.startsWith('image/')) {
    throw new Error(`${response.status} ${type}`)
  }
  const data = Buffer.from(await response.arrayBuffer())
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, data)
  fetched++
  bytes += data.length
}

async function worker() {
  for (let job = jobs.pop(); job; job = jobs.pop()) {
    await download(job).catch((error) => failures.push(`${job.url}: ${error.message}`))
  }
}

const total = jobs.length
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

console.log(
  `${total} tiles: ${fetched} downloaded (${(bytes / 1e6).toFixed(1)} MB), ${skipped} already present, ${failures.length} failed`,
)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
}
