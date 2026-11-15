// Mars as a turning sphere, shown before a mission file is open. It is drawn
// on a 2D canvas from the Viking color mosaic tiles that ship in
// public/tiles, so it loads no terrain and no WebGL.
//
// The tiles are equirectangular: planetocentric latitude, east longitude from
// -180 at the left edge. The sphere leans by Mars' axial tilt and turns once
// every two minutes, or stays still when the reader asks for less motion.
//
// Texture detail follows the globe's size on screen. Level 1, 1024 by 512,
// draws first because it loads fastest. Then the level whose visible half is
// at least as wide as the globe replaces it: level 2 at 2048 by 1024, or
// level 3 at 4096 by 2048, the finest that ships in public/tiles.

import { localTilePath } from '../data/basemap.js'
import { h } from './dom'

const TILE = 256
const FIRST_LEVEL = 1
const FINEST_LEVEL = 3
const TILT = (25.2 * Math.PI) / 180
const SECONDS_PER_TURN = 120
// Light from the upper left, in front of the sphere.
const LIGHT = (() => {
  const [x, y, z] = [-0.55, 0.45, 0.7]
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
})()

function loadTile(level: number, y: number, x: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('globe tile failed'))
    image.src = import.meta.env.BASE_URL + localTilePath(level, y, x)
  })
}

type Texture = { level: number; width: number; height: number; data: Uint32Array }

// A level is 2^(level+1) tiles across and 2^level down.
async function loadTexture(level: number): Promise<Texture> {
  const columns = 2 ** (level + 1)
  const rows = 2 ** level
  const sheet = document.createElement('canvas')
  sheet.width = columns * TILE
  sheet.height = rows * TILE
  const pen = sheet.getContext('2d', { willReadFrequently: true })!
  const jobs: Promise<void>[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) jobs.push(loadTile(level, y, x).then((image) => pen.drawImage(image, x * TILE, y * TILE)))
  }
  await Promise.all(jobs)
  return { level, width: sheet.width, height: sheet.height, data: new Uint32Array(pen.getImageData(0, 0, sheet.width, sheet.height).data.buffer) }
}

// The coarsest level whose visible half, half its width, covers `size` pixels.
const levelFor = (size: number) => Math.min(FINEST_LEVEL, Math.max(FIRST_LEVEL, Math.ceil(Math.log2(size / TILE))))

export function createGlobe(root: HTMLElement) {
  const canvas = h('canvas', { class: 'globe__sphere', 'aria-hidden': 'true' })
  const pen = canvas.getContext('2d')!
  root.prepend(canvas)
  const still = matchMedia('(prefers-reduced-motion: reduce)')

  let texture: Texture | null = null
  // The level being fetched, so a resize does not fetch it twice.
  let loading = 0
  let failed = false
  let size = 0
  let frame: ImageData | null = null
  // For each lit pixel of the disc: where it is in the frame, how far down
  // and across the texture it reads before turning (0 to 1, so any level
  // fits), its brightness, and its opacity, which smooths the edge of the
  // disc.
  let pixels = new Int32Array(0)
  let rows = new Float32Array(0)
  let columns = new Float32Array(0)
  let shades = new Float32Array(0)
  let alphas = new Uint32Array(0)
  let running = false
  let queued = 0
  let lastPaint = 0

  function layout() {
    const box = canvas.getBoundingClientRect()
    const next = Math.round(Math.min(box.width, box.height) * Math.min(devicePixelRatio, 2))
    if (next < 2 || next === size) return
    size = canvas.width = canvas.height = next
    frame = pen.createImageData(size, size)
    const lit: number[] = [], row: number[] = [], column: number[] = [], shade: number[] = [], alpha: number[] = []
    const [cos, sin] = [Math.cos(TILT), Math.sin(TILT)]
    for (let py = 0; py < size; py++) {
      const ny = 1 - ((py + 0.5) / size) * 2
      for (let px = 0; px < size; px++) {
        const nx = ((px + 0.5) / size) * 2 - 1
        const r2 = nx * nx + ny * ny
        if (r2 > 1) continue
        const nz = Math.sqrt(1 - r2)
        // Turn the view direction back into the planet's own frame.
        const by = ny * cos + nz * sin
        const bz = nz * cos - ny * sin
        const lat = Math.asin(Math.max(-1, Math.min(1, by)))
        const lon = Math.atan2(nx, bz)
        const light = Math.max(0, nx * LIGHT[0]! + ny * LIGHT[1]! + nz * LIGHT[2]!)
        // The edge of the disc fades out over the last pixel.
        const edge = Math.min(1, (1 - Math.sqrt(r2)) * size * 0.5)
        lit.push(py * size + px)
        row.push((Math.PI / 2 - lat) / Math.PI)
        column.push((lon + Math.PI) / (2 * Math.PI))
        shade.push(0.12 + 0.88 * light)
        alpha.push(Math.round(255 * edge) << 24)
      }
    }
    pixels = Int32Array.from(lit)
    rows = Float32Array.from(row)
    columns = Float32Array.from(column)
    shades = Float32Array.from(shade)
    alphas = Uint32Array.from(alpha)
    paint(performance.now())
    sharpen()
  }

  // Loads the level the globe's size needs, if a coarser one is showing.
  function sharpen() {
    const wanted = levelFor(size)
    if (failed || !texture || wanted <= texture.level || wanted === loading) return
    loading = wanted
    loadTexture(wanted).then(
      (finer) => {
        if (loading === wanted) loading = 0
        if (!texture || finer.level > texture.level) texture = finer
        paint(performance.now())
      },
      // The coarser texture stays. It is only less sharp.
      () => void (loading = 0),
    )
  }

  function paint(now: number) {
    queued = 0
    if (!frame || !texture) return
    lastPaint = now
    const { width, height, data } = texture
    const turn = still.matches ? 0 : ((now / 1000 / SECONDS_PER_TURN) % 1) * width
    const out = new Uint32Array(frame.data.buffer)
    out.fill(0)
    for (let i = 0; i < pixels.length; i++) {
      let x = Math.floor(columns[i]! * width + turn)
      if (x >= width) x -= width
      const y = Math.min(height - 1, Math.floor(rows[i]! * height))
      const color = data[y * width + x]!
      const s = shades[i]!
      // Little endian RGBA: red in the low byte, alpha in the high one.
      out[pixels[i]!] = alphas[i]! | (((((color >>> 16) & 255) * s) << 16) | ((((color >>> 8) & 255) * s) << 8) | ((color & 255) * s))
    }
    pen.putImageData(frame, 0, 0)
    if (running && !still.matches) queued = requestAnimationFrame(tick)
  }

  // About 30 frames a second is smooth for a slow turn and spares the battery.
  function tick(now: number) {
    if (now - lastPaint < 32) queued = requestAnimationFrame(tick)
    else paint(now)
  }

  new ResizeObserver(layout).observe(canvas)
  loadTexture(FIRST_LEVEL).then(
    (first) => {
      texture = first
      paint(performance.now())
      sharpen()
    },
    () => {
      failed = true
      root.classList.add('globe--missing')
    },
  )

  return {
    // Turns the sphere while it is on screen, and stops it otherwise.
    run(on: boolean) {
      running = on && !failed
      cancelAnimationFrame(queued)
      queued = 0
      if (running) paint(performance.now())
    },
  }
}
