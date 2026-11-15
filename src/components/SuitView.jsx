import { useEffect, useRef, useState } from 'react'
import { guidance, slopeLevel, SLOPE_LIMIT } from '../data/route-profile'
import { formatElevation } from '../format'
import { formatMeasurement } from '../data/science-format'
import { formatDistance, formatSlope } from './RouteProfile'
import './suit-view.css'

const STEP = 50 // meters per step button press
// Playback moves the position every PLAY_TICK_MS, and the camera takes that
// long to follow, so the walk reads as one motion. A whole route plays in
// about PLAY_SECONDS whatever its length. It is a preview, not walking pace.
export const PLAY_TICK_MS = 600
const PLAY_SECONDS = 60
const PLAY_MIN_STEP = 5 // meters

/**
 * In-suit view: only what the astronaut needs while walking, in large type
 * with large controls for gloved hands. There is no live position feed, so
 * the position along the route is simulated: it plays from the start by
 * itself, and the step controls and the slider move it by hand.
 *
 * onPosition(meters, playing) gets true as its second argument for a step
 * of the playback, so the camera can follow at an even speed.
 */
export default function SuitView({ samples, routeName, position, onPosition, dose, limit = SLOPE_LIMIT, marks, onExit }) {
  const total = samples.at(-1).d
  const g = guidance(samples, position, 250, 100, marks)
  const level = slopeLevel(g.slopeAhead, limit)
  const isTarget = marks && g.next?.d === samples.at(-1).d
  const clamp = (d) => Math.min(total, Math.max(0, d))
  // Starts by itself, unless the system asks for less motion.
  const [playing, setPlaying] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  // The timer is set up once per play and reads the latest values from here.
  const live = useRef({ position, onPosition })
  live.current = { position, onPosition }
  useEffect(() => {
    if (!playing) return
    const step = Math.max(PLAY_MIN_STEP, total / (PLAY_SECONDS * 1000 / PLAY_TICK_MS))
    const advance = () => {
      const next = Math.min(total, live.current.position + step)
      live.current.onPosition(next, true)
      if (next >= total) setPlaying(false)
    }
    const timer = setInterval(advance, PLAY_TICK_MS)
    return () => clearInterval(timer)
  }, [playing, total])

  // Play from the end starts over.
  const togglePlay = () => {
    if (!playing && position >= total) onPosition(0)
    setPlaying(!playing)
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onExit()
      else if (event.key === 'ArrowUp') onPosition(clamp(position + STEP))
      else if (event.key === 'ArrowDown') onPosition(clamp(position - STEP))
      // Space on a focused button or slider already acts on that control.
      else if (event.key === ' ' && !event.target.closest?.('button, input')) {
        event.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <section className="suit" aria-label={`Suit view, ${routeName}`}>
      <div className="suit__block suit__block--nav">
        <span className="suit__label">{!g.next ? 'Route end' : isTarget ? 'Target' : `Next wp ${g.next.index}`}</span>
        <span className="suit__value">{g.next ? formatDistance(g.toNext) : 'Arrived'}</span>
        {g.heading !== null && <span className="suit__sub">HDG {String(Math.round(g.heading)).padStart(3, '0')}°</span>}
      </div>

      <div className={`suit__block suit__block--slope is-${level}`}>
        <span className="suit__label">Slope next 100 m</span>
        <span className="suit__value">{formatSlope(g.slopeAhead)}</span>
        <span className="suit__sub">{level === 'hazard' ? `Over ${limit}° limit` : level === 'caution' ? 'Caution' : `Limit ${limit}°`}</span>
      </div>

      <div className="suit__block suit__block--env">
        <span className="suit__label">Elev</span>
        <span className="suit__value suit__value--small">{g.here.elevation === null ? '—' : formatElevation(g.here.elevation)}</span>
        {dose && (
          <>
            <span className="suit__label">Dose, {dose.site} {dose.when}</span>
            <span className="suit__value suit__value--small">{formatMeasurement(dose.measurement)}</span>
          </>
        )}
        <span className="suit__label">Remaining</span>
        <span className="suit__value suit__value--small">{formatDistance(g.remaining)}</span>
      </div>

      <div className="suit__controls">
        <button type="button" className="suit__play" aria-pressed={playing} onClick={togglePlay} title="Space">
          {playing ? 'Pause' : position >= total ? 'Replay' : 'Play'}
        </button>
        <button type="button" onClick={() => onPosition(clamp(position - STEP))} aria-label={`Back ${STEP} meters`}>−{STEP} m</button>
        <div className="suit__track">
          <span className="suit__label">Simulated position {formatDistance(position)} of {formatDistance(total)}</span>
          <input type="range" min="0" max={Math.round(total)} step="10" value={Math.round(position)} aria-label="Simulated position along route" onChange={(event) => onPosition(Number(event.target.value))} />
        </div>
        <button type="button" onClick={() => onPosition(clamp(position + STEP))} aria-label={`Forward ${STEP} meters`}>+{STEP} m</button>
        <button type="button" className="suit__exit" onClick={onExit}>Exit</button>
      </div>
    </section>
  )
}
