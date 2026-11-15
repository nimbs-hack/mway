import { GeographicTilingScheme, ImageryLayer, UrlTemplateImageryProvider } from 'cesium'
import type { ImageryLayerCollection, Viewer } from 'cesium'
import type { ScienceRaster, ScienceStatus } from './science-types'

type Entry = { layer: ImageryLayer; rank: number }
type Stack = { entries: Set<Entry>; wasLit: boolean; removeAdded: () => void }

// Overlays on one viewer share a stack so their order and the lighting state
// survive any number of overlays and CTX source switches.
const stacks = new WeakMap<ImageryLayerCollection, Stack>()

function restack(collection: ImageryLayerCollection, stack: Stack) {
  for (const entry of [...stack.entries].sort((a, b) => a.rank - b.rank)) collection.raiseToTop(entry.layer)
}

// Science overlays stay above CTX. A higher rank draws above a lower one.
export function addScienceOverlay(viewer: Viewer, source: ScienceRaster, onStatus: (status: ScienceStatus) => void, rank = 0) {
  let disposed = false
  let failed = false
  let pending = 0
  const provider = new UrlTemplateImageryProvider({
    url: source.url,
    tilingScheme: new GeographicTilingScheme({ ellipsoid: viewer.scene.ellipsoid }),
    tileWidth: source.tileSize,
    tileHeight: source.tileSize,
    maximumLevel: source.maxLevel,
    credit: source.credit,
  })
  const requestImage = provider.requestImage.bind(provider)
  provider.requestImage = (...args) => {
    const image = requestImage(...args)
    if (!image) return undefined
    pending++
    if (!disposed && !failed) onStatus('loading')
    return Promise.resolve(image).then((result) => {
      pending--
      if (!disposed && !failed && pending === 0) onStatus('ready')
      return result
    }, (error: unknown) => {
      pending--
      if (!disposed) {
        failed = true
        onStatus('error')
      }
      throw error
    })
  }
  const removeError = provider.errorEvent.addEventListener(() => {
    if (!disposed) {
      failed = true
      onStatus('error')
    }
  })

  const collection = viewer.imageryLayers
  let stack = stacks.get(collection)
  if (!stack) {
    const created: Stack = { entries: new Set(), wasLit: viewer.scene.globe.enableLighting, removeAdded: () => {} }
    created.removeAdded = collection.layerAdded.addEventListener(() => restack(collection, created))
    stacks.set(collection, created)
    stack = created
  }
  const entry = { layer: new ImageryLayer(provider), rank }
  stack.entries.add(entry)
  collection.add(entry.layer)
  viewer.scene.globe.enableLighting = false
  onStatus('loading')
  viewer.scene.requestRender()

  return {
    setOpacity(opacity: number) {
      if (disposed) return
      entry.layer.alpha = Math.min(1, Math.max(0, opacity))
      viewer.scene.requestRender()
    },
    destroy() {
      if (disposed) return
      disposed = true
      removeError()
      const current = stacks.get(collection)
      current?.entries.delete(entry)
      if (current && current.entries.size === 0) {
        current.removeAdded()
        stacks.delete(collection)
      }
      if (!viewer.isDestroyed()) {
        collection.remove(entry.layer, true)
        if (current && current.entries.size === 0) viewer.scene.globe.enableLighting = current.wasLit
        viewer.scene.requestRender()
      }
    },
  }
}
