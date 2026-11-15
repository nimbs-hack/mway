import { expect, test } from 'bun:test'
import { Cartesian3, Ellipsoid, type PostProcessStage, type Viewer } from 'cesium'
import { improveStreetRendering } from './street-view-rendering'

test('street quality restores custom map settings and removes only its own stage', () => {
  const stages = new Set<PostProcessStage>()
  const fixture = {
    isDestroyed: () => false,
    resolutionScale: 0.8,
    useBrowserRecommendedResolution: false,
    camera: { positionWC: new Cartesian3(3396190, 0, 0) },
    scene: {
      ellipsoid: new Ellipsoid(3396190, 3396190, 3396190),
      fog: { enabled: true },
      globe: { preloadSiblings: false },
      postProcessStages: {
        fxaa: { enabled: false },
        add(stage: PostProcessStage) { stages.add(stage); return stage },
        remove(stage: PostProcessStage) { stages.delete(stage); stage.destroy() },
      },
      requestRender() {},
    },
  }
  const restore = improveStreetRendering(fixture as unknown as Viewer)
  expect(stages.size).toBe(1)
  expect(fixture.scene.postProcessStages.fxaa.enabled).toBe(true)
  expect(fixture.scene.fog.enabled).toBe(false)
  expect(fixture.scene.globe.preloadSiblings).toBe(true)
  expect(fixture.resolutionScale).toBeGreaterThanOrEqual(1)
  expect(fixture.resolutionScale).toBeLessThanOrEqual(1.5)
  restore()
  restore()
  expect(stages.size).toBe(0)
  expect(fixture.scene.postProcessStages.fxaa.enabled).toBe(false)
  expect(fixture.scene.fog.enabled).toBe(true)
  expect(fixture.scene.globe.preloadSiblings).toBe(false)
  expect(fixture.useBrowserRecommendedResolution).toBe(false)
  expect(fixture.resolutionScale).toBe(0.8)
})
