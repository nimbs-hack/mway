import { GeographicTilingScheme, ImageryLayer, Rectangle, UrlTemplateImageryProvider } from 'cesium'
import type { Viewer } from 'cesium'
import { CTX_LATITUDE_LIMIT, CTX_MAX_LEVEL, CTX_TILE_SIZE, ctxTileUrl } from './ctx.js'

type Source = 'v01' | 'beta01'
type Options = {
  onSource: (source: 'V01' | 'beta01') => void
  onError: () => void
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

// A failed V01 tile switches the entire layer to the older CTX mosaic. Keep
// one mosaic per view, since their registration and brightness can differ.
export function addCtxLayer(viewer: Viewer, { onSource, onError, storage }: Options) {
  try { storage ??= globalThis.sessionStorage } catch { /* Storage is optional. */ }
  let layer: ImageryLayer | undefined
  let removeError: (() => void) | undefined
  let currentSource: Source
  let disposed = false

  function activate(source: Source) {
    currentSource = source
    removeError?.()
    if (layer) viewer.imageryLayers.remove(layer, true)
    const provider = new UrlTemplateImageryProvider({
      url: ctxTileUrl('{z}', '{y}', '{x}', source),
      tilingScheme: new GeographicTilingScheme({ ellipsoid: viewer.scene.ellipsoid }),
      tileWidth: CTX_TILE_SIZE,
      tileHeight: CTX_TILE_SIZE,
      maximumLevel: CTX_MAX_LEVEL,
      rectangle: Rectangle.fromDegrees(-180, -CTX_LATITUDE_LIMIT, 180, CTX_LATITUDE_LIMIT),
      credit: `CTX ${source === 'v01' ? 'V01' : 'beta01'}: NASA / JPL / MSSS / The Murray Lab. Tiles: Esri`,
    })
    layer = new ImageryLayer(provider, { minimumTerrainLevel: 6 })
    viewer.imageryLayers.add(layer)
    removeError = provider.errorEvent.addEventListener(() => {
      if (source === 'beta01') return onError()
      queueMicrotask(() => {
        if (disposed || currentSource !== 'v01') return
        try { storage?.setItem('mars-ctx-source', 'beta01') } catch { /* Storage is optional. */ }
        activate('beta01')
      })
    })
    onSource(source === 'v01' ? 'V01' : 'beta01')
    viewer.scene.requestRender()
  }

  let source: Source = 'v01'
  try { if (storage?.getItem('mars-ctx-source') === 'beta01') source = 'beta01' } catch { /* Storage is optional. */ }
  activate(source)
  return () => {
    disposed = true
    removeError?.()
  }
}
