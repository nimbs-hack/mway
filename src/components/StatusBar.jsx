import { useEffect, useRef, useState } from 'react'
import { Cartesian2, Cartesian3, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium'
import { DATUM_OFFSET, MARS_SPHERE } from '../data/terrain'
import { formatAltitude, formatElevation, formatLatLon } from '../format'
import { pickGround } from './camera'

// Longest the scale bar may get, in CSS pixels.
const SCALE_MAX = 100

// Terrain height without the scene's elevation exaggeration.
function unexaggerate(scene, height) {
  const base = scene.verticalExaggerationRelativeHeight
  return (height - base) / scene.verticalExaggeration + base
}

// Largest 1, 2 or 5 times a power of ten that fits in `meters`.
export function niceLength(meters) {
  const power = 10 ** Math.floor(Math.log10(meters))
  return [5, 2, 1].map((step) => step * power).find((length) => length <= meters) ?? power
}

function formatScale(meters) {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`
}

// Ground distance per pixel across the middle of the view, as Google Earth's
// scale bar measures it. Null when the middle of the view is off the planet.
function ScaleBar({ viewer }) {
  const [scale, setScale] = useState(null)
  const last = useRef(null)

  useEffect(() => {
    if (!viewer) return
    const update = () => {
      const position = viewer.camera.positionWC
      if (last.current && Cartesian3.equalsEpsilon(last.current, position, 0, 0.5)) return
      last.current = Cartesian3.clone(position, last.current ?? undefined)
      const { clientWidth: w, clientHeight: h } = viewer.scene.canvas
      const a = pickGround(viewer, new Cartesian2(w / 2 - SCALE_MAX / 2, h / 2))
      const b = pickGround(viewer, new Cartesian2(w / 2 + SCALE_MAX / 2, h / 2))
      if (!a || !b) return setScale(null)
      const perPixel = Cartesian3.distance(a, b) / SCALE_MAX
      const length = niceLength(perPixel * SCALE_MAX)
      setScale((current) => (current?.length === length && Math.abs(current.width - length / perPixel) < 0.5
        ? current
        : { length, width: Math.round(length / perPixel) }))
    }
    update()
    return viewer.scene.postRender.addEventListener(update)
  }, [viewer])

  if (!scale) return null
  return (
    <span className="statusbar__scale" aria-label={`Scale ${formatScale(scale.length)}`}>
      <span>{formatScale(scale.length)}</span>
      <span className="statusbar__scale-bar" style={{ width: scale.width }} aria-hidden="true" />
    </span>
  )
}

// Camera height above the ground under it. scene.globeHeight is the value
// Cesium uses for terrain collisions, unknown until that ground loads.
function CameraHeight({ viewer }) {
  const [height, setHeight] = useState(null)

  useEffect(() => {
    if (!viewer) return
    const update = () => {
      const camera = viewer.camera.positionCartographic
      const ground = viewer.scene.globeHeight ?? viewer.scene.globe.getHeight(camera)
      setHeight(ground === undefined ? null : Math.round(camera.height - ground))
    }
    update()
    return viewer.scene.postRender.addEventListener(update)
  }, [viewer])

  return height === null ? null : <span>Camera {formatAltitude(height)}</span>
}

// Planetocentric latitude, east longitude and elevation under the pointer.
function Cursor({ viewer }) {
  const [cursor, setCursor] = useState(null)

  useEffect(() => {
    if (!viewer) return
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    // Finding the ground under the pointer is a ray cast against terrain.
    // Do it once a frame for the latest position, not once per mouse event.
    let latest = null
    let frame = 0
    const read = () => {
      frame = 0
      if (viewer.isDestroyed()) return
      const hit = pickGround(viewer, latest)
      if (!hit) return setCursor(null)
      const c = MARS_SPHERE.cartesianToCartographic(hit)
      setCursor({
        lat: CesiumMath.toDegrees(c.latitude),
        lon: CesiumMath.toDegrees(c.longitude),
        elevation: unexaggerate(viewer.scene, c.height) - DATUM_OFFSET,
      })
    }
    handler.setInputAction(({ endPosition }) => {
      latest = Cartesian2.clone(endPosition, latest ?? new Cartesian2())
      frame ||= requestAnimationFrame(read)
    }, ScreenSpaceEventType.MOUSE_MOVE)
    const leave = () => setCursor(null)
    // Kept in a variable: by the time this cleans up, the viewer may be
    // destroyed and viewer.scene gone.
    const { canvas } = viewer.scene
    canvas.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(frame)
      handler.destroy()
      canvas.removeEventListener('pointerleave', leave)
    }
  }, [viewer])

  if (!cursor) return null
  return (
    <>
      <span className="statusbar__cursor">{formatLatLon(cursor.lat, cursor.lon)}</span>
      <span className="statusbar__elev">{formatElevation(cursor.elevation)}</span>
    </>
  )
}

function Attribution({ credits }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <span className="statusbar__attribution" ref={root}>
      <button type="button" aria-expanded={open} aria-controls="statusbar-credits" onClick={() => setOpen(!open)}>
        Data attribution
      </button>
      {open && (
        <ul id="statusbar-credits" className="statusbar__credits">
          {credits.map((credit) => <li key={credit}>{credit}</li>)}
        </ul>
      )}
    </span>
  )
}

// A failure says what it costs the user: blank or blurry patches on the map
// are missing imagery, not what the ground looks like.
const STATUS_TEXT = { loading: 'Loading imagery', error: 'Map imagery missing in places' }
const STATUS_HINT = { error: 'Some image tiles did not load. Blank or blurry patches show missing data, not the ground. Retry loads them again.' }

/**
 * Bottom bar laid out like Google Earth's. Left: tile state, shown only
 * while it matters, and the data credits behind one button. Right: scale,
 * camera height and the point under the cursor. `onRetry`, when given,
 * puts a Retry button next to a failure.
 *
 * @param {{ viewer: any, status: string, credits: string[], onRetry?: (() => void) | null }} props
 */
export default function StatusBar({ viewer, status, credits, onRetry }) {
  return (
    <footer className="statusbar">
      {STATUS_TEXT[status] && (
        <span role="status" className={`statusbar__state is-${status}`} title={STATUS_HINT[status]}>
          {status === 'loading' && <span className="spinner" aria-hidden="true" />}
          {STATUS_TEXT[status]}
          {status === 'error' && onRetry && <button type="button" className="statusbar__retry" onClick={onRetry}>Retry</button>}
        </span>
      )}
      <Attribution credits={credits} />
      <span className="statusbar__readouts">
        <ScaleBar viewer={viewer} />
        <CameraHeight viewer={viewer} />
        <Cursor viewer={viewer} />
      </span>
    </footer>
  )
}
