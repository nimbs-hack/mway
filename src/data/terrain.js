// 3D terrain from NASA Mars Trek, the same tileset Trek's own 3D view uses.
// It blends MOLA globally with HRSC and HiRISE elevation models where they
// exist, so detail goes much deeper at Jezero, Gale and Gusev than elsewhere.
//
// Quirks, all checked against the tiles themselves:
// - Tiles are built on a sphere of radius 3,396,190 m, so latitude is
//   planetocentric. Use MARS_SPHERE, not Cesium's oblate Ellipsoid.MARS,
//   or positions shift by up to about 20 km at mid latitudes.
// - Heights sit DATUM_OFFSET above the MOLA areoid, so the bottom of Hellas
//   is about 0. Subtract it to get elevation as Mars maps state it.
// - Where Trek joined a high resolution elevation model to the global one,
//   it left a vertical wall inside the tiles. Around Curiosity the HiRISE
//   model sits about 357 m above the global blend, joined by a cliff one
//   mesh cell wide, which lighting draws as a sharp square. smoothWalls()
//   turns those walls into ramps.
// - layer.json lists vertex normals, but the tiles don't contain any.
//   Without normals Cesium can't shade slopes, so computeNormals() builds
//   them from each tile's triangles.
// - Header bounding spheres can miss the decoded mesh by kilometers, and
//   horizon points arrive in meters instead of ellipsoid-scaled coordinates.
//   Rebuild both from the rendered sphere coordinates, on every tile.
import { BoundingSphere, Cartesian3, CesiumTerrainProvider, Ellipsoid, EllipsoidalOccluder, OrientedBoundingBox, Terrain } from 'cesium'
import { DATUM_OFFSET, TERRAIN_API_PATH } from './terrain-source'
import { limiter } from './performance'

const RADIUS = 3_396_190
export const MARS_SPHERE = new Ellipsoid(RADIUS, RADIUS, RADIUS)
// Some Cesium code reads Ellipsoid.default instead of the scene's ellipsoid.
// Terrain picking is one: with Earth as the default it builds the wrong
// bounding boxes, ray picks miss, and the camera loses track of the ground
// under it, which is how it could sink into hills.
Ellipsoid.default = MARS_SPHERE

export { DATUM_OFFSET }

const TERRAIN_URL = `${TERRAIN_API_PATH}/`
const QUANTIZED_MAX = 32767

// A mesh edge counts as an artificial wall when it climbs more than
// WALL_MIN_RISE at a slope above WALL_MIN_SLOPE. Real Martian slopes don't do
// that at the scale of a mesh cell; crater walls and scarps stay under ~40°.
const WALL_MIN_RISE = 150 // meters
const WALL_MIN_SLOPE = Math.tan((55 * Math.PI) / 180)
// Heights within this distance of a wall are relaxed into a smooth ramp.
const WALL_RAMP = 1500 // meters
const RELAX_ITERATIONS = 60
const occluder = new EllipsoidalOccluder(MARS_SPHERE)
const protectedMeshes = new WeakSet()

export function createTerrain() {
  return new Terrain(
    CesiumTerrainProvider.fromUrl(TERRAIN_URL, {
      ellipsoid: MARS_SPHERE,
      requestVertexNormals: true,
      credit: 'Terrain: NASA / JPL-Caltech Mars Trek',
    }).then((provider) => {
      const request = provider.requestTileGeometry.bind(provider)
      const prepared = (x, y, level) => (data) => prepareTerrainTile(
        data, provider.tilingScheme.tileXYToRectangle(x, y, level),
      )
      // Route and point sampling ask for tiles without a request object, all
      // of them at once. A browser opens six connections to a server, so a
      // long route would hold every one and the globe would wait behind it.
      // Three at a time leaves the globe the other three. samplingProvider()
      // in terrain-sample.ts caches the sampled tiles.
      const sample = limiter(3)
      provider.requestTileGeometry = (x, y, level, req) => (req
        ? request(x, y, level, req)?.then(prepared(x, y, level))
        : sample(() => request(x, y, level)).then(prepared(x, y, level)))
      return provider
    }),
  )
}

// Keep culling and depth-frustum bounds in the same coordinates as the mesh.
// Repair tiles with supplied normals too; their header bounds can still be bad.
export function prepareTerrainTile(data, rect) {
  const positions = tilePositions(data, rect)
  const smoothed = !data._encodedNormals && smoothWalls(data, positions)
  if (smoothed) positions.refresh()
  data._boundingSphere = BoundingSphere.fromVertices(positions.xyz)
  data._orientedBoundingBox = OrientedBoundingBox.fromRectangle(
    rect, data._minimumHeight, data._maximumHeight, MARS_SPHERE,
  )
  data._horizonOcclusionPoint = occluder.computeHorizonCullingPointFromVerticesPossiblyUnderEllipsoid(
    data._boundingSphere.center, positions.xyz, 3, Cartesian3.ZERO, data._minimumHeight,
  )
  if (smoothed || !data._encodedNormals) data._encodedNormals = computeNormals(data, positions)
  const createMesh = data.createMesh.bind(data)
  data.createMesh = (options) => createMesh(options)?.then((mesh) => {
    // Cesium 1.147's terrain picker writes exaggerated bounds into the mesh's
    // render bounds. Returning to 1× then culls nearby terrain against the old
    // 3× box. Give picking its own box and preserve the measured render bounds.
    if (!protectedMeshes.has(mesh)) {
      protectedMeshes.add(mesh)
      const renderBounds = mesh.orientedBoundingBox
      const pickBounds = OrientedBoundingBox.clone(renderBounds)
      const pick = mesh.pick.bind(mesh)
      mesh.pick = (...args) => {
        mesh.orientedBoundingBox = pickBounds
        try { return pick(...args) }
        finally { mesh.orientedBoundingBox = renderBounds }
      }
    }
    return mesh
  })
  return data
}

// Decoded vertex heights and planet-centered positions for a tile.
// refresh() rebuilds positions after heights change.
function tilePositions(data, rect) {
  const q = data._quantizedVertices
  const n = q.length / 3
  const width = rect.east - rect.west
  const height = rect.north - rect.south
  const heights = new Float64Array(n)
  const xyz = new Float64Array(n * 3)
  const onEdge = new Uint8Array(n)
  const minH = data._minimumHeight
  const rangeH = data._maximumHeight - minH
  for (let i = 0; i < n; i++) {
    heights[i] = minH + (q[2 * n + i] / QUANTIZED_MAX) * rangeH
    const u = q[i]
    const v = q[n + i]
    onEdge[i] = u === 0 || v === 0 || u === QUANTIZED_MAX || v === QUANTIZED_MAX ? 1 : 0
  }
  const refresh = () => {
    for (let i = 0; i < n; i++) {
      const lon = rect.west + (q[i] / QUANTIZED_MAX) * width
      const lat = rect.south + (q[n + i] / QUANTIZED_MAX) * height
      const r = RADIUS + heights[i]
      const cosLat = Math.cos(lat)
      xyz[i * 3] = r * cosLat * Math.cos(lon)
      xyz[i * 3 + 1] = r * cosLat * Math.sin(lon)
      xyz[i * 3 + 2] = r * Math.sin(lat)
    }
  }
  refresh()
  return { n, heights, xyz, onEdge, refresh }
}

// Finds artificial walls (see WALL_MIN_RISE) and relaxes every vertex within
// WALL_RAMP of one toward the average of its neighbors, which turns the
// cliff into a ramp. Vertices on the tile border stay put so neighboring
// tiles still meet. Returns true if it changed anything.
function smoothWalls(data, positions) {
  const { n, heights, xyz, onEdge } = positions
  const idx = data._indices
  const ground = (a, b) => {
    // Horizontal distance, measured at the lower of the two radii.
    const ra = RADIUS + heights[a]
    const rb = RADIUS + heights[b]
    const scale = Math.min(ra, rb)
    const ax = (xyz[a * 3] / ra) * scale, ay = (xyz[a * 3 + 1] / ra) * scale, az = (xyz[a * 3 + 2] / ra) * scale
    const bx = (xyz[b * 3] / rb) * scale, by = (xyz[b * 3 + 1] / rb) * scale, bz = (xyz[b * 3 + 2] / rb) * scale
    return Math.hypot(ax - bx, ay - by, az - bz)
  }

  const wall = new Set()
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k]
      const b = idx[t + ((k + 1) % 3)]
      const rise = Math.abs(heights[a] - heights[b])
      if (rise > WALL_MIN_RISE && rise > WALL_MIN_SLOPE * ground(a, b)) {
        wall.add(a)
        wall.add(b)
      }
    }
  }
  if (wall.size === 0) return false

  // Most tiles have no seam. Build adjacency only when smoothing is needed.
  const neighbors = Array.from({ length: n }, () => new Set())
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k]
      const b = idx[t + ((k + 1) % 3)]
      neighbors[a].add(b)
      neighbors[b].add(a)
    }
  }

  // Vertices close enough to a wall to be relaxed.
  const region = []
  for (let i = 0; i < n; i++) {
    if (onEdge[i]) continue
    for (const w of wall) {
      if (ground(i, w) < WALL_RAMP) {
        region.push(i)
        break
      }
    }
  }

  const next = new Float64Array(n)
  for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
    for (const i of region) {
      let sum = 0
      for (const j of neighbors[i]) sum += heights[j]
      next[i] = sum / neighbors[i].size
    }
    for (const i of region) heights[i] = next[i]
  }

  // Write the heights back, re-quantized to their new range.
  let lo = Infinity
  let hi = -Infinity
  for (const h of heights) {
    if (h < lo) lo = h
    if (h > hi) hi = h
  }
  const range = hi - lo || 1
  const q = data._quantizedVertices
  for (let i = 0; i < n; i++) q[2 * n + i] = Math.round(((heights[i] - lo) / range) * QUANTIZED_MAX)
  data._minimumHeight = lo
  data._maximumHeight = hi
  return true
}

// Per-vertex normals for a quantized mesh tile, oct-encoded the way Cesium
// expects (two bytes per vertex). Each vertex gets the area-weighted average
// of the faces around it.
function computeNormals(data, { n, xyz: pos }) {
  const acc = new Float64Array(n * 3)
  const idx = data._indices
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3
    const b = idx[t + 1] * 3
    const c = idx[t + 2] * 3
    const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2]
    const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2]
    // Cross product length is twice the triangle area, so big faces count more.
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    for (const v of [a, b, c]) {
      acc[v] += nx
      acc[v + 1] += ny
      acc[v + 2] += nz
    }
  }

  const out = new Uint8Array(n * 2)
  for (let i = 0; i < n; i++) {
    let x = acc[i * 3], y = acc[i * 3 + 1], z = acc[i * 3 + 2]
    // Winding can go either way. A surface normal always points away from the planet.
    if (x * pos[i * 3] + y * pos[i * 3 + 1] + z * pos[i * 3 + 2] < 0) {
      x = -x
      y = -y
      z = -z
    }
    octEncode(x, y, z, out, i * 2)
  }
  return out
}

// Same octahedral encoding as Cesium's AttributeCompression.octEncode.
function octEncode(x, y, z, out, offset) {
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1
  let ox = x / sum
  let oy = y / sum
  if (z / sum < 0) {
    const tx = ox
    ox = (1 - Math.abs(oy)) * (tx >= 0 ? 1 : -1)
    oy = (1 - Math.abs(tx)) * (oy >= 0 ? 1 : -1)
  }
  out[offset] = Math.round((ox * 0.5 + 0.5) * 255)
  out[offset + 1] = Math.round((oy * 0.5 + 0.5) * 255)
}
