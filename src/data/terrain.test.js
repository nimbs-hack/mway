import { expect, test } from 'bun:test'
import { BoundingSphere, Cartesian3, EllipsoidalOccluder, Matrix4, OrientedBoundingBox, QuantizedMeshTerrainData, Rectangle, SceneMode, TerrainMesh } from 'cesium'
import { MARS_SPHERE, prepareTerrainTile } from './terrain'

const rect = Rectangle.fromDegrees(77.431640625, 18.4130859375, 77.4755859375, 18.45703125)

function tile(encodedNormals) {
  return new QuantizedMeshTerrainData({
    minimumHeight: 5500, maximumHeight: 5600,
    quantizedVertices: new Uint16Array([
      0, 32767, 0, 32767,
      0, 0, 32767, 32767,
      0, 32767, 0, 32767,
    ]),
    indices: new Uint16Array([0, 1, 2, 1, 3, 2]),
    westIndices: [0, 2], southIndices: [0, 1], eastIndices: [1, 3], northIndices: [2, 3],
    westSkirtHeight: 10, southSkirtHeight: 10, eastSkirtHeight: 10, northSkirtHeight: 10,
    // Match the upstream defect: a sphere south of its tile and an unscaled
    // horizon point. Valid vertex data must survive this metadata repair.
    boundingSphere: new BoundingSphere(Cartesian3.fromDegrees(77.446, 18.237, 3665, MARS_SPHERE), 2243),
    horizonOcclusionPoint: Cartesian3.fromDegrees(77.44, 18.24, 5500, MARS_SPHERE),
    encodedNormals,
  })
}

const vertices = [
  Cartesian3.fromRadians(rect.west, rect.south, 5500, MARS_SPHERE),
  Cartesian3.fromRadians(rect.east, rect.south, 5600, MARS_SPHERE),
  Cartesian3.fromRadians(rect.west, rect.north, 5500, MARS_SPHERE),
  Cartesian3.fromRadians(rect.east, rect.north, 5600, MARS_SPHERE),
]

test('terrain bounds contain the Mars mesh and its camera-depth interval', () => {
  const data = tile()
  const quantized = data._quantizedVertices.slice()
  expect(vertices.some((point) => Cartesian3.distance(point, data._boundingSphere.center) > data._boundingSphere.radius + 10000)).toBe(true)
  prepareTerrainTile(data, rect)
  const camera = Cartesian3.fromDegrees(77.45, 18.35, 8800, MARS_SPHERE)
  const direction = Cartesian3.normalize(Cartesian3.subtract(vertices[2], camera, new Cartesian3()), new Cartesian3())
  const interval = data._boundingSphere.computePlaneDistances(camera, direction)
  for (const point of vertices) {
    expect(Cartesian3.distance(point, data._boundingSphere.center)).toBeLessThanOrEqual(data._boundingSphere.radius + 1e-6)
    const depth = Cartesian3.dot(Cartesian3.subtract(point, camera, new Cartesian3()), direction)
    expect(depth).toBeGreaterThanOrEqual(interval.start - 1e-6)
    expect(depth).toBeLessThanOrEqual(interval.stop + 1e-6)
  }
  expect(data._quantizedVertices).toEqual(quantized)
  expect(data._encodedNormals).toHaveLength(8)
})

test('tiles with normals also get repaired bounds and scaled horizon culling', () => {
  const normals = new Uint8Array(8).fill(128)
  const data = tile(normals)
  prepareTerrainTile(data, rect)
  expect(data._encodedNormals).toBe(normals)
  expect(Cartesian3.magnitude(data._horizonOcclusionPoint)).toBeGreaterThan(1)
  expect(Cartesian3.magnitude(data._horizonOcclusionPoint)).toBeLessThan(1.01)
  const occluder = new EllipsoidalOccluder(MARS_SPHERE, Cartesian3.fromDegrees(77.45, 18.4, 10000, MARS_SPHERE))
  expect(occluder.isScaledSpacePointVisible(data._horizonOcclusionPoint)).toBe(true)
  occluder.cameraPosition = Cartesian3.fromDegrees(-102.55, -18.4, 10000, MARS_SPHERE)
  expect(occluder.isScaledSpacePointVisible(data._horizonOcclusionPoint)).toBe(false)
})

test('picking exaggerated terrain cannot change the bounds used to draw true-scale ground', async () => {
  const data = tile()
  const box = OrientedBoundingBox.fromRectangle(rect, 5500, 5600, MARS_SPHERE)
  const original = OrientedBoundingBox.clone(box)
  const mesh = {
    rectangle: rect, minimumHeight: 5500, maximumHeight: 5600,
    orientedBoundingBox: box,
    encoding: { exaggeration: 3, exaggerationRelativeHeight: 8201 },
    _transform: new Matrix4(), _terrainPicker: { needsRebuild: false },
    getTransform: TerrainMesh.prototype.getTransform,
    pick() { return this.getTransform(SceneMode.SCENE3D) },
  }
  let throttled = true
  data.createMesh = () => throttled ? undefined : Promise.resolve(mesh)
  prepareTerrainTile(data, rect)
  expect(data.createMesh({})).toBeUndefined()
  throttled = false
  const prepared = await data.createMesh({})
  const exaggerated = Matrix4.clone(prepared.pick())
  expect(prepared.orientedBoundingBox).toEqual(original)
  mesh.encoding.exaggeration = 1
  const trueScale = prepared.pick()
  expect(trueScale).not.toEqual(exaggerated)
  expect(prepared.orientedBoundingBox).toBe(box)
  expect(prepared.orientedBoundingBox).toEqual(original)
})
