import { expect, test } from 'bun:test'
import { Ellipsoid, ImageryLayerCollection } from 'cesium'
import { addCtxLayer } from './ctx-layer'

test('a corrupt V01 tile replaces the whole mosaic once, preserving one CTX layer', async () => {
  const imageryLayers = new ImageryLayerCollection()
  const values = new Map()
  const sources = []
  let errors = 0
  const viewer = { imageryLayers, scene: { ellipsoid: Ellipsoid.MARS, requestRender() {} } }
  const dispose = addCtxLayer(viewer, {
    onSource: (source) => sources.push(source),
    onError: () => errors++,
    storage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) },
  })
  const original = imageryLayers.get(0)
  original.imageryProvider.errorEvent.raiseEvent({})
  original.imageryProvider.errorEvent.raiseEvent({})
  await Promise.resolve()
  expect(imageryLayers.length).toBe(1)
  expect(original.isDestroyed()).toBe(true)
  expect(sources).toEqual(['V01', 'beta01'])
  expect(imageryLayers.get(0).imageryProvider.url).toContain('source=beta01')
  expect(values.get('mars-ctx-source')).toBe('beta01')
  expect(errors).toBe(0)
  imageryLayers.get(0).imageryProvider.errorEvent.raiseEvent({})
  expect(errors).toBe(1)
  dispose()
  imageryLayers.destroy()
})

test('disposing during a pending failover does not create another layer', async () => {
  const imageryLayers = new ImageryLayerCollection()
  const viewer = { imageryLayers, scene: { ellipsoid: Ellipsoid.MARS, requestRender() {} } }
  const sources = []
  const dispose = addCtxLayer(viewer, { onSource: (source) => sources.push(source), onError() {} })
  imageryLayers.get(0).imageryProvider.errorEvent.raiseEvent({})
  dispose()
  await Promise.resolve()
  expect(sources).toEqual(['V01'])
  expect(imageryLayers.length).toBe(1)
  imageryLayers.destroy()
})
