import { expect, test } from 'bun:test'
import { BoundingSphere, Cartesian3, QuantizedMeshTerrainData, Rectangle } from 'cesium'
import { indexTerrainHeights } from './terrain-height'

const rectangle = Rectangle.fromDegrees(77.4, 18.4, 77.5, 18.5)

function makeTile(IndexArray = Uint16Array, hole = false) {
  const size = 33
  const count = size * size
  const vertices = new Uint16Array(count * 3)
  const indices = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      vertices[i] = Math.round(x / (size - 1) * 32767)
      vertices[count + i] = Math.round(y / (size - 1) * 32767)
      vertices[2 * count + i] = (x * 7919 + y * 3571) % 32768
      if (x < size - 1 && y < size - 1 && !(hole && x === 0 && y === 0)) {
        indices.push(i, i + 1, i + size, i + 1, i + size + 1, i + size)
      }
    }
  }
  return new QuantizedMeshTerrainData({
    minimumHeight: -100, maximumHeight: 800,
    quantizedVertices: vertices, indices: new IndexArray(indices),
    boundingSphere: new BoundingSphere(), horizonOcclusionPoint: new Cartesian3(),
    westIndices: [], southIndices: [], eastIndices: [], northIndices: [],
    westSkirtHeight: 0, southSkirtHeight: 0, eastSkirtHeight: 0, northSkirtHeight: 0,
  })
}

for (const IndexArray of [Uint16Array, Uint32Array]) {
  test(`indexed heights match Cesium exactly with ${IndexArray.name}`, () => {
    const data = makeTile(IndexArray)
    const original = data.interpolateHeight.bind(data)
    const points = []
    // Vertices, triangle edges, bucket edges, clamped positions and interiors.
    for (let y = -1; y <= 33; y++) for (let x = -1; x <= 33; x++) points.push([x / 32, y / 32])
    for (let i = 0; i < 2000; i++) points.push([((i * 7919) % 2000) / 1999, ((i * 3571) % 2000) / 1999])
    const sample = (fn, [x, y]) => fn(rectangle, rectangle.west + rectangle.width * x, rectangle.south + rectangle.height * y)
    const expected = points.map((point) => sample(original, point))
    indexTerrainHeights(data)
    expect(points.map((point) => sample(data.interpolateHeight, point))).toEqual(expected)
    // Cesium frees the raw properties after creating a render mesh. The sampler
    // retains the original buffers and does not depend on that lifecycle.
    data._quantizedVertices = undefined
    data._indices = undefined
    expect(points.map((point) => sample(data.interpolateHeight, point))).toEqual(expected)
  })
}

test('a hole remains missing data rather than an invented height', () => {
  const data = makeTile(Uint16Array, true)
  const lon = rectangle.west + rectangle.width / 128
  const lat = rectangle.south + rectangle.height / 128
  expect(data.interpolateHeight(rectangle, lon, lat)).toBeUndefined()
  indexTerrainHeights(data)
  expect(data.interpolateHeight(rectangle, lon, lat)).toBeUndefined()
})
