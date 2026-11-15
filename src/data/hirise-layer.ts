import { GeographicTilingScheme, ImageryLayer, Rectangle, UrlTemplateImageryProvider } from 'cesium'
import type { Viewer } from 'cesium'
import { HIRISE_LAYERS, hiriseTileUrl } from './imagery.js'

// Adds every HiRISE mosaic above the CTX layer. Each one only requests tiles
// inside its own footprint, so the layers cost nothing elsewhere. Missing
// tiles inside a footprint leave CTX showing through. Returns a remover.
export function addHiriseLayers(viewer: Viewer) {
  const tilingScheme = new GeographicTilingScheme({ ellipsoid: viewer.scene.ellipsoid })
  const layers = HIRISE_LAYERS.map(({ id, bounds, maxLevel }) => {
    const provider = new UrlTemplateImageryProvider({
      url: hiriseTileUrl(id),
      tilingScheme,
      maximumLevel: maxLevel,
      rectangle: Rectangle.fromDegrees(...(bounds as [number, number, number, number])),
      credit: 'HiRISE: NASA / JPL / University of Arizona. Tiles: NASA Mars Trek',
    })
    // Below level 10 CTX already shows more than these mosaics would.
    const layer = new ImageryLayer(provider, { minimumTerrainLevel: 10 })
    viewer.imageryLayers.add(layer)
    return layer
  })
  viewer.scene.requestRender()
  return () => {
    if (viewer.isDestroyed()) return
    for (const layer of layers) viewer.imageryLayers.remove(layer, true)
    viewer.scene.requestRender()
  }
}
