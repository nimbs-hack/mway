import { Cartesian3, PostProcessStage, type Viewer } from 'cesium'

// An illustrative dust sky, not a weather or visibility forecast. The depth
// buffer keeps nearby imagery unchanged and blends distant terrain into haze.
const atmosphere = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform vec3 localUp;
in vec2 v_textureCoordinates;

void main() {
    vec2 uv = v_textureCoordinates;
    vec4 source = texture(colorTexture, uv);
    vec4 eyeRay = czm_inverseProjection * vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    vec3 direction = normalize(czm_inverseViewRotation * eyeRay.xyz);
    float elevation = max(dot(direction, localUp), 0.0);
    vec3 horizon = vec3(0.72, 0.56, 0.43);
    vec3 zenith = vec3(0.39, 0.30, 0.24);
    vec3 sky = mix(horizon, zenith, pow(elevation, 0.45));
    float depth = czm_unpackDepth(texture(depthTexture, uv));
    if (depth == 0.0 || depth >= 1.0) {
        out_FragColor = vec4(sky, 1.0);
        return;
    }
    vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
    float distance = length(eye.xyz / eye.w);
    float haze = 1.0 - exp(-max(distance - 100.0, 0.0) / 18000.0);
    out_FragColor = vec4(mix(source.rgb, horizon, min(haze, 0.85)), source.a);
}
`

/** Temporary street-view quality settings. Dispose restores the map exactly. */
export function improveStreetRendering(viewer: Viewer) {
  const { scene } = viewer
  const saved = {
    fxaa: scene.postProcessStages.fxaa.enabled,
    resolution: viewer.resolutionScale,
    recommendedResolution: viewer.useBrowserRecommendedResolution,
    fog: scene.fog.enabled,
    siblings: scene.globe.preloadSiblings,
  }
  const up = new Cartesian3()
  const sky = scene.postProcessStages.add(new PostProcessStage({
    name: 'street-view-atmosphere',
    fragmentShader: atmosphere,
    uniforms: {
      localUp: () => scene.ellipsoid.geodeticSurfaceNormal(viewer.camera.positionWC, up),
    },
  }))
  scene.postProcessStages.fxaa.enabled = true
  // Cap the pixel count on Retina displays while improving ground edges.
  viewer.useBrowserRecommendedResolution = true
  viewer.resolutionScale = Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1))
  // Orbital fog culling removes distant tiles at eye level. The shader draws
  // haze without discarding the terrain that should form the horizon.
  scene.fog.enabled = false
  scene.globe.preloadSiblings = true
  scene.requestRender()
  let disposed = false
  return () => {
    if (disposed || viewer.isDestroyed()) return
    disposed = true
    scene.postProcessStages.remove(sky)
    scene.postProcessStages.fxaa.enabled = saved.fxaa
    viewer.useBrowserRecommendedResolution = saved.recommendedResolution
    viewer.resolutionScale = saved.resolution
    scene.fog.enabled = saved.fog
    scene.globe.preloadSiblings = saved.siblings
    scene.requestRender()
  }
}
