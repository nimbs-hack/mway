import { useRef } from 'react'
import { SLOPE_LIMIT, slopeLevel } from '../data/route-profile'
import { formatElevation } from '../format'
import { COARSE_DETAIL, detailLabel } from '../data/terrain-detail'
import { GROUND_NAME } from '../data/ground'
import './route-profile.css'

const WIDTH = 1000
const HEIGHT = 100
// Smallest elevation range the chart shows, so a few meters of relief on a
// flat walk don't fill the whole height and read as a hill.
const MIN_SPAN = 40

export function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

export function formatSlope(degrees) {
  return degrees === null || degrees === undefined ? '—' : `${Math.round(degrees)}°`
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Color for a relative value, using the same ramp the legend shows.
export function rampColor(stops, value) {
  const colors = (stops.length ? stops : ['#000000', '#ffffff']).map(hexToRgb)
  const t = Math.min(1, Math.max(0, value)) * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(t))
  const f = t - i
  const rgb = colors[i].map((v, k) => Math.round(v + (colors[i + 1][k] - v) * f))
  return `rgb(${rgb.join(' ')})`
}

// Vertical range with headroom, never narrower than MIN_SPAN.
function range(low, high) {
  const mid = (low + high) / 2
  const span = Math.max(MIN_SPAN, (high - low) * 1.15)
  return { bottom: mid - span / 2, top: mid + span / 2 }
}

/**
 * Elevation along the route, the area under it filled by slope level, so
 * one shape shows both where the climbs are and where they get too steep.
 */
function Chart({ samples, bottom, top, limit }) {
  const total = samples.at(-1).d || 1
  const x = (d) => (d / total) * WIDTH
  const y = (e) => HEIGHT - ((e - bottom) / (top - bottom)) * HEIGHT
  const known = samples.filter((s) => s.elevation !== null)
  if (known.length < 2) return null
  // The line is solid on fine terrain and dashed where the terrain is
  // coarse, so the profile shows where its own shape is uncertain.
  const runs = []
  for (const s of known) {
    const coarse = s.detail != null && s.detail > COARSE_DETAIL
    const point = `${x(s.d)},${y(s.elevation)}`
    const last = runs.at(-1)
    if (last && last.coarse === coarse) last.points.push(point)
    else runs.push({ coarse, points: last ? [last.points.at(-1), point] : [point] })
  }
  const bands = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if (a.elevation === null || b.elevation === null) continue
    const level = slopeLevel(b.slope, limit)
    const points = `${x(a.d)},${HEIGHT} ${x(a.d)},${y(a.elevation)} ${x(b.d)},${y(b.elevation)} ${x(b.d)},${HEIGHT}`
    bands.push(<polygon key={i} className={`profile__band is-${level}`} points={points} />)
    // Hatched as well as red, so over-limit ground does not rest on color
    // alone (NASA-STD-3001 Vol 2, V2 10045).
    if (level === 'hazard') bands.push(<polygon key={`h${i}`} className="profile__hatch" points={points} />)
  }
  return (
    <svg className="profile__svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="profile-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" />
        </pattern>
      </defs>
      {bands}
      {runs.map((run, i) => (
        <polyline key={i} className={`profile__line${run.coarse ? ' is-coarse' : ''}`} points={run.points.join(' ')} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

function RasterStrip({ samples, layer }) {
  const total = samples.at(-1).d || 1
  return (
    <svg className="profile__strip" viewBox={`0 0 ${WIDTH} 1`} preserveAspectRatio="none" aria-hidden="true">
      {samples.map((s, i) => {
        const value = s.layers[layer.id]
        if (value === null || value === undefined) return null
        const x0 = i === 0 ? 0 : ((s.d + samples[i - 1].d) / 2 / total) * WIDTH
        const x1 = i === samples.length - 1 ? WIDTH : ((s.d + samples[i + 1].d) / 2 / total) * WIDTH
        return <rect key={i} x={x0} width={Math.max(0.5, x1 - x0)} y="0" height="1" fill={rampColor(layer.legend.colors, value)} />
      })}
    </svg>
  )
}

/**
 * Route profile along the bottom of the map. Hover moves a marker on the
 * map and shows the values at that point. Click opens the point readout.
 * Arrow keys step along the route, Enter opens the readout.
 */
export default function RouteProfile({
  samples, summary, rasters, status, segment, onSegment, routeName,
  limit = SLOPE_LIMIT, marks = [], hoverIndex, onHover, onPick, onSuit, hudHref, onClose, onRetry,
}) {
  const chart = useRef(null)
  const ready = status === 'ready' && samples?.length > 1
  const hovered = ready && hoverIndex !== null ? samples[hoverIndex] : null
  const total = ready ? samples.at(-1).d : 1
  const { bottom, top } = ready ? range(summary.low ?? 0, summary.high ?? 0) : { bottom: 0, top: 1 }
  const at = (d) => `${(d / total) * 100}%`

  const indexFromEvent = (event) => {
    const box = chart.current.getBoundingClientRect()
    const d = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * total
    let best = 0
    for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].d - d) < Math.abs(samples[best].d - d)) best = i
    return best
  }

  const onKeyDown = (event) => {
    const step = event.shiftKey ? 10 : 1
    const current = hoverIndex ?? 0
    if (event.key === 'ArrowRight') onHover(Math.min(samples.length - 1, current + step))
    else if (event.key === 'ArrowLeft') onHover(Math.max(0, current - step))
    else if (event.key === 'Enter') onPick(current)
    else return
    event.preventDefault()
  }

  return (
    <section className="profile" aria-label={`Route profile, ${routeName}`}>
      <header className="profile__head">
        {onSegment && (
          <div className="profile__segment" role="group" aria-label="Route length">
            <button type="button" aria-pressed={segment === 'eva'} onClick={() => onSegment('eva')}>Last 2 km</button>
            <button type="button" aria-pressed={segment === 'full'} onClick={() => onSegment('full')}>Full traverse</button>
          </div>
        )}
        {ready && (
          <dl className="profile__stats">
            <div><dt>Distance</dt><dd>{formatDistance(summary.distance)}</dd></div>
            <div><dt>Climb</dt><dd>↑ {Math.round(summary.climb)} m</dd></div>
            <div><dt>Descent</dt><dd>↓ {Math.round(summary.descent)} m</dd></div>
            <div><dt>Max slope</dt><dd className={`is-${slopeLevel(summary.maxSlope, limit)}`}>{formatSlope(summary.maxSlope)}</dd></div>
            {summary.overLimit > 0 && <div><dt>Over {limit}°</dt><dd className="is-hazard">{formatDistance(summary.overLimit)}</dd></div>}
          </dl>
        )}
        <div className="profile__actions">
          <button type="button" className="profile__suit" onClick={onSuit} disabled={!ready}>Suit view</button>
          {hudHref && <a className="profile__hud" href={hudHref} target="_blank" rel="noreferrer">Open HUD</a>}
          <button type="button" className="profile__close" onClick={onClose} aria-label="Close route profile">×</button>
        </div>
      </header>

      {status === 'loading' && <p className="profile__note" role="status">Sampling terrain along the route…</p>}
      {status === 'error' && (
        <p className="profile__note" role="status">Terrain samples failed. <button type="button" onClick={onRetry}>Retry</button></p>
      )}

      {ready && (
        <div className="profile__body">
          <div
            ref={chart}
            className="profile__chart"
            role="slider"
            tabIndex={0}
            aria-label="Position along route"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(hovered?.d ?? 0)}
            aria-valuetext={hovered ? `${formatDistance(hovered.d)}, elevation ${hovered.elevation == null ? 'unknown' : formatElevation(hovered.elevation)}, slope ${formatSlope(hovered.slope)}${GROUND_NAME[hovered.ground] ? `, ${GROUND_NAME[hovered.ground].toLowerCase()}` : ''}` : 'Start of route'}
            onPointerMove={(event) => onHover(indexFromEvent(event))}
            onPointerLeave={(event) => { if (event.pointerType === 'mouse') onHover(null) }}
            onClick={(event) => onPick(indexFromEvent(event))}
            onKeyDown={onKeyDown}
          >
            <Chart samples={samples} bottom={bottom} top={top} limit={limit} />
            <span className="profile__axis profile__axis--top" aria-hidden="true">{formatElevation(top)}</span>
            <span className="profile__axis profile__axis--bottom" aria-hidden="true">{formatElevation(bottom)}</span>
            {marks.slice(0, -1).map((d, i) => (
              <span key={d} className="profile__mark" style={{ left: at(d) }} aria-hidden="true">{i + 1}</span>
            ))}
            {hovered && (
              <div className="profile__cursor" style={{ left: at(hovered.d) }} aria-hidden="true">
                <span className={hovered.d > total * 0.75 ? 'is-flipped' : ''}>
                  <b>{formatDistance(hovered.d)}</b>
                  {hovered.elevation != null && <>{formatElevation(hovered.elevation)}</>}
                  <i className={`is-${slopeLevel(hovered.slope, limit)}`}>{formatSlope(hovered.slope)}</i>
                  {hovered.detail != null && hovered.detail > COARSE_DETAIL && <i className="is-caution">{detailLabel(hovered.detail)} terrain</i>}
                  {GROUND_NAME[hovered.ground] && <i className="is-caution">{GROUND_NAME[hovered.ground]}</i>}
                </span>
              </div>
            )}
          </div>

          {rasters.map((layer) => (
            <div key={layer.id} className="profile__layer">
              <span>{layer.short}</span>
              <RasterStrip samples={samples} layer={layer} />
            </div>
          ))}

          <div className="profile__ticks" aria-hidden="true">
            <span>0</span>
            <span>{formatDistance(total / 2)}</span>
            <span>{formatDistance(total)}</span>
          </div>
        </div>
      )}
    </section>
  )
}
