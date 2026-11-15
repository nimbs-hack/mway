import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Cartesian2, Math as CesiumMath, type TerrainProvider, type Viewer } from 'cesium'
import { createStreetCamera } from './street-view-camera'
import { improveStreetRendering } from './street-view-rendering'
import { addHiriseLayers } from '../data/hirise-layer'
import { hiriseAt } from '../data/imagery.js'
import { MARS_RADIUS } from '../data/geo'
import { COARSE_DETAIL, detailAt, detailLabel } from '../data/terrain-detail'
import './street-view.css'

export type Drop = { x: number; y: number }

export function StreetViewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="3" fill="currentColor" stroke="none" />
      <path d="M9 10h6l2 6-2 1-1-4v8h-3v-6h-1v6H7l1-8-1 4-2-1 2-6Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Pixels the pointer must travel before a press on the button becomes a drag.
const DRAG_START = 4

// True when (x, y) lands on the globe itself, not a panel drawn over it.
function onMap(viewer: Viewer, x: number, y: number) {
  return document.elementFromPoint(x, y) === viewer.scene.canvas
}

/**
 * The rail button. Drag it onto the map to stand at that spot, like Google
 * Maps' street view figure. A plain click starts a pick mode instead, which
 * keeps the feature reachable from the keyboard.
 */
export function StreetViewButton({ viewer, disabled, title, buttonRef, onPick, onDrop }: {
  viewer: Viewer | null
  disabled: boolean
  title: string
  buttonRef: Ref<HTMLButtonElement>
  onPick: () => void
  onDrop: (drop: Drop) => void
}) {
  const [drag, setDrag] = useState<{ x: number; y: number; over: boolean } | null>(null)
  const dragged = useRef(false)

  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || disabled || !viewer) return
    const origin = { x: event.clientX, y: event.clientY }
    dragged.current = false
    const move = (moveEvent: PointerEvent) => {
      if (!dragged.current && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < DRAG_START) return
      dragged.current = true
      setDrag({ x: moveEvent.clientX, y: moveEvent.clientY, over: onMap(viewer, moveEvent.clientX, moveEvent.clientY) })
    }
    const end = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape)
      setDrag(null)
      if (dragged.current && onMap(viewer, upEvent.clientX, upEvent.clientY)) onDrop({ x: upEvent.clientX, y: upEvent.clientY })
    }
    const cancel = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape)
      setDrag(null)
    }
    const escape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return
      dragged.current = true
      cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="nav__section street-view__pegman"
        aria-label="Street view"
        data-tip={title}
        disabled={disabled}
        onPointerDown={start}
        onClick={() => {
          // A finished drag also fires click. It already did its job.
          if (dragged.current) { dragged.current = false; return }
          onPick()
        }}
      >
        <StreetViewIcon />
      </button>
      {drag && createPortal(
        <div className={`street-view__ghost${drag.over ? ' is-over' : ''}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <StreetViewIcon />
        </div>,
        document.body,
      )}
    </>
  )
}

// Ground spacing of the deepest tile level in a HiRISE layer, 256 px tiles.
function hiriseMeters(maxLevel: number) {
  return (2 * Math.PI * MARS_RADIUS) / 2 ** (maxLevel + 1) / 256
}

// Longitude -180 to 180 east, the convention terrain availability and the
// HiRISE footprints use. 0 to 360 made every western drop read "loading".
function sourcesAt(terrain: TerrainProvider | null, lat: number, lon: number) {
  const hirise = hiriseAt(lat, lon)
  const imagery = hirise ? `HiRISE ${detailLabel(hiriseMeters(hirise.maxLevel))}` : 'CTX 5 m'
  const detail = detailAt(terrain, [lat, lon])
  return `Imagery ${imagery} · Terrain ${detail === null ? 'loading' : detailLabel(detail)}${detail !== null && detail > COARSE_DETAIL ? ' · Footing unresolved' : ''}`
}

export default function StreetView({ viewer, terrain, relief, drop, onExit }: {
  viewer: Viewer
  terrain: TerrainProvider | null
  relief: number
  drop: Drop | null
  onExit: () => void
}) {
  const surface = useRef<HTMLDivElement>(null)
  const camera = useRef<ReturnType<typeof createStreetCamera>>(null)
  const exit = useRef(onExit)
  exit.current = onExit
  const [walking, setWalking] = useState(false)
  const [locked, setLocked] = useState(false)
  const [message, setMessage] = useState('')
  const [sources, setSources] = useState('')

  // HiRISE is only drawn here: at map heights CTX already resolves more than
  // the screen can show, and these extra layers would cost requests.
  useEffect(() => addHiriseLayers(viewer), [viewer])

  useEffect(() => {
    if (walking) return improveStreetRendering(viewer)
  }, [viewer, walking])

  useEffect(() => {
    const element = surface.current!
    element.focus()
    const keys = new Set<string>()
    let previous = performance.now()
    let frame = 0
    let dragging = false
    let hadLock = false
    let lastSources = 0
    const clear = () => { keys.clear(); dragging = false }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); exit.current(); return }
      if (!camera.current || event.ctrlKey || event.metaKey || event.altKey) return
      if (document.activeElement !== element && document.pointerLockElement !== element) return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault()
        keys.add(event.code)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code)
    const onLock = () => {
      const active = document.pointerLockElement === element
      setLocked(active)
      if (hadLock && !active) exit.current()
      hadLock = active
      clear()
    }
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      dragging = true
      element.focus()
    }
    const onMouseUp = () => { dragging = false }
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement === element || dragging) camera.current?.look(event.movementX, event.movementY)
    }
    const onBlur = () => clear()
    const tick = (now: number) => {
      const delta = (now - previous) / 1000
      previous = now
      if (camera.current) {
        const run = keys.has('ShiftLeft') || keys.has('ShiftRight')
        const available = camera.current.step(delta, Number(keys.has('KeyW')) - Number(keys.has('KeyS')), Number(keys.has('KeyD')) - Number(keys.has('KeyA')), run)
        setMessage(available ? '' : 'Terrain unavailable. Wait for tiles or return to map and retry.')
        if (now - lastSources > 500) {
          lastSources = now
          const { latitude, longitude } = viewer.camera.positionCartographic
          setSources(sourcesAt(terrain, CesiumMath.toDegrees(latitude), CesiumMath.toDegrees(longitude)))
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', clear)
    document.addEventListener('pointerlockchange', onLock)
    element.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousemove', onMouseMove)
    if (drop) enter(drop.x, drop.y)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', clear)
      document.removeEventListener('pointerlockchange', onLock)
      element.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousemove', onMouseMove)
      if (document.pointerLockElement === element) document.exitPointerLock()
      camera.current?.dispose()
      camera.current = null
    }
    // The drop is read once, when street view opens.
  }, [viewer, terrain])

  function enter(clientX: number, clientY: number) {
    if (camera.current) return
    const canvas = viewer.scene.canvas
    const bounds = canvas.getBoundingClientRect()
    const ray = viewer.camera.getPickRay(new Cartesian2(clientX - bounds.left, clientY - bounds.top))
    const ground = ray && viewer.scene.globe.pick(ray, viewer.scene)
    if (!ground) { setMessage('Choose a spot on the ground.'); return }
    camera.current = createStreetCamera(viewer, ground)
    if (!camera.current) { setMessage('Terrain is loading. Try this spot again.'); return }
    setMessage('')
    setWalking(true)
    // Request during the click or drop gesture. Browsers without pointer lock keep drag-to-look.
    const element = surface.current!
    element.focus()
    try { void element.requestPointerLock?.()?.catch(() => setLocked(false)) } catch { setLocked(false) }
  }

  return (
    <div className="street-view">
      <div
        ref={surface}
        className={`street-view__surface${walking ? ' is-walking' : ''}`}
        tabIndex={0}
        role="region"
        aria-label={walking ? 'Street view. WASD to walk, Shift to run, mouse to look, Escape to return to map.' : 'Choose a street view position on the map. Click the ground or press Enter to use the center.'}
        onKeyDown={(event) => {
          if (!walking && event.key === 'Enter') {
            const bounds = event.currentTarget.getBoundingClientRect()
            enter(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
          }
        }}
        onClick={(event) => enter(event.clientX, event.clientY)}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div className="street-view__help">
        <strong>{walking ? 'Street view' : 'Click the ground to walk here'}</strong>
        <span>{walking ? `WASD walk · Shift run · ${locked ? 'Mouse' : 'Drag'} look · Esc exit` : 'Esc to cancel'}</span>
        {walking && (
          <>
            <span title="Orbital imagery draped over terrain, not rover panoramas. Terrain spacing limits visible detail and cannot establish safe footing.">
              {sources}
            </span>
            <span title={`Walking uses true-scale heights. Returning to the map restores ${relief}× relief. Sky and haze are illustrative, not the planned EVA's weather or daylight.`}>
              Heights 1× · Sky and haze simulated
            </span>
          </>
        )}
        {message && <span className="street-view__message" role="status">{message}</span>}
        <button type="button" onClick={onExit}>Return to map</button>
      </div>
      <div className="nav street-view__nav">
        <button type="button" aria-label="Exit street view" title="Exit street view" aria-pressed="true" onClick={onExit}>
          <StreetViewIcon />
        </button>
      </div>
    </div>
  )
}
