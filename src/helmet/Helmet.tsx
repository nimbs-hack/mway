import { useEffect, useRef, useState } from 'react'
import { Hud } from '../hud/Hud'
import { Instruments } from './Instruments'
import type { DrawInstruments } from './Instruments'
import { HEADING, PITCH_MAX, PITCH_MIN, createHead, tour, tourName } from './look'
import type { Look } from './look'
import { createScene } from './scene'

// The view from inside the helmet: generated ground, the helmet rim, and the
// EVA HUD over both. It is a demonstration of the HUD in use, not a view of
// the site. The ground is noise (see shader.ts) and the page says so.

const PARAMS = new URLSearchParams(location.search)
// ?tour=quick plays the six second look-around instead of the slow one.
const TOUR = tourName(PARAMS.get('tour'))
// Vertical field of view, for turning a drag in pixels into degrees.
const VIEW_DEGREES = 62
const KEY_STEP = 4 // degrees per arrow key press
// The ground is drawn at a share of the screen's pixels, lowered until the
// view keeps up and raised again when there is time to spare.
const SCALE_MIN = 0.3
const SCALE_START = 0.55
const SLOW_MS = 42
const FAST_MS = 24

export function Helmet() {
  const frame = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const hud = useRef<HTMLDivElement>(null)
  const instruments = useRef<DrawInstruments | null>(null)
  const [failed, setFailed] = useState(false)
  // Still to begin with when the system asks for less motion.
  const [touring, setTouring] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const live = useRef<{ touring: boolean; look: Look; target?: Look }>({ touring, look: { yaw: HEADING, pitch: -9 } })
  live.current.touring = touring

  useEffect(() => {
    const box = frame.current!
    const scene = createScene(canvas.current!)
    if (!scene) {
      setFailed(true)
      return
    }
    const head = createHead(tour(0, TOUR))
    let scale = SCALE_START
    const fit = () => {
      const ratio = Math.min(devicePixelRatio, 1.5) * scale
      scene.resize(Math.max(1, Math.round(box.clientWidth * ratio)), Math.max(1, Math.round(box.clientHeight * ratio)))
    }
    const draw = (target: Look, dt: number, time: number) => {
      const pose = head(target, dt, time)
      live.current.look = { yaw: pose.yaw, pitch: pose.pitch }
      scene.render(pose)
      const half = box.clientHeight / 2
      // Whole pixels: text between pixels turns soft.
      hud.current!.style.transform = `translate(${Math.round(pose.hud[0] * half)}px, ${Math.round(-pose.hud[1] * half)}px)`
      instruments.current?.(pose, box.clientHeight)
    }
    fit()

    const sizes = new ResizeObserver(fit)
    sizes.observe(box)
    let request = 0
    let before = performance.now()
    let tourTime = 0
    let clock = 0
    let slow = 0
    let frames = 0
    const loop = (now: number) => {
      const ms = Math.min(250, now - before)
      before = now
      clock += ms / 1000
      if (live.current.touring) tourTime += ms / 1000
      draw(live.current.touring ? tour(tourTime, TOUR) : live.current.target ?? live.current.look, ms / 1000, clock)

      slow += ms
      if (++frames === 20) {
        const average = slow / frames
        const wanted = average > SLOW_MS ? scale * 0.85 : average < FAST_MS ? scale * 1.1 : scale
        const next = Math.min(1, Math.max(SCALE_MIN, wanted))
        if (next !== scale) {
          scale = next
          fit()
        }
        slow = 0
        frames = 0
      }
      request = requestAnimationFrame(loop)
    }
    request = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(request)
      sizes.disconnect()
      scene.dispose()
    }
  }, [])

  // Drag to look, as in the map's street view: the ground follows the hand.
  // Taking the view by hand stops the look-around. Space starts it again.
  useEffect(() => {
    if (failed) return
    const box = frame.current!
    const state = live.current
    const aim = (yaw: number, pitch: number) => {
      const from = state.target ?? state.look
      state.target = { yaw: from.yaw + yaw, pitch: Math.min(PITCH_MAX, Math.max(PITCH_MIN, from.pitch + pitch)) }
      setTouring(false)
    }
    let drag: { x: number; y: number } | null = null
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      drag = { x: event.clientX, y: event.clientY }
      box.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (!drag) return
      const perPixel = VIEW_DEGREES / box.clientHeight
      aim(-(event.clientX - drag.x) * perPixel, (event.clientY - drag.y) * perPixel)
      drag = { x: event.clientX, y: event.clientY }
    }
    const up = () => { drag = null }
    const key = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        state.target = undefined
        setTouring((on) => !on)
      } else if (event.key === 'ArrowLeft') aim(-KEY_STEP, 0)
      else if (event.key === 'ArrowRight') aim(KEY_STEP, 0)
      else if (event.key === 'ArrowUp') aim(0, KEY_STEP)
      else if (event.key === 'ArrowDown') aim(0, -KEY_STEP)
      else return
      event.preventDefault()
    }
    box.addEventListener('pointerdown', down)
    box.addEventListener('pointermove', move)
    box.addEventListener('pointerup', up)
    box.addEventListener('pointercancel', up)
    window.addEventListener('keydown', key)
    return () => {
      box.removeEventListener('pointerdown', down)
      box.removeEventListener('pointermove', move)
      box.removeEventListener('pointerup', up)
      box.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', key)
    }
  }, [failed])

  return (
    <div className="helmet" ref={frame}>
      <canvas className="helmet__ground" ref={canvas} aria-label="Generated Mars ground seen from inside a helmet" />
      {failed && <p className="helmet__failed" role="alert">This browser cannot draw the ground. Open the page in a browser with WebGL 2. The HUD still shows the plan.</p>}
      <div className="helmet__hud" ref={hud}>
        <Hud />
        {!failed && <Instruments draw={instruments} />}
      </div>
      <p className="helmet__note">
        Generated ground, not terrain data.
        {!failed && (touring ? ' Drag or use the arrow keys to look.' : ' Space resumes the look-around.')}
      </p>
    </div>
  )
}
