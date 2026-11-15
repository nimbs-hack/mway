import { expect, test } from 'bun:test'
import { Ellipsoid, ImageryLayer, ImageryLayerCollection, UrlTemplateImageryProvider } from 'cesium'
import { addScienceOverlay } from './science-overlay'

const source = { url: '/api/science/example/{z}/{y}/{x}.png', tileSize: 256, maxLevel: 6, credit: 'Test source' }

test('a CTX replacement stays below science imagery and cleanup restores lighting', () => {
  const imageryLayers = new ImageryLayerCollection()
  const globe = { enableLighting: true }
  const viewer = { imageryLayers, isDestroyed: () => false, scene: { globe, ellipsoid: Ellipsoid.MARS, requestRender() {} } }
  const statuses = []
  const overlay = addScienceOverlay(viewer, source, (status) => statuses.push(status))
  const science = imageryLayers.get(0)
  const replacement = new ImageryLayer(new UrlTemplateImageryProvider({ url: '/ctx/{z}/{x}/{y}.png' }))
  imageryLayers.add(replacement)
  expect(imageryLayers.get(1)).toBe(science)
  expect(globe.enableLighting).toBe(false)
  overlay.setOpacity(0.4)
  expect(science.alpha).toBe(0.4)
  expect(science.imageryProvider.tilingScheme.ellipsoid).toBe(Ellipsoid.MARS)
  science.imageryProvider.errorEvent.raiseEvent({})
  expect(statuses.at(-1)).toBe('error')
  overlay.destroy()
  overlay.destroy()
  expect(science.isDestroyed()).toBe(true)
  expect(imageryLayers.length).toBe(1)
  expect(globe.enableLighting).toBe(true)
  expect(imageryLayers.layerAdded.numberOfListeners).toBe(0)
  imageryLayers.destroy()
})

test('tile status waits for requests, retains errors, and ignores work after removal', async () => {
  const requests = []
  const requestImage = UrlTemplateImageryProvider.prototype.requestImage
  UrlTemplateImageryProvider.prototype.requestImage = () =>
    new Promise((resolve, reject) => requests.push({ resolve, reject }))
  const imageryLayers = new ImageryLayerCollection()
  const viewer = { imageryLayers, isDestroyed: () => false, scene: { globe: { enableLighting: true }, ellipsoid: Ellipsoid.MARS, requestRender() {} } }
  const statuses = []
  const overlay = addScienceOverlay(viewer, source, (status) => statuses.push(status))
  try {
    const provider = imageryLayers.get(0).imageryProvider
    const first = provider.requestImage(0, 0, 0)
    const second = provider.requestImage(1, 0, 0)
    requests[0].resolve({})
    await first
    expect(statuses.at(-1)).toBe('loading')
    requests[1].resolve({})
    await second
    expect(statuses.at(-1)).toBe('ready')
    const failing = provider.requestImage(0, 0, 1)
    const failed = failing.catch((error) => error.message)
    requests[2].reject(new Error('offline'))
    expect(await failed).toBe('offline')
    const late = provider.requestImage(1, 0, 1)
    expect(statuses.at(-1)).toBe('error')
    overlay.destroy()
    const before = statuses.length
    requests[3].resolve({})
    await late
    expect(statuses.length).toBe(before)
  } finally {
    overlay.destroy()
    imageryLayers.destroy()
    UrlTemplateImageryProvider.prototype.requestImage = requestImage
  }
})

test('several overlays keep their rank order and restore lighting after the last one', () => {
  const imageryLayers = new ImageryLayerCollection()
  const globe = { enableLighting: true }
  const viewer = { imageryLayers, isDestroyed: () => false, scene: { globe, ellipsoid: Ellipsoid.MARS, requestRender() {} } }
  const top = addScienceOverlay(viewer, source, () => {}, 5)
  const bottom = addScienceOverlay(viewer, source, () => {}, 1)
  top.setOpacity(0.3)
  bottom.setOpacity(0.7)
  // The lower rank was added last but still sits below.
  const bottomLayer = imageryLayers.get(0)
  const topLayer = imageryLayers.get(1)
  expect(bottomLayer.alpha).toBe(0.7)
  expect(topLayer.alpha).toBe(0.3)
  imageryLayers.add(new ImageryLayer(new UrlTemplateImageryProvider({ url: '/ctx/{z}/{x}/{y}.png' })))
  expect(imageryLayers.indexOf(bottomLayer)).toBe(1)
  expect(imageryLayers.indexOf(topLayer)).toBe(2)
  top.destroy()
  expect(globe.enableLighting).toBe(false)
  bottom.destroy()
  expect(globe.enableLighting).toBe(true)
  expect(imageryLayers.layerAdded.numberOfListeners).toBe(0)
  imageryLayers.destroy()
})
