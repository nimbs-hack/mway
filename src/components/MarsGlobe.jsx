import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  DirectionalLight,
  EasingFunction,
  GeographicTilingScheme,
  HeadingPitchRange,
  HeightReference,
  ImageryLayer,
  ImageryProvider,
  LabelStyle,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { LOCAL_MAX_ZOOM, MAX_NATIVE_ZOOM, localTilePath, proxyTileUrl } from '../data/basemap'
import { SITES } from '../data/sites'
import { DATUM_OFFSET, MARS_SPHERE, createTerrain } from '../data/terrain'
import { FAST_VIEWER_OPTIONS, tuneViewer } from '../data/performance'
import NavControls from './NavControls'
import StreetView, { StreetViewButton } from './StreetView'
import { pickGround, setupControls } from './camera'
import { warmSiteImagery } from '../cache/map-cache'
import { addCtxLayer } from '../data/ctx-layer.ts'
import { addRouteOverlay } from './route-overlay.ts'
import { SAMPLED_RASTERS, SCIENCE_LAYERS, SCIENCE_RASTERS } from '../data/science-layers'
import { addScienceOverlay } from '../data/science-overlay'
import { distance, resample } from '../data/geo'
import { buildProfile, slopeLevel, summarize } from '../data/route-profile'
import { DEFAULT_LIMITS, EMPTY_PLAN, SUIT, assess, withReasons, withMissionSites, insertWaypoint, isGenerated, moveVertex, planPath, removeWaypoint, stopPath, stopsOnly } from '../data/plan'
import { planStops } from '../data/stops'
import { addPlanOverlay } from './plan-overlay'
import { buildGrid } from '../data/route-options'
import RouteOptions from './RouteOptions'
import { formatDistance } from './RouteProfile'
import { STATIONS, fetchWeather, formatPressure, formatTemp, nearestStation, pressureAt } from '../data/weather'
import { COARSE_DETAIL, coverage, detailAt, detailLabel, detailMeters, levelAt, levelForSpacing, outline, slopeBaseline } from '../data/terrain-detail'
import { checkSpaceWeather, fetchSpaceWeather } from '../data/space-weather'
import { assessStart, bestOf } from '../data/eva-window'
import { windowsByDate } from '../data/eva-calendar'

import { TERRAIN_API_PATH } from '../data/terrain-source'
import { addToolOverlay } from './tool-overlay'
import { addMarker as addMapMarker, loadMarkers, removeMarker, saveMarkers, updateMarker } from '../data/markers'
import LayerSwitcher from './LayerSwitcher'
import MapTools, { ToolButtons } from './MapTools'
import { sampleRaster } from '../data/raster-sample'
import { sampleElevations, sampleSurface } from '../data/terrain-sample'
import { loadRouteField } from '../data/route-field'
import { createRouteFields } from '../data/route-fields'
import { createRouteSearch } from '../data/route-search'
import { useWindowSearch } from '../data/use-window-search'
import { GROUND_RADIUS, sampleGround } from '../data/ground'
import RouteProfile from './RouteProfile'
import PointReadout from './PointReadout'
import SuitView, { PLAY_TICK_MS } from './SuitView'
import PlanPanel from './PlanPanel'
import { EVA_START_EVENT, loadEva, saveEva } from '../data/eva-storage'
import { hudRoute, saveHud } from '../data/hud-snapshot'
import MapLabels from './MapLabels'
import { StageIcon } from './icons'
import { createCrewSimulation } from '../data/crew-simulation'

// Sols the EVA start calendar searches, about six weeks.
const CALENDAR_SOLS = 42

const MARS = MARS_SPHERE
const ROVERS = SITES.filter((s) => s.traverse)
const OBSERVATIONS = SCIENCE_LAYERS.filter((layer) => layer.kind === 'observation')
// The profile keeps the footing lane that changes along a walk.
const PROFILE_RASTERS = SAMPLED_RASTERS.filter((layer) => layer.id === 'mola-roughness')
const RADIATION = OBSERVATIONS.find((record) => record.category === 'radiation')
// Finer layers draw above coarser ones.
const RANK = ['tes-albedo', 'mola-roughness', 'mola-color', 'geology', 'themis-day', 'themis-night']
// Every overlay starts off. Two that were on by default made up half of the
// tile requests of a zoom, and held back the imagery and terrain under them.
// The layer switcher turns them on.
const DEFAULT_OVERLAYS = Object.fromEntries(SCIENCE_RASTERS.map((layer) => [layer.id, {
  on: false,
  opacity: layer.id === 'mola-color' ? 0.45 : 0.6,
}]))
// A new start this far from the old target starts a new plan.
const NEW_PLAN_DISTANCE = 20_000
const HOVER_MS = 50

// The entity under a screen position. Cesium's pick throws while the camera
// is degenerate, mid-flight or with the canvas at zero size. Hovering runs
// it on every move, so a throw there would repeat on every move too.
function pickEntity(viewer, position) {
  try {
    return viewer.scene.pick(position)?.id
  } catch {
    return undefined
  }
}

function samePoints(a, b) {
  return a.length === b.length && a.every((point, i) => point[0] === b[i][0] && point[1] === b[i][1])
}

// Opening view looks at Tharsis and Valles Marineris, where the relief is
// easiest to see.
const HOME = { lon: -85, lat: 0, height: 9_000_000 }
const SITE_RANGE = 120_000
const FLY_PITCH = CesiumMath.toRadians(-35)
const RELIEF_STEPS = [1, 3]
// The suit view looks down at the walker from behind at this angle, from at
// least this far.
const WALK_PITCH = CesiumMath.toRadians(-35)
const WALK_RANGE = 900
const WALK_HEADROOM = 1.15

// Light comes from the top left of the screen, low over the horizon, the
// convention for shaded relief maps. Low light makes slopes cast contrast.
const LIGHT_ELEVATION = CesiumMath.toRadians(35)
const LABEL_FONT = '600 12px Inter, system-ui, sans-serif'

function cssValue(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function cssColor(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return Color.fromCssColorString(value)
}

// Rendered height for a terrain height, after the elevation scale.
function exaggerate(scene, height) {
  const base = scene.verticalExaggerationRelativeHeight
  return (height - base) * scene.verticalExaggeration + base
}

// Camera framing uses already loaded terrain. It must not wait on network
// elevation samples before the flight can even begin.
function surfacePoints(viewer, latLons) {
  const points = latLons.map(([lat, lon]) => Cartographic.fromDegrees(lon, lat, DATUM_OFFSET))
  return points.map((p) => {
    p.height = viewer.scene.globe.getHeight(p) ?? exaggerate(viewer.scene, DATUM_OFFSET)
    return Cartographic.toCartesian(p, MARS)
  })
}

// Points the light so it falls from the top left of the screen at
// LIGHT_ELEVATION above the local horizon, whichever way the camera faces.
const lightScratch = { up: new Cartesian3(), forward: new Cartesian3(), right: new Cartesian3(), tmp: new Cartesian3() }
function aimLight(scene) {
  const { camera } = scene
  const { up, forward, right, tmp } = lightScratch
  MARS.geodeticSurfaceNormal(camera.positionWC, up)

  // The direction toward the top of the screen, flattened onto the ground.
  const flatten = (v) => Cartesian3.subtract(v, Cartesian3.multiplyByScalar(up, Cartesian3.dot(v, up), tmp), forward)
  flatten(camera.directionWC)
  if (Cartesian3.magnitude(forward) < 0.2) flatten(camera.upWC)
  Cartesian3.normalize(forward, forward)
  Cartesian3.cross(forward, up, right)

  const toLight = Cartesian3.subtract(forward, right, tmp)
  Cartesian3.normalize(toLight, toLight)
  Cartesian3.multiplyByScalar(toLight, Math.cos(LIGHT_ELEVATION), toLight)
  Cartesian3.add(toLight, Cartesian3.multiplyByScalar(up, Math.sin(LIGHT_ELEVATION), right), toLight)
  Cartesian3.negate(toLight, scene.light.direction)
  Cartesian3.normalize(scene.light.direction, scene.light.direction)
}

// Terrain at this tile level or deeper counts as fine and gets an outline.
// Level 15 is about 5 m between samples.
const FINE_LEVEL = 15

// Each weather station sits at its rover's last reported position.
const STATION_POSITIONS = Object.fromEntries(STATIONS.map(({ id, siteId }) => [id, SITES.find((s) => s.id === siteId).traverse.position]))
// The rovers report once a sol. Refetch hourly so a long session stays current.
const WEATHER_REFRESH = 3_600_000

// Ground anchors for the symbols drawn in the shared callout layer.
function syncMarkers(viewer, entities, markers) {
  for (const entity of entities.values()) viewer.entities.remove(entity)
  entities.clear()
  const text = cssValue('--color-text')
  const bg = cssValue('--color-bg')
  for (const m of markers) {
    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(m.point[1], m.point[0], 0, MARS),
      point: {
        pixelSize: 6,
        color: Color.fromCssColorString(text),
        outlineColor: Color.fromCssColorString(bg),
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    entity.markerId = m.id
    entities.set(m.id, entity)
  }
  viewer.scene.requestRender()
}

// Canvas position of a ground point, or null when it's out of view.
function screenOf(viewer, [lat, lon]) {
  const location = Cartographic.fromDegrees(lon, lat, DATUM_OFFSET)
  location.height = viewer.scene.globe.getHeight(location) ?? DATUM_OFFSET
  const at = viewer.scene.cartesianToCanvasCoordinates(Cartographic.toCartesian(location, MARS))
  return at ? { x: at.x, y: at.y } : null
}

function flyHome(viewer) {
  viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height, MARS) })
}

// Frames a route segment from above. Sampled elevations, when given, put the
// camera target on the real ground instead of whatever terrain has loaded.
function flyToPath(viewer, path, samples) {
  const points = samples
    ? samples.filter((s) => s.elevation !== null).map((s) => Cartographic.toCartesian(
      Cartographic.fromDegrees(s.point[1], s.point[0], exaggerate(viewer.scene, s.elevation + DATUM_OFFSET)), MARS))
    : surfacePoints(viewer, path.filter((_, i) => i % 5 === 0).concat([path.at(-1)]))
  if (points.length === 0) return
  const sphere = BoundingSphere.fromPoints(points)
  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-60), Math.max(sphere.radius * 7, 6500)),
  })
}

// Close enough to see boulder-scale imagery around a planned start.
function flyToPoint(viewer, point, range = 6000) {
  const [target] = surfacePoints(viewer, [point])
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 1), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-60), range),
  })
}

function flyToSite(viewer, site) {
  if (site.traverse) {
    // Every 25th point is plenty to bound the route.
    const path = site.traverse.path.filter((_, i) => i % 25 === 0).concat([site.traverse.position])
    const sphere = BoundingSphere.fromPoints(surfacePoints(viewer, path))
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new HeadingPitchRange(0, FLY_PITCH, Math.max(sphere.radius * 3, 20_000)),
    })
  } else {
    const [point] = surfacePoints(viewer, [[site.lat, site.lon]])
    viewer.camera.flyToBoundingSphere(new BoundingSphere(point, 1), {
      offset: new HeadingPitchRange(0, FLY_PITCH, SITE_RANGE),
    })
  }
}

function createViewer(container, ctxOptions) {
  const terrain = createTerrain()
  const imagery = new UrlTemplateImageryProvider({
    url: proxyTileUrl('{z}', '{y}', '{x}'),
    tilingScheme: new GeographicTilingScheme({ ellipsoid: MARS }),
    maximumLevel: MAX_NATIVE_ZOOM,
    credit: 'Viking MDIM 2.1 color mosaic: NASA / JPL-Caltech / USGS',
  })
  // Low zoom levels ship with the app in public/tiles. Cesium URL-encodes
  // template values, so the local paths are swapped in here instead.
  const requestRemote = imagery.requestImage.bind(imagery)
  imagery.requestImage = (x, y, level, request) =>
    level <= LOCAL_MAX_ZOOM
      ? ImageryProvider.loadImage(imagery, import.meta.env.BASE_URL + localTilePath(level, y, x))
      : requestRemote(x, y, level, request)

  const viewer = new Viewer(container, {
    ellipsoid: MARS,
    baseLayer: new ImageryLayer(imagery),
    terrain,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    skyBox: false,
    skyAtmosphere: false,
    // Sources are credited in the status bar.
    creditContainer: document.createElement('div'),
    ...FAST_VIEWER_OPTIONS,
  })

  const stopCtx = addCtxLayer(viewer, ctxOptions)

  const { scene } = viewer
  scene.backgroundColor = cssColor('--color-bg')
  scene.globe.showGroundAtmosphere = false
  scene.globe.baseColor = cssColor('--color-surface')
  scene.globe.enableLighting = true
  // Let terrain hide markers and labels on slopes and the far side of Mars.
  scene.globe.depthTestAgainstTerrain = true
  // Coarser tiles while the camera makes a big zoom, a larger tile cache,
  // and the rest of what keeps drawing cheap. See src/data/performance.js.
  const stopRefinement = tuneViewer(viewer)
  scene.globe.dynamicAtmosphereLighting = false
  scene.light = new DirectionalLight({ direction: new Cartesian3(0, 0, -1), intensity: 2 })
  scene.preUpdate.addEventListener(() => aimLight(scene))
  // Scale elevation around the areoid, not around Trek's shifted zero.
  scene.verticalExaggerationRelativeHeight = DATUM_OFFSET
  viewer.camera.percentageChanged = 0.01
  const stopControls = setupControls(viewer)
  viewer.camera.setView({ destination: Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height, MARS) })

  return { viewer, imagery, terrain, stopCtx, stopRefinement, stopControls }
}

function addSites(viewer) {
  const text = cssColor('--color-text')
  const panel = cssColor('--color-surface')

  for (const s of ROVERS) {
    const [lat, lon] = s.traverse.position
    viewer.entities.add({
      position: Cartesian3.fromDegrees(lon, lat, 0, MARS),
      point: {
        pixelSize: 9,
        color: text,
        outlineColor: text,
        outlineWidth: 1.5,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 0,
      },
    })
  }

  const labels = new Map()
  for (const s of SITES) {
    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(s.lon, s.lat, 0, MARS),
      point: {
        pixelSize: 8,
        color: s.ended ? panel : text,
        outlineColor: text,
        outlineWidth: 1.5,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 0,
      },
      label: {
        text: s.traverse ? `${s.name} · sol ${s.traverse.lastSol}` : s.name,
        show: false,
        font: LABEL_FONT,
        fillColor: text,
        style: LabelStyle.FILL,
        showBackground: true,
        backgroundColor: panel,
        backgroundPadding: new Cartesian2(8, 4),
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -12),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 0,
      },
    })
    entity.siteId = s.id
    labels.set(s.id, entity.label)
  }
  return labels
}

// One science overlay on the globe. Renders nothing itself.
function ScienceOverlay({ viewer, source, opacity, attempt, onStatus }) {
  const overlay = useRef(null)
  useEffect(() => {
    const created = addScienceOverlay(viewer, source, (status) => onStatus(source.id, status), RANK.indexOf(source.id))
    overlay.current = created
    return () => {
      overlay.current = null
      created.destroy()
      onStatus(source.id, 'idle')
    }
  }, [viewer, source, attempt, onStatus])
  useEffect(() => {
    overlay.current?.setOpacity(opacity)
  }, [opacity, attempt])
  return null
}

// deploy-v1's profile hover dot: a 10 px text-colored square in a 2 px
// accent border. Square, since nothing on the map has rounded corners.
function squareMarkerImage() {
  const canvas = document.createElement('canvas')
  canvas.width = 14
  canvas.height = 14
  const context = canvas.getContext('2d')
  context.fillStyle = cssValue('--color-accent')
  context.fillRect(0, 0, 14, 14)
  context.fillStyle = cssValue('--color-text')
  context.fillRect(2, 2, 10, 10)
  return canvas
}

// The walker in the suit view: a standing figure, light on a dark outline so
// it shows on any ground. Its feet are on the position.
function walkerMarkerImage() {
  const canvas = document.createElement('canvas')
  canvas.width = 30
  canvas.height = 40
  const context = canvas.getContext('2d')
  context.lineCap = 'round'
  context.lineJoin = 'round'
  const figure = () => {
    context.beginPath()
    context.arc(15, 8, 4.5, 0, Math.PI * 2)
    context.moveTo(15, 13)
    context.lineTo(15, 25)
    context.moveTo(6, 18)
    context.lineTo(24, 18)
    context.moveTo(15, 25)
    context.lineTo(8, 37)
    context.moveTo(15, 25)
    context.lineTo(22, 37)
  }
  figure()
  context.strokeStyle = cssValue('--color-bg')
  context.lineWidth = 8
  context.stroke()
  figure()
  context.strokeStyle = cssValue('--color-accent')
  context.lineWidth = 5
  context.stroke()
  figure()
  context.strokeStyle = cssValue('--color-text')
  context.lineWidth = 2.5
  context.stroke()
  return canvas
}

function addMarker(viewer) {
  const marker = viewer.entities.add({
    show: false,
    position: Cartesian3.ZERO,
    billboard: {
      image: squareMarkerImage(),
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })
  marker.looks = { dot: marker.billboard.image, walker: walkerMarkerImage() }
  return marker
}

function placeMarker(viewer, marker, point, walking = false) {
  if (!viewer || !marker) return
  marker.show = Boolean(point)
  marker.billboard.image = walking ? marker.looks.walker : marker.looks.dot
  marker.billboard.verticalOrigin = walking ? VerticalOrigin.BOTTOM : VerticalOrigin.CENTER
  if (point) {
    const location = Cartographic.fromDegrees(point[1], point[0], DATUM_OFFSET)
    location.height = viewer.scene.globe.getHeight(location) ?? exaggerate(viewer.scene, DATUM_OFFSET)
    marker.position = Cartographic.toCartesian(location, MARS)
  }
  viewer.scene.requestRender()
}

// Camera behind the walker, looking along the heading, with the walker in
// the middle of the view. During playback the move takes one playback step
// at an even speed, so steps join into one walk.
//
// The camera aims at the ground under the walker. `elevation` is the sampled
// height there, in meters above the areoid. Without it the aim falls back to
// loaded terrain and then to the datum, which in a crater is kilometers above
// the floor and leaves the walker below the bottom of the screen.
function followWalker(viewer, point, heading, playing, elevation) {
  const location = Cartographic.fromDegrees(point[1], point[0], DATUM_OFFSET)
  location.height = elevation === null || elevation === undefined
    ? viewer.scene.globe.getHeight(location) ?? exaggerate(viewer.scene, DATUM_OFFSET)
    : exaggerate(viewer.scene, elevation + DATUM_OFFSET)
  const target = Cartographic.toCartesian(location, MARS)
  // The camera may not come closer to the ground than the zoom limit, which
  // keeps imagery from being magnified into a blur. Asked to, it is pushed
  // back up after the move and the walker drops off the bottom of the
  // screen. So stand far enough back to be above the limit, with headroom
  // for ground that rises behind the walker.
  const floor = viewer.scene.screenSpaceCameraController.minimumZoomDistance * WALK_HEADROOM
  const range = Math.max(WALK_RANGE, floor / Math.sin(-WALK_PITCH))
  viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 1), {
    offset: new HeadingPitchRange(CesiumMath.toRadians(heading ?? 0), WALK_PITCH, range),
    duration: playing ? PLAY_TICK_MS / 1000 : 0.6,
    easingFunction: playing ? EasingFunction.LINEAR_NONE : undefined,
  })
}

/*
 * `mission` ties the map to the mission being planned. It is optional:
 *   { crew, sites, taskCounts, selected, onSelect(index), onAddSite([lat, lon]),
 *     onAddEva({ target, seconds, distance, maxSlope, verdict }) }
 * Sites are { name, lat, lon, info } in planetocentric latitude and east
 * longitude, -180 to 180. They are drawn as numbered markers. The EVA route
 * runs through the plan, `mission.route`: site positions in visiting order,
 * where the first is the start, the last the target and the rest stops. A
 * mission without a plan visits its sites in list order. Add EVA to mission records the walk as a task at
 * the target site. `mission.flag` puts a caution dot on the Sites plan tab.
 * `missionPanel` renders the mission's sites as a tab of the plan
 * panel and gets { placing, onPlacing } to drive the map from it. While
 * placing is 'site' every click adds a site, until Esc or onPlacing(null).
 * `missionPlan` is the Plan tab, where `mission.route` is edited.
 */
export default function MarsGlobe({ site, onSite, onStatus, onImagerySource, onScienceSource, onViewer, onRoute, mission = null, missionPanel = null, missionPlan = null }) {
  const container = useRef(null)
  const [viewer, setViewer] = useState(null)
  const labels = useRef(null)
  const [relief, setRelief] = useState(RELIEF_STEPS[1])
  // False until the first tiles are on screen. Until then the map is black.
  const [planetShown, setPlanetShown] = useState(false)
  const [imagerySource, setImagerySource] = useState('v01')
  const [overlays, setOverlays] = useState(DEFAULT_OVERLAYS)
  const [statuses, setStatuses] = useState({})
  const [attempts, setAttempts] = useState({})
  const [probe, setProbe] = useState(null)
  // Terrain and night IR on a grid around start and target, for route suggestions.
  const [routeField, setRouteField] = useState({ status: 'idle' })
  const [routeAttempt, setRouteAttempt] = useState(0)
  const [routeHover, setRouteHover] = useState(null)
  // Tooltip for the suggested route line under the pointer.
  const [lineTip, setLineTip] = useState(null)
  // Station reports by id: a report, 'error', or missing while loading.
  const [weather, setWeather] = useState({})
  const [stationElevation, setStationElevation] = useState({})
  const [localMarkers, setLocalMarkers] = useState(loadMarkers)
  const markers = mission ? mission.markers : localMarkers
  const setMarkers = (change) => {
    if (mission) mission.onMarkers(change(markers))
    else setLocalMarkers(change)
  }
  const [spaceWeather, setSpaceWeather] = useState({ status: 'loading', data: null })
  // Minute clock for time-relative checks such as CME arrivals.
  const [clock, setClock] = useState(() => Date.now())
  const markerEntities = useRef(new Map())
  const [sampledProfile, setProfile] = useState({ status: 'idle', samples: null })
  const [profileAttempt, setProfileAttempt] = useState(0)
  const [profileOpen, setProfileOpen] = useState(true)
  const [hoverIndex, setHoverIndex] = useState(null)
  const [suit, setSuit] = useState(null)
  // null, 'pick' after a click on the rail button, or the drop point of a drag.
  const [street, setStreet] = useState(null)
  const streetButton = useRef(null)
  const exitStreet = useCallback(() => setStreet(null), [])
  const wasStreet = useRef(false)
  const openStreet = (mode) => {
    setPlacing(null)
    setTool(null)
    setSuit(null)
    setProbe(null)
    setLineTip(null)
    setHoverIndex(null)
    setStreet(mode)
  }
  useEffect(() => {
    if (!street && wasStreet.current) streetButton.current?.focus()
    wasStreet.current = street
  }, [street])
  const [saved] = useState(() => loadEva(mission?.id))
  const [plan, setPlan] = useState(saved.plan)
  const [limits, setLimits] = useState(saved.limits)
  // What the next map click does: 'waypoint', 'site' or null to probe.
  const [placing, setPlacingState] = useState(null)
  // Map tool in use: 'ruler', 'range', 'sight' or null. It takes map clicks
  // the way placement does, so turning one on turns the other off.
  const [tool, setToolState] = useState(null)
  const toolClickRef = useRef(null)
  const setPlacing = useCallback((mode) => {
    setPlacingState(mode)
    if (typeof mode === 'string') setToolState(null)
  }, [])
  const setTool = useCallback((id) => {
    setToolState(id)
    if (id) setPlacingState(null)
  }, [])
  const marker = useRef(null)
  const planOverlay = useRef(null)
  const [terrainProvider, setTerrainProvider] = useState(null)
  const onLayerStatus = useCallback((id, status) => setStatuses((current) => (current[id] === status ? current : { ...current, [id]: status })), [])

  // Event handlers registered once read the latest props through refs.
  const onSiteRef = useRef(onSite)
  const onStatusRef = useRef(onStatus)
  const onImagerySourceRef = useRef(onImagerySource)
  const onMapClickRef = useRef(null)
  const onContextRef = useRef(null)
  const onLineRef = useRef(null)
  const onMoveVertexRef = useRef(null)
  const placingRef = useRef(placing)
  const toolRef = useRef(tool)
  const missionRef = useRef(mission)
  missionRef.current = mission
  onSiteRef.current = onSite
  onStatusRef.current = onStatus
  onImagerySourceRef.current = onImagerySource
  placingRef.current = placing
  toolRef.current = tool

  useEffect(() => {
    let failed = false
    const markFailed = () => {
      failed = true
      onStatusRef.current('error')
    }
    const { viewer, imagery, terrain, stopCtx, stopRefinement, stopControls } = createViewer(container.current, {
      onSource: (source) => {
        setImagerySource(source === 'V01' ? 'v01' : 'beta01')
        onImagerySourceRef.current(source)
      },
      onError: markFailed,
    })
    labels.current = addSites(viewer)
    marker.current = addMarker(viewer)
    // Sampling must wait for the real terrain. Until then the viewer holds a
    // flat placeholder that would report every point at the datum.
    if (terrain.ready) setTerrainProvider(terrain.provider)
    const removeTerrainReady = terrain.readyEvent.addEventListener((provider) => setTerrainProvider(provider))
    const stopRoutes = addRouteOverlay(viewer, ROVERS.map((s) => s.traverse.path),
      cssColor('--color-text-dim').toCssColorString(), cssColor('--color-bg').toCssColorString())
    planOverlay.current = addPlanOverlay(viewer, {
      text: cssColor('--color-text').toCssColorString(),
      bg: cssColor('--color-bg').toCssColorString(),
      surface: cssColor('--color-surface').toCssColorString(),
      dim: cssColor('--color-text-dim').toCssColorString(),
      hazard: cssColor('--color-hazard').toCssColorString(),
      accent: cssColor('--color-accent').toCssColorString(),
      ok: cssColor('--color-ok').toCssColorString(),
    })
    const removeImageryError = imagery.errorEvent.addEventListener(markFailed)
    const removeTerrainError = terrain.errorEvent.addEventListener(markFailed)
    const removeProgress = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
      if (queued > 0) {
        onStatusRef.current('loading')
      } else {
        onStatusRef.current(failed ? 'error' : 'ready')
        setPlanetShown(true)
      }
    })

    const toLatLon = (position) => {
      const hit = pickGround(viewer, position)
      if (!hit) return null
      const c = MARS.cartesianToCartographic(hit)
      return [CesiumMath.toDegrees(c.latitude), CesiumMath.toDegrees(c.longitude)]
    }

    // Dragging a plan handle. A press on a handle swallows the click that
    // follows, so letting go never also places or probes a point.
    const controls = viewer.scene.screenSpaceCameraController
    let drag = null
    let swallowClick = false
    let cursor = ''
    const setCursor = (next) => {
      if (next === cursor) return
      cursor = next
      viewer.container.style.cursor = next
    }

    let hovered = null
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(({ position }) => {
      const index = planOverlay.current.handleAt(position)
      swallowClick = index !== null
      if (index === null) return
      drag = { index, point: null }
      controls.enableInputs = false
      setCursor('grabbing')
    }, ScreenSpaceEventType.LEFT_DOWN)
    handler.setInputAction(() => {
      if (!drag) return
      if (drag.point) onMoveVertexRef.current(drag.index, drag.point)
      planOverlay.current.drag(null)
      drag = null
      controls.enableInputs = true
      setCursor('')
    }, ScreenSpaceEventType.LEFT_UP)
    handler.setInputAction(({ position }) => {
      if (swallowClick) {
        swallowClick = false
        return
      }
      const free = !placingRef.current && !toolRef.current
      // Clicking a suggested route's line picks it, as on deploy-v1.
      const line = free ? planOverlay.current.alternativeAt(position) : null
      if (line) return onLineRef.current({ id: line, pick: true })
      const picked = free ? viewer.scene.pick(position)?.id : null
      if (picked?.missionIndex !== undefined) return missionRef.current?.onSelect(picked.missionIndex)
      const id = picked?.siteId ?? null
      onMapClickRef.current({ siteId: id, point: id ? null : toLatLon(position) })
    }, ScreenSpaceEventType.LEFT_CLICK)
    // Right click opens the point menu. Right drag still tilts the camera:
    // Cesium only reports a click when the pointer didn't move.
    handler.setInputAction(({ position }) => {
      const markerId = viewer.scene.pick(position)?.id?.markerId ?? null
      const point = toLatLon(position)
      if (point || markerId) onContextRef.current({ point, markerId, screen: { x: position.x, y: position.y } })
    }, ScreenSpaceEventType.RIGHT_CLICK)
    const noMenu = (event) => event.preventDefault()
    viewer.scene.canvas.addEventListener('contextmenu', noMenu)
    // Moving the map leaves the menu pointing at the wrong spot, so close it.
    const removeMoveClose = viewer.camera.moveStart.addEventListener(() => onContextRef.current(null))
    // Hovering picks against the scene, which is a draw and a read back
    // from the GPU. A mouse sends hundreds of moves a second, so only the
    // latest one is looked at, every HOVER_MS.
    let hoverAt = null
    let hoverTimer
    const hover = () => {
      hoverTimer = undefined
      if (drag || viewer.isDestroyed()) return
      const endPosition = hoverAt
      const overHandle = planOverlay.current.handleAt(endPosition) !== null
      const free = !placingRef.current && !toolRef.current
      const line = !overHandle && free ? planOverlay.current.alternativeAt(endPosition) : null
      onLineRef.current(line ? { id: line, x: endPosition.x, y: endPosition.y } : null)
      const under = overHandle || line ? null : pickEntity(viewer, endPosition)
      const id = under?.siteId ?? null
      const overMission = free && under?.missionIndex !== undefined
      setCursor(overHandle ? 'grab' : id || line || overMission ? 'pointer' : placingRef.current || toolRef.current ? 'crosshair' : '')
      if (id === hovered) return
      hovered = id
      viewer.scene.requestRender()
      for (const [siteId, label] of labels.current) label.show = siteId === id || label.pinned === true
    }
    handler.setInputAction(({ endPosition }) => {
      if (drag) {
        const point = toLatLon(endPosition)
        if (point) {
          drag.point = point
          planOverlay.current.drag(drag.index, point)
        }
        return
      }
      hoverAt = Cartesian2.clone(endPosition, hoverAt ?? new Cartesian2())
      hoverTimer ??= setTimeout(hover, HOVER_MS)
    }, ScreenSpaceEventType.MOUSE_MOVE)

    // Lets the browser console poke at the scene while developing.
    if (import.meta.env.DEV) window.viewer = viewer

    setViewer(viewer)
    return () => {
      removeImageryError()
      stopCtx()
      removeTerrainError()
      removeTerrainReady()
      setTerrainProvider(null)
      removeProgress()
      stopRefinement()
      stopControls()
      stopRoutes()
      viewer.scene.canvas.removeEventListener('contextmenu', noMenu)
      removeMoveClose()
      clearTimeout(hoverTimer)
      planOverlay.current.destroy()
      planOverlay.current = null
      handler.destroy()
      viewer.destroy()
      setViewer(null)
    }
  }, [])

  useEffect(() => {
    if (!viewer) return
    for (const [id, label] of labels.current) {
      label.pinned = id === site?.id
      label.show = label.pinned
    }
    if (site) flyToSite(viewer, site)
    else flyHome(viewer)
  }, [viewer, site])

  useEffect(() => {
    if (viewer && site) return warmSiteImagery(viewer, site, imagerySource)
  }, [viewer, site, imagerySource])

  useEffect(() => {
    if (!viewer) return
    viewer.scene.verticalExaggeration = relief
    viewer.scene.requestRender()
  }, [viewer, relief])

  // Mission ground pins. MapLabels places their names and task counts in
  // shared screen-space rows, with leaders back to these coordinates.
  const missionSites = mission?.sites
  const missionCounts = mission?.taskCounts
  const missionSelected = mission?.selected ?? -1
  useEffect(() => {
    if (!viewer || !missionSites) return
    const text = cssColor('--color-text')
    const panel = cssColor('--color-surface')
    const accent = cssColor('--color-accent')
    const added = missionSites.flatMap((entry, index) => {
      if (Number.isNaN(entry.lat + entry.lon)) return []
      const selected = index === missionSelected
      const entity = viewer.entities.add({
        position: Cartesian3.fromDegrees(entry.lon, entry.lat, 0, MARS),
        point: {
          pixelSize: selected ? 16 : 11,
          color: selected ? accent : text,
          outlineColor: selected ? text : panel,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: 0,
        },
      })
      entity.missionIndex = index
      return [entity]
    })
    viewer.scene.requestRender()
    return () => {
      if (viewer.isDestroyed()) return
      for (const entity of added) viewer.entities.remove(entity)
    }
  }, [viewer, missionSites, missionSelected])

  // Bring a mission site picked in the list into view. A site already on
  // screen stays where it is, so adding one from the map does not move the map.
  useEffect(() => {
    const target = missionSites?.[missionSelected]
    if (!viewer || !target || Number.isNaN(target.lat + target.lon)) return
    const [ground] = surfacePoints(viewer, [[target.lat, target.lon]])
    const at = viewer.scene.cartesianToCanvasCoordinates(ground)
    const { clientWidth, clientHeight } = viewer.scene.canvas
    // From orbit a point on the far side of Mars still projects onto the
    // canvas, so only a close camera counts the site as in view.
    const close = viewer.camera.positionCartographic.height < SITE_RANGE
    if (close && at && at.x > 0 && at.y > 0 && at.x < clientWidth && at.y < clientHeight) return
    flyToPoint(viewer, [target.lat, target.lon], 40_000)
  }, [viewer, missionSelected])

  // The status bar reads the camera and cursor from the same viewer.
  useEffect(() => {
    onViewer?.(viewer)
  }, [viewer, onViewer])

  const activeRasters = useMemo(() => SCIENCE_RASTERS.filter((layer) => overlays[layer.id]?.on), [overlays])

  useEffect(() => {
    onScienceSource?.([...new Set(activeRasters.map((layer) => layer.credit))].join(' · '))
  }, [activeRasters, onScienceSource])

  useEffect(() => {
    onRoute?.({ start: plan.start !== null, target: plan.target !== null })
  }, [onRoute, plan.start, plan.target])

  useEffect(() => {
    saveEva(mission?.id, { plan, limits })
  }, [mission?.id, plan, limits])

  // The Review page can set the EVA start while this map stays open.
  useEffect(() => {
    const onStart = (event) => {
      if (event.detail.missionId === mission?.id) setPlan((current) => ({ ...current, when: event.detail.when }))
    }
    window.addEventListener(EVA_START_EVENT, onStart)
    return () => window.removeEventListener(EVA_START_EVENT, onStart)
  }, [mission?.id])

  // Route from start through waypoints to target, once both ends exist.
  const routePath = useMemo(() => {
    const path = planPath(plan)
    return plan.start && plan.target ? path : null
  }, [plan.start, plan.target, plan.waypoints])
  const profile = useMemo(() => sampledProfile.path === routePath ? sampledProfile : { status: routePath ? 'loading' : 'idle', samples: null }, [sampledProfile, routePath])

  const crewStarted = useRef(performance.now() / 1000)
  const crewSite = missionSites?.[missionSelected] ?? missionSites?.[0]
  const crewAnchor = plan.start ?? (site ? site.traverse?.position ?? [site.lat, site.lon]
    : crewSite ? [crewSite.lat, crewSite.lon] : ROVERS[0].traverse.position)
  const crewLabels = useMemo(() => createCrewSimulation(mission?.crew ?? [], routePath, crewAnchor).map((track, index) => {
    const positionAt = (seconds) => track.positionAt(seconds - crewStarted.current)
    return {
      id: track.id,
      kind: 'crew',
      portrait: mission.crew[index].photo,
      text: track.name,
      point: positionAt(performance.now() / 1000),
      positionAt,
    }
  }), [mission?.crew, routePath, crewAnchor[0], crewAnchor[1], viewer])

  const fitCrew = () => {
    if (!viewer || !crewLabels.length) return
    const seconds = performance.now() / 1000
    const positions = crewLabels.map((member) => member.positionAt(seconds))
    const terrainLoaded = positions.every(([lat, lon]) => viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat)) !== undefined)
    const sphere = BoundingSphere.fromPoints(surfacePoints(viewer, positions))
    viewer.camera.flyToBoundingSphere(sphere, {
      // Leave room for terrain that has not loaded during a flight from orbit.
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-60), Math.max(sphere.radius * 5, terrainLoaded ? 1000 : 6000)),
    })
  }

  // Sample the layers shown in the profile. Other layers are read on demand
  // by the point menu. Long routes sample coarser terrain tiles.
  useEffect(() => {
    setHoverIndex(null)
    if (!terrainProvider || !routePath) {
      setProfile({ path: routePath, status: routePath ? 'loading' : 'idle', samples: null })
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    setProfile({ path: routePath, status: 'loading', samples: null })
    // Sample at the finest terrain anywhere on the route. Where the route
    // leaves it, sampling falls back to coarser levels and the legs say so.
    const finest = Math.max(9, ...resample(routePath, 24).map(({ point }) => levelAt(terrainProvider, point) ?? 9))
    const level = Math.min(17, finest)
    const timer = setTimeout(() => {
      buildProfile(routePath, {
        provider: terrainProvider,
        rasters: PROFILE_RASTERS,
        count: 200,
        level,
        baseline: slopeBaseline(detailMeters(level)),
        detail: (point) => detailAt(terrainProvider, point),
        signal,
        ground: (points) => sampleGround(points, { signal }),
      }).then((samples) => {
        if (signal.aborted) return
        const known = samples.some((s) => s.elevation !== null)
        setProfile({ path: routePath, status: known ? 'ready' : 'error', samples })
      }, () => {
        if (!signal.aborted) setProfile({ path: routePath, status: 'error', samples: null })
      })
    }, 100)
    return () => { clearTimeout(timer); controller.abort() }
  }, [terrainProvider, routePath, profileAttempt])

  useEffect(() => {
    if (routePath) setProfileOpen(true)
  }, [routePath])

  const summary = useMemo(() => (profile.samples ? summarize(profile.samples) : null), [profile.samples])
  const doseRate = RADIATION?.measurements[0]?.unit === 'Sv/day' ? RADIATION.measurements[0].value : null
  const routeAssessment = useMemo(
    () => (profile.status === 'ready' && routePath ? assess(profile.samples, routePath, limits, doseRate) : null),
    [profile, routePath, limits, doseRate],
  )
  // The EVA window: from the planned start for the route's time, or the
  // whole budget before a route exists. With no start typed in, the start is
  // the best window from now on (src/data/eva-window): the Sun up until an
  // hour past the end, the warmest air from the nearest station's latest
  // reading, and no CME forecast to arrive during it. Now, when no sol in
  // the search has one.
  const evaDuration = routeAssessment?.total ?? limits.eva
  // The search runs from now, rounded to its ten-minute step so it reruns
  // at most that often.
  const searchFrom = Math.floor(clock / 600_000) * 600_000
  const windowInput = useMemo(() => {
    if (!plan.start) return null
    const near = nearestStation(plan.start, STATION_POSITIONS)
    const report = near && weather[near.id]
    const reading = report && report !== 'error' ? report.latest : null
    return { point: plan.start, duration: evaDuration, now: searchFrom, reading, space: spaceWeather.data }
  }, [plan.start, evaDuration, searchFrom, weather, spaceWeather.data])
  // One search: the best start of each sol over the next six weeks, for the
  // calendar, and the best of the first seven, the start when none is picked.
  // So the worked-out start is always one of the calendar's.
  const { search, failed: windowFailed } = useWindowSearch(windowInput, CALENDAR_SOLS, profileAttempt)
  const windowPending = Boolean(windowInput && !plan.when && !search && !windowFailed)
  const calendar = useMemo(() => (search ? windowsByDate(search) : null), [search])
  const autoWindow = useMemo(() => (plan.when || !search ? null : bestOf(search.sols.slice(0, 7).map((sol) => sol.best))), [plan.when, search])
  // A picked start gets the same checks as a worked-out one.
  const pickedWindow = useMemo(() => (plan.when && windowInput ? assessStart(windowInput, Date.parse(plan.when)) : null), [plan.when, windowInput])
  const startWindow = plan.when ? pickedWindow : autoWindow
  const evaStart = plan.when ? Date.parse(plan.when) : (autoWindow?.start ?? clock)
  const evaEnd = evaStart + evaDuration * 1000
  const spaceCheck = useMemo(
    () => (spaceWeather.status === 'loading' ? null : checkSpaceWeather(spaceWeather.data, evaStart, evaEnd, clock)),
    [spaceWeather, evaStart, evaEnd, clock],
  )
  // The verdict takes the space weather and the daylight at the start: an
  // EVA that runs into the dark is no-go, whatever the ground.
  const assessment = useMemo(() => {
    if (!routeAssessment || windowPending || (!plan.when && windowFailed)) return null
    const reasons = [...(startWindow?.daylight ? [startWindow.daylight] : []), ...(spaceCheck?.reasons ?? [])]
    return reasons.length ? withReasons(routeAssessment, reasons) : routeAssessment
  }, [routeAssessment, spaceCheck, startWindow, windowPending, windowFailed, plan.when])
  // Finest and coarsest terrain under the route, for the Terrain tab.
  const terrainDetail = useMemo(() => {
    const details = (profile.samples ?? []).map((sample) => sample.detail).filter((d) => d != null)
    if (!details.length) return null
    const coarse = routeAssessment?.legs.reduce((sum, leg) => sum + leg.coarse, 0) ?? 0
    return { finest: Math.min(...details), coarsest: Math.max(...details), coarse }
  }, [profile.samples, routeAssessment])

  // Preserve unchanged legs, including their in-flight samples, across edits.
  const stopsKey = JSON.stringify(plan.start && plan.target ? stopPath(plan) : [])
  const fields = useRef(null)
  useEffect(() => {
    if (!terrainProvider) return
    const night = SAMPLED_RASTERS.find((layer) => layer.id === 'themis-night')
    const loader = createRouteFields(async (start, target, publish, signal) => {
      const length = distance(start, target)
      const finest = Math.max(9, ...[start, target, resample([start, target], 3)[1].point].map((point) => levelAt(terrainProvider, point) ?? 9))
      const along = Math.min(160, Math.max(40, Math.round(length / Math.max(4 * detailMeters(finest), length / 160))))
      const grid = buildGrid(start, target, along)
      const level = levelForSpacing(grid.cell, finest)
      const probeSlopes = grid.points.length <= 6000
      await loadRouteField(grid, {
        elevations: () => sampleElevations(terrainProvider, grid.points, level, signal),
        surface: () => (probeSlopes ? sampleSurface(terrainProvider, grid.points, level, undefined, signal) : Promise.resolve([])),
        thermal: () => night ? sampleRaster(night, grid.points, undefined, signal) : Promise.resolve(grid.points.map(() => null)),
        ground: () => sampleGround(grid.points, { radius: Math.max(GROUND_RADIUS, grid.cell / 2), signal }),
      }, (result) => {
        if (!result.field.elevation.some((value) => value !== null)) throw new Error('No terrain for route')
        publish(result)
      }, signal)
    })
    fields.current = loader
    return () => { loader.destroy(); fields.current = null }
  }, [terrainProvider, routeAttempt])

  useEffect(() => {
    const stops = JSON.parse(stopsKey)
    if (!terrainProvider || stops.length < 2) {
      fields.current?.update([], () => {}, () => {})
      setRouteField({ status: 'idle' })
      return
    }
    setRouteField({ status: 'loading' })
    fields.current.update(stops, (legs) => {
      setRouteField({
        status: 'ready', key: stopsKey, legs,
        thermalPending: legs.some((leg) => leg.thermalPending),
        slopesPending: legs.some((leg) => leg.slopesPending),
        groundPending: legs.some((leg) => leg.groundPending),
      })
    }, () => setRouteField({ status: 'error' }))
  }, [terrainProvider, stopsKey, routeAttempt])

  const searcher = useRef(null)
  const [searchedRoute, setSearchedRoute] = useState(null)
  useEffect(() => {
    const search = createRouteSearch()
    searcher.current = search
    return () => { search.destroy(); searcher.current = null }
  }, [])
  useEffect(() => {
    if (routeField.status !== 'ready' || routeField.key !== stopsKey) return
    searcher.current.update(routeField.legs, limits, JSON.parse(stopsKey).slice(1, -1), (plan, note) => {
      setSearchedRoute({ field: routeField, limits, plan, note })
    }, () => setSearchedRoute({ field: routeField, limits, error: true }))
    return () => searcher.current.cancel()
  }, [routeField, limits, stopsKey])
  const currentSearch = routeField.key === stopsKey && searchedRoute?.field === routeField && searchedRoute?.limits === limits ? searchedRoute : null
  const routePlan = currentSearch?.plan ?? null
  const routeStatus = routeField.status !== 'ready' ? routeField.status : currentSearch?.error ? 'error' : routePlan?.status === 'blocked' ? 'blocked' : routePlan ? 'ready' : 'loading'
  const options = routePlan?.options ?? []
  const sameNote = currentSearch?.note ?? null
  // The route on the map is the picked one once its waypoints match. Plans
  // saved before picks were stored are matched by value alone.
  const matches = (option) => samePoints(option.waypoints, plan.waypoints)
  const chosenId = plan.route
    ? (options.some((option) => option.id === plan.route && matches(option)) ? plan.route : null)
    : options.find((option) => option.generated.length > 0 && matches(option))?.id ?? null
  onLineRef.current = (hit) => {
    if (hit?.pick) {
      const option = options.find((o) => o.id === hit.id)
      if (option) chooseRoute(option)
      setLineTip(null)
      return
    }
    setLineTip((current) => (current?.id === hit?.id && current?.x === hit?.x ? current : hit))
    setRouteHover((current) => (hit ? hit.id : current === lineTip?.id ? null : current))
  }
  const chooseRoute = (option) => {
    setPlan((current) => ({ ...current, waypoints: option.waypoints, generated: option.generated, route: option.id }))
  }
  // The picked route follows the stops and limits. When it is found again
  // through new stops, or under new limits, its new turn points replace the
  // old ones. A plan matched by value alone gets its pick stored.
  const repick = options.find((option) => option.id === (plan.route ?? chosenId))
  const stale = repick && (!plan.route || !matches(repick)) ? repick : null
  useEffect(() => {
    if (stale) chooseRoute(stale)
  }, [stale])

  useEffect(() => {
    planOverlay.current?.setAlternatives(suit ? [] : options
      .filter((option) => option.id !== chosenId && !option.sameAs)
      .map((option) => ({ id: option.id, points: option.line, color: cssValue(`--color-route-${option.id}`), focus: option.id === routeHover })))
  }, [viewer, options, chosenId, routeHover, suit])

  // Handles and the route line on the map. Turn points from a picked
  // suggestion get no handle. The user's own waypoints are numbered 1, 2, …
  useEffect(() => {
    let number = 0
    const vertices = planPath(plan).map((point, i, all) => {
      const kind = i === 0 && plan.start ? 'start' : i === all.length - 1 && plan.target ? 'target' : 'waypoint'
      if (kind === 'waypoint' && isGenerated(plan, point)) return null
      return { point, kind, label: kind === 'start' ? 'A' : kind === 'target' ? 'B' : String(++number) }
    }).filter(Boolean)
    const route = profile.status === 'ready'
      ? profile.samples.map((s) => ({ point: s.point, level: slopeLevel(s.slope, limits.slope) }))
      : null
    planOverlay.current?.set(vertices, route)
  }, [viewer, plan, profile, limits.slope])

  const startAt = (point, startName = null) => {
    const far = plan.target && distance(plan.target, point) > NEW_PLAN_DISTANCE
    // A new start elsewhere drops the route but keeps the planned time.
    const next = far ? { ...EMPTY_PLAN, when: plan.when, start: point, startName } : { ...stopsOnly(plan), start: point, startName }
    setPlan(next)
    mission?.onRoutePoints(stopPath(next))
  }

  // The route follows the plan. When a stop or a stop's site changes, the
  // start, stops and target become the plan's sites in order. The picked
  // strategy and start time stay. Right-click endpoints also update the
  // mission, so they are saved and follow undo and redo.
  const routeSites = mission
    ? planStops(mission)
        .map((index) => mission.sites[index])
        .filter((entry) => entry && Number.isFinite(entry.lat) && Number.isFinite(entry.lon))
    : []
  const routeSitesKey = JSON.stringify(routeSites.map((entry) => [entry.lat, entry.lon, entry.name]))
  const previousMissionRoute = useRef(routeSitesKey)
  useEffect(() => {
    // Keep routes saved before map points became mission sites. Later edits,
    // including undoing the first point, still reconcile an empty plan.
    const legacy = previousMissionRoute.current === routeSitesKey && routeSites.length === 0
    previousMissionRoute.current = routeSitesKey
    if (mission && !legacy) setPlan((current) => withMissionSites(current, routeSites))
  }, [routeSitesKey])

  const actions = {
    start: (point) => startAt(point),
    target: (point) => {
      const next = { ...stopsOnly(plan), target: point }
      setPlan(next)
      mission?.onRoutePoints(stopPath(next))
    },
    waypoint: (point) => setPlan((current) => insertWaypoint(current, point)),
    // Stays on, so several sites can be added in a row.
    site: (point) => mission?.onAddSite(point),
  }


  onMapClickRef.current = ({ siteId, point }) => {
    if (tool && point) return toolClickRef.current?.(point)
    if (placing && point) return actions[placing](point)
    if (siteId) return onSite(siteId)
    setProbe(null)
  }
  onContextRef.current = (opened) => {
    if (!opened) return setProbe(null)
    const placed = opened.markerId ? markers.find((m) => m.id === opened.markerId) : null
    setProbe({ ...opened, point: placed?.point ?? opened.point, markerId: placed?.id ?? null, status: 'loading' })
  }
  const closeProbe = useCallback(() => setProbe(null), [])
  // Handles are the start, the stops and the target, as moveVertex counts them.
  onMoveVertexRef.current = (index, point) => setPlan((current) => moveVertex(current, index, point))

  useEffect(() => {
    if (!placing) return
    const onKeyDown = (event) => { if (event.key === 'Escape') setPlacing(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [placing])

  // Point readout: terrain at one spot.
  const probePoint = probe?.point
  useEffect(() => {
    if (!terrainProvider || !probePoint) return
    let cancelled = false
    // The ground check is extra: without it the menu still shows terrain.
    Promise.all([
      sampleSurface(terrainProvider, [probePoint], 16),
      sampleGround([probePoint]).catch(() => [null]),
    ]).then(([[surface], [ground]]) => {
      if (cancelled) return
      setProbe((current) => current?.point !== probePoint ? current : {
        ...current,
        detail: detailAt(terrainProvider, probePoint),
        status: surface.elevation === null ? 'error' : 'ready',
        elevation: surface.elevation,
        slope: surface.slope,
        ground,
      })
    }, () => {
      if (!cancelled) setProbe((current) => (current?.point === probePoint ? { ...current, status: 'error' } : current))
    })
    return () => { cancelled = true }
  }, [terrainProvider, probePoint])

  // Rover weather, from the Go server's cached copy of the NASA feeds.
  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      for (const { id } of STATIONS) {
        fetchWeather(id, controller.signal).then(
          (report) => setWeather((current) => ({ ...current, [id]: report })),
          (error) => {
            if (error.name !== 'AbortError') setWeather((current) => ({ ...current, [id]: current[id] && current[id] !== 'error' ? current[id] : 'error' }))
          },
        )
      }
    }
    load()
    const timer = setInterval(load, WEATHER_REFRESH)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  // CME forecasts for Mars. The server caches an hour, so refetching hourly
  // costs nothing upstream.
  useEffect(() => {
    const controller = new AbortController()
    const load = () => fetchSpaceWeather(controller.signal).then(
      (data) => setSpaceWeather({ status: 'ready', data }),
      (error) => {
        if (error.name !== 'AbortError') setSpaceWeather((current) => (current.data ? { ...current, data: { ...current.data, stale: true } } : { status: 'error', data: null }))
      },
    )
    load()
    const timer = setInterval(load, WEATHER_REFRESH)
    const tick = setInterval(() => setClock(Date.now()), 60_000)
    return () => {
      controller.abort()
      clearInterval(timer)
      clearInterval(tick)
    }
  }, [])

  // Where Trek has fine terrain, outlined on the map with its detail, so a
  // planner can keep the route where slope numbers mean something.
  useEffect(() => {
    if (!viewer || !terrainProvider) return
    const overlay = addToolOverlay(viewer, cssValue('--color-bg'))
    const controller = new AbortController()
    fetch(`${TERRAIN_API_PATH}/layer.json`, { signal: controller.signal }).then((r) => r.json()).then((layer) => {
      const boxes = coverage(layer.available ?? [], FINE_LEVEL)
      const dim = cssValue('--color-text-muted')
      overlay.set({
        lines: boxes.map((box) => ({ points: outline(box), color: dim, dash: [2, 5], width: 1.25 })),
        dots: boxes.map((box) => {
          const center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
          const detail = detailAt(terrainProvider, center) ?? detailMeters(FINE_LEVEL)
          return { point: [box[2], box[1]], color: dim, bare: true, label: `${detailLabel(detail)} terrain`, maxHeight: 400_000 }
        }),
      })
    }, () => {})
    return () => {
      controller.abort()
      overlay.destroy()
    }
  }, [viewer, terrainProvider])

  // Station ground elevation, so pressure can be scaled to other heights.
  useEffect(() => {
    if (!terrainProvider) return
    let cancelled = false
    const ids = STATIONS.map((s) => s.id)
    sampleSurface(terrainProvider, ids.map((id) => STATION_POSITIONS[id]), 14).then((samples) => {
      if (!cancelled) setStationElevation(Object.fromEntries(ids.map((id, i) => [id, samples[i].elevation])))
    }, () => {})
    return () => { cancelled = true }
  }, [terrainProvider])

  // Weather near a point: the closest station, its latest reading, and the
  // pressure scaled to `elevation` when both heights are known.
  const weatherNear = (point, elevation) => {
    const near = point && nearestStation(point, STATION_POSITIONS)
    const report = near && weather[near.id]
    if (!near || !report || report === 'error' || !report.latest) return near ? { distance: near.distance, report: report ?? null } : null
    const base = stationElevation[near.id]
    const pa = report.latest.pressurePa
    const estimate = pa != null && base != null && elevation != null ? pressureAt(pa, base, elevation) : null
    return { distance: near.distance, report, estimate }
  }
  const planWeather = weatherNear(plan.start ?? (site ? [site.lat, site.lon] : null), profile.samples?.[0]?.elevation ?? null)
  const highWeather = planWeather?.report?.latest && summary?.high != null ? weatherNear(plan.start, summary.high) : null
  const probeWeather = probe?.status === 'ready' ? weatherNear(probe.point, probe.elevation) : null

  useEffect(() => {
    if (!mission) saveMarkers(localMarkers)
  }, [mission, localMarkers])
  useEffect(() => {
    if (viewer) syncMarkers(viewer, markerEntities.current, markers)
  }, [viewer, markers])
  const probeMarker = probe?.markerId ? markers.find((m) => m.id === probe.markerId) ?? null : null

  const probeActions = probePoint ? [
    { label: 'Start here', run: () => actions.start(probePoint) },
    plan.start && { label: 'Target here', run: () => actions.target(probePoint) },
    plan.start && plan.target && { label: 'Add waypoint', run: () => actions.waypoint(probePoint) },
  ].filter(Boolean).map((action) => ({ ...action, run: () => { action.run(); setProbe(null) } })) : []

  // One marker: the suit position, else the profile hover, else the probe.
  const suitSample = suit && profile.samples ? profile.samples.reduce((best, s) => (Math.abs(s.d - suit.position) < Math.abs(best.d - suit.position) ? s : best)) : null
  const markerPoint = suitSample?.point ?? (hoverIndex !== null ? profile.samples?.[hoverIndex]?.point : null) ?? probePoint ?? null
  const walking = Boolean(suitSample)
  useEffect(() => {
    placeMarker(viewer, marker.current, markerPoint, walking)
  }, [viewer, markerPoint, walking])

  // Changing the route ends the suit view.
  useEffect(() => {
    if (!routePath || profile.status !== 'ready') setSuit(null)
  }, [routePath, profile.status])

  const suitPosition = suit?.position
  useEffect(() => {
    if (!viewer || suitPosition === undefined || !profile.samples) return
    const samples = profile.samples
    const here = samples.reduce((best, s) => (Math.abs(s.d - suitPosition) < Math.abs(best.d - suitPosition) ? s : best))
    const ahead = samples.find((s) => s.d > suitPosition + 80) ?? samples.at(-1)
    const dLon = (ahead.point[1] - here.point[1]) * Math.cos(here.point[0] * Math.PI / 180)
    const heading = (Math.atan2(dLon, ahead.point[0] - here.point[0]) * 180) / Math.PI
    followWalker(viewer, here.point, heading, suit?.playing, here.elevation)
  }, [viewer, suitPosition, profile.samples])

  const walk = () => {
    setPlacing(null)
    setProbe(null)
    setSuit({ position: 0 })
  }

  const exitSuit = () => {
    setSuit(null)
    if (viewer && routePath) flyToPath(viewer, routePath, profile.samples)
  }

  const dose = RADIATION && {
    site: SITES.find((entry) => entry.id === RADIATION.siteIds[0])?.name ?? '',
    when: RADIATION.epoch.match(/\d{4}/g)?.join('–') ?? '',
    measurement: RADIATION.measurements[0],
  }

  // Profile marks at the user's waypoints and the target, not at turn points.
  const markPath = planPath(plan)
  const marks = assessment?.legs.filter((_, i) => !markPath[i + 1] || i + 1 === markPath.length - 1 || !isGenerated(plan, markPath[i + 1])).map((leg) => leg.to)

  // The HUD page shows this route and nothing it worked out itself. While a
  // changed route is still being sampled it keeps the last assessed one and
  // says so.
  const marksKey = marks?.join()
  useEffect(() => {
    if (!routePath) saveHud(mission?.id, 'none', null)
    else if (assessment && profile.samples && marks) {
      saveHud(mission?.id, 'ready', hudRoute({ plan: { ...plan, when: plan.when ?? new Date(evaStart).toISOString() }, limits, samples: profile.samples, assessment, marks, coarseDetail: COARSE_DETAIL, peakLimitW: SUIT.limitW }))
    } else saveHud(mission?.id, profile.status === 'error' ? 'failed' : 'updating', null)
  }, [mission?.id, routePath, plan, limits, profile, assessment, marksKey, evaStart])
  const mapLabels = useMemo(() => [
    ...crewLabels,
    ...(missionSites ?? []).flatMap((entry, index) => Number.isFinite(entry.lat + entry.lon) ? [{
      id: `site-${index}`,
      point: [entry.lat, entry.lon],
      text: `${index + 1} ${entry.name || 'Unnamed'} · ${missionCounts?.[index] ?? 0} ${(missionCounts?.[index] ?? 0) === 1 ? 'task' : 'tasks'}`,
      selected: index === missionSelected,
      onSelect: () => missionRef.current?.onSelect(index),
    }] : []),
    ...markers.map((entry) => ({
      id: `symbol-${entry.id}`,
      point: entry.point,
      text: entry.label,
      symbol: entry.symbol,
      onSelect: (screen) => onContextRef.current?.({ point: entry.point, markerId: entry.id, screen }),
      onContext: (screen) => onContextRef.current?.({ point: entry.point, markerId: entry.id, screen }),
    })),
  ], [missionSites, missionCounts, missionSelected, markers, crewLabels])
  const nextRelief = RELIEF_STEPS[(RELIEF_STEPS.indexOf(relief) + 1) % RELIEF_STEPS.length]

  return (
    <div className="workspace">
      <div style={{ display: 'contents' }} inert={!!street}>
        <PlanPanel
          plan={plan}
          limits={limits}
          assessment={assessment}
          status={profile.status}
          placing={placing}
          dose={dose}
          weather={planWeather && { ...planWeather, atHigh: highWeather?.estimate ?? null }}
          space={{ status: spaceWeather.status, data: spaceWeather.data, check: spaceCheck, start: evaStart, end: evaEnd, now: clock }}
          when={plan.when ?? null}
          startCheck={{ window: startWindow, picked: Boolean(plan.when), searched: Boolean(plan.start), pending: windowPending, failed: !plan.when && windowFailed }}
          calendar={calendar}
          onWhen={(when) => setPlan((current) => ({ ...current, when }))}
          terrainDetail={terrainDetail}
          onPlacing={setPlacing}
          onRemoveWaypoint={(index) => setPlan((current) => removeWaypoint(current, index))}
          onLimits={setLimits}
          onRetry={() => setProfileAttempt((attempt) => attempt + 1)}
          onWalk={walk}
          onClear={() => { setPlan(EMPTY_PLAN); setPlacing(null) }}
          onAddToMission={!mission ? undefined : assessment && plan.target ? () => mission.onAddEva({
            target: plan.target,
            seconds: assessment.total,
            distance: assessment.distance,
            maxSlope: assessment.maxSlope,
            verdict: assessment.verdict,
          }) : null}
          missionSites={missionPanel?.({ placing, onPlacing: setPlacing })}
          missionPlan={missionPlan}
          missionFlag={mission?.flag ?? null}
          missionFocus={missionSelected}
        />
      </div>
      <main className={`stage${street ? ' stage--street' : ''}${placing ? ' is-placing' : ''}`}>
        <div ref={container} className="stage__map" />
        <MapLabels viewer={viewer} items={street ? [] : mapLabels} />
        {street && viewer && <StreetView viewer={viewer} terrain={terrainProvider} relief={relief} drop={street === 'pick' ? null : street} onExit={exitStreet} />}

        <div className={`hud${street ? ' hud--street' : ''}${suit ? ' hud--suit' : ''}${routePath && profileOpen ? ' hud--profile' : ''}`}>
          <span className="hud__corner hud__corner--tl" aria-hidden="true" />
          <span className="hud__corner hud__corner--tr" aria-hidden="true" />
          <span className="hud__corner hud__corner--bl" aria-hidden="true" />
          <span className="hud__corner hud__corner--br" aria-hidden="true" />

          {!planetShown && (
            <p className="stage__loading" role="status">
              <span className="spinner spinner--large" aria-hidden="true" />
              Loading Mars
            </p>
          )}

          {site && (
            <div className="readout readout--tr">
              <span className="readout__label">Site</span>
              <span className="readout__value">{site.name}</span>
              {planWeather?.report?.latest && (
                <span className="readout__sub" title={`${planWeather.report.rover} ${planWeather.report.instrument}, ${planWeather.report.latest.date}. ${formatDistance(planWeather.distance)} from here.`}>
                  {planWeather.report.instrument} sol {planWeather.report.latest.sol} · {formatTemp(planWeather.report.latest.airMinK)} to {formatTemp(planWeather.report.latest.airMaxK)} · {formatPressure(planWeather.report.latest.pressurePa)}
                </span>
              )}
            </div>
          )}
          <NavControls viewer={viewer}>
            <button
              type="button"
              className="nav__text nav__section"
              onClick={() => setRelief(nextRelief)}
              aria-label={`Elevation scale ${relief}×. Switch to ${nextRelief}×`}
              data-tip={`Elevation scale ${relief}×. Click for ${nextRelief}×`}
            >
              {relief}×
            </button>
            {routePath && (
              <button type="button" aria-label="Fit route" data-tip="Fit route in view" onClick={() => viewer && flyToPath(viewer, routePath, profile.samples)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M8 16l3-7 5 6" />
                </svg>
              </button>
            )}
            {crewLabels.length > 0 && (
              <button type="button" aria-label="Fit crew" data-tip="Fit crew in view" onClick={fitCrew}>
                <StageIcon id="crew" />
              </button>
            )}
            <button
              type="button"
              aria-label="Global view"
              data-tip="Whole planet"
              onClick={() => { onSite(null); if (viewer) flyHome(viewer) }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <ellipse cx="12" cy="12" rx="3.5" ry="8" />
                <path d="M4 12h16" />
              </svg>
            </button>
            {routePath && !profileOpen && (
              <button type="button" aria-label="Route profile" data-tip="Route profile" onClick={() => setProfileOpen(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 4v16h16M7 15l4-7 4 5 5-7" />
                </svg>
              </button>
            )}
            <StreetViewButton
              viewer={viewer}
              buttonRef={streetButton}
              title={terrainProvider ? 'Street view. Click, then pick a spot, or drag onto the map' : 'Street view. Waiting for terrain'}
              disabled={!viewer || !terrainProvider}
              onPick={() => openStreet('pick')}
              onDrop={openStreet}
            />
            <ToolButtons tool={tool} onTool={setTool} />
          </NavControls>

          <MapTools
            viewer={viewer}
            terrainProvider={terrainProvider}
            tool={suit ? null : tool}
            onTool={setTool}
            limits={limits}
            planStart={plan.start}
            clickRef={toolClickRef}
            onUseRoute={(points) => {
              setPlan({ start: points[0], startName: null, target: points.at(-1), waypoints: points.slice(1, -1) })
              setTool(null)
            }}
          />

          {routePath && !suit && (
            <RouteOptions
              status={routeStatus}
              searchFailed={currentSearch?.error}
              needs={routePlan?.status === 'blocked' ? routePlan.needs : null}
              thermalPending={routeField.thermalPending}
              groundPending={routeField.groundPending}
              onRaise={(slope) => setLimits((current) => ({ ...current, slope }))}
              options={options}
              chosen={chosenId}
              measured={chosenId && profile.status === 'ready' ? summary : null}
              hover={routeHover}
              limit={limits.slope}
              onHover={setRouteHover}
              onChoose={chooseRoute}
              note={sameNote}
              onRetry={() => setRouteAttempt((attempt) => attempt + 1)}
            />
          )}

          {lineTip && (() => {
            const option = options.find((o) => o.id === lineTip.id)
            return option && (
              <div className="route-tip" style={{ left: lineTip.x, top: lineTip.y }} role="tooltip">
                {option.name} · {formatDistance(option.distance)} · {option.maxSlope === null ? '—' : `${option.maxSlope.toFixed(1)}°`}
              </div>
            )
          })()}

          <LayerSwitcher
            layers={SCIENCE_RASTERS}
            overlays={overlays}
            onToggle={(id) => setOverlays((current) => ({ ...current, [id]: { ...current[id], on: !current[id].on } }))}
            statuses={statuses}
            onRetry={(id) => setAttempts((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }))}
          />

          {probe && !suit && (
            <PointReadout
              probe={probe}
              limit={limits.slope}
              actions={probeActions}
              weather={probeWeather}
              marker={probeMarker}
              onAddMarker={(symbol) => { setMarkers((current) => addMapMarker(current, symbol, probe.point)); setProbe(null) }}
              onUpdateMarker={(change) => setMarkers((current) => updateMarker(current, probe.markerId, change))}
              onRemoveMarker={() => { setMarkers((current) => removeMarker(current, probe.markerId)); setProbe(null) }}
              onClose={closeProbe}
            />
          )}

          {routePath && profileOpen && !suit && (
            <RouteProfile
              samples={profile.samples}
              summary={summary}
              rasters={PROFILE_RASTERS}
              status={profile.status}
              limit={limits.slope}
              marks={marks}
              hudHref={mission ? `hud.html?mission=${encodeURIComponent(mission.id)}` : 'hud.html'}
              routeName="EVA plan"
              hoverIndex={hoverIndex}
              onHover={setHoverIndex}
              onPick={(index) => {
                const point = profile.samples[index].point
                const screen = viewer && screenOf(viewer, point)
                if (screen) setProbe({ point, screen, status: 'loading' })
              }}
              onSuit={walk}
              onClose={() => setProfileOpen(false)}
              onRetry={() => setProfileAttempt((attempt) => attempt + 1)}
            />
          )}

          {suit && profile.samples && (
            <SuitView
              samples={profile.samples}
              routeName="EVA plan"
              position={suit.position}
              onPosition={(position, playing = false) => setSuit({ position, playing })}
              dose={dose}
              limit={limits.slope}
              marks={marks}
              onExit={exitSuit}
            />
          )}

          {viewer && activeRasters.map((source) => (
            <ScienceOverlay
              key={source.id}
              viewer={viewer}
              source={source}
              opacity={overlays[source.id].opacity}
              attempt={attempts[source.id] ?? 0}
              onStatus={onLayerStatus}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
