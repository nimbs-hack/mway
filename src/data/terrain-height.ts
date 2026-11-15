import { Cartesian3, Intersections2D, Math as CesiumMath, QuantizedMeshTerrainData } from 'cesium'
import type { Rectangle, TerrainData } from 'cesium'

// These are the same quantized buffers used by prepareTerrainTile. Keep the
// original triangles and interpolation; the index only narrows the search.
type QuantizedTile = QuantizedMeshTerrainData & {
  _quantizedVertices: Uint16Array
  _indices: Uint16Array | Uint32Array
  _minimumHeight: number
  _maximumHeight: number
}
const MAX = 32767

export function indexTerrainHeights(data: TerrainData) {
  if (!(data instanceof QuantizedMeshTerrainData)) return data
  const tile = data as QuantizedTile
  const vertices = tile._quantizedVertices
  const indices = tile._indices
  if (!vertices || !indices) return data
  const count = vertices.length / 3
  const minimum = tile._minimumHeight
  const maximum = tile._maximumHeight
  const size = Math.max(1, Math.min(32, Math.ceil(Math.sqrt(indices.length / 24))))
  const cell = (value: number) => Math.min(size - 1, Math.floor(value / MAX * size))
  let buckets: number[][] | undefined
  const barycentric = new Cartesian3()

  const interpolate = (rectangle: Rectangle, longitude: number, latitude: number) => {
    if (!buckets) {
      buckets = Array.from({ length: size * size }, () => [])
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t], b = indices[t + 1], c = indices[t + 2]
        const left = cell(Math.min(vertices[a], vertices[b], vertices[c]))
        const right = cell(Math.max(vertices[a], vertices[b], vertices[c]))
        const bottom = cell(Math.min(vertices[count + a], vertices[count + b], vertices[count + c]))
        const top = cell(Math.max(vertices[count + a], vertices[count + b], vertices[count + c]))
        for (let y = bottom; y <= top; y++) {
          for (let x = left; x <= right; x++) buckets[y * size + x].push(t)
        }
      }
    }
    const u = CesiumMath.clamp((longitude - rectangle.west) / rectangle.width, 0, 1) * MAX
    const v = CesiumMath.clamp((latitude - rectangle.south) / rectangle.height, 0, 1) * MAX
    for (const t of buckets[cell(v) * size + cell(u)]) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2]
      const u0 = vertices[a], u1 = vertices[b], u2 = vertices[c]
      const v0 = vertices[count + a], v1 = vertices[count + b], v2 = vertices[count + c]
      if (u < Math.min(u0, u1, u2) || u > Math.max(u0, u1, u2) ||
          v < Math.min(v0, v1, v2) || v > Math.max(v0, v1, v2)) continue
      Intersections2D.computeBarycentricCoordinates(u, v, u0, v0, u1, v1, u2, v2, barycentric)
      if (barycentric.x >= -1e-15 && barycentric.y >= -1e-15 && barycentric.z >= -1e-15) {
        const height = barycentric.x * vertices[2 * count + a] +
          barycentric.y * vertices[2 * count + b] + barycentric.z * vertices[2 * count + c]
        return CesiumMath.lerp(minimum, maximum, height / MAX)
      }
    }
    return undefined
  }
  // Cesium's declaration says number, but its implementation also returns
  // undefined for holes. Preserve that missing-data behavior.
  Object.defineProperty(data, 'interpolateHeight', { value: interpolate, configurable: true, writable: true })
  return data
}
