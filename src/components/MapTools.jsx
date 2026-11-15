import { useEffect, useMemo, useRef, useState } from 'react'
import { Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium'
import { distance, resample } from '../data/geo'
import { formatDuration, traverseTime } from '../data/plan'
import { slopeLevel } from '../data/route-profile'
import { sampleSurface } from '../data/terrain-sample'
import { flatReach, lastBearing, lineOfSight, pathLength, ring, terrainAlong } from '../data/tools'
import { formatLatLon } from '../format'
import { pickGround } from './camera'
import { formatDistance, formatSlope } from './RouteProfile'
import { addToolOverlay } from './tool-overlay'
import './map-tools.css'

export const TOOLS = [
  {
    id: 'ruler',
    name: 'Ruler',
    tip: 'Ruler. Measure distance along points',
    icon: <path d="M3 17 17 3l4 4L7 21ZM7 13l2 2m1-5 2 2m1-5 2 2" />,
  },
  {
    id: 'range',
    name: 'Range rings',
    tip: 'Range rings. Distance circles around a point',
    icon: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12h.01" /></>,
  },
  {
    id: 'sight',
    name: 'Line of sight',
    tip: 'Line of sight. Check if one point sees another',
    icon: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  },
]

// Rail buttons. They sit in the camera rail, under their own divider.
export function ToolButtons({ tool, onTool }) {
  return TOOLS.map((t, i) => (
    <button
      key={t.id}
      type="button"
      className={i === 0 ? 'nav__section' : undefined}
      aria-pressed={tool === t.id}
      aria-label={t.name}
      data-tip={t.tip}
      onClick={() => onTool(tool === t.id ? null : t.id)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">{t.icon}</svg>
    </button>
  ))
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Surface samples along a polyline, with distance along it. Coarser terrain
// for long lines, as the route profile does.
function useTerrain(provider, points, count) {
  const [state, setState] = useState({ key: null, samples: null })
  const key = points.map((p) => p.join(',')).join(';')
  useEffect(() => {
    if (!provider || points.length < 2) return
    let cancelled = false
    const stations = resample(points, count)
    const level = pathLength(points) > 20_000 ? 12 : 15
    sampleSurface(provider, stations.map((s) => s.point), level).then((surface) => {
      if (!cancelled) setState({ key, samples: stations.map((s, i) => ({ ...s, ...surface[i], layers: {} })) })
    }, () => {
      if (!cancelled) setState({ key, samples: null })
    })
    return () => { cancelled = true }
    // `key` changes exactly when the points do.
  }, [provider, key, count])
  return state.key === key ? state.samples : null
}

function Row({ label, children, className }) {
  return (
    <div className="tools__row">
      <dt>{label}</dt>
      <dd className={className}>{children}</dd>
    </div>
  )
}

function HeightField({ label, value, onChange }) {
  return (
    <label className="tools__field">
      <span>{label}</span>
      <input type="number" min="0" max="100" step="0.1" value={value} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} />
      <span className="tools__unit">m</span>
    </label>
  )
}

/**
 * Ruler, range rings and line of sight. Owns each tool's points and draws
 * them on its own canvas layer. MarsGlobe routes map clicks here through
 * `clickRef` while a tool is on. The panel opens left of the camera rail.
 */
export default function MapTools({ viewer, terrainProvider, tool, onTool, limits, planStart, onUseRoute, clickRef }) {
  const overlay = useRef(null)
  const [ruler, setRuler] = useState([])
  const [hover, setHover] = useState(null)
  const [center, setCenter] = useState(null)
  const [sight, setSight] = useState({ a: null, b: null, observer: 1.8, target: 2 })

  useEffect(() => {
    if (!viewer) return
    overlay.current = addToolOverlay(viewer, css('--color-bg'))
    return () => {
      overlay.current?.destroy()
      overlay.current = null
    }
  }, [viewer])

  // Range rings start on the plan's start when nothing else is set.
  useEffect(() => {
    if (tool === 'range' && !center && planStart) setCenter(planStart)
  }, [tool, center, planStart])

  clickRef.current = (point) => {
    if (tool === 'ruler') setRuler((points) => [...points, point])
    else if (tool === 'range') setCenter(point)
    else if (tool === 'sight') setSight((s) => (!s.a || s.b ? { ...s, a: point, b: null } : { ...s, b: point }))
  }

  // Rubber band from the last ruler point to the pointer.
  useEffect(() => {
    if (!viewer || tool !== 'ruler') return setHover(null)
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction(({ endPosition }) => {
      const hit = pickGround(viewer, endPosition)
      if (!hit) return setHover(null)
      const c = viewer.scene.ellipsoid.cartesianToCartographic(hit)
      setHover([CesiumMath.toDegrees(c.latitude), CesiumMath.toDegrees(c.longitude)])
    }, ScreenSpaceEventType.MOUSE_MOVE)
    return () => handler.destroy()
  }, [viewer, tool])

  useEffect(() => {
    if (!tool) return
    const onKeyDown = (event) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'Escape') onTool(null)
      if (tool === 'ruler' && event.key === 'Backspace') {
        event.preventDefault()
        setRuler((points) => points.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tool, onTool])

  const rulerSamples = useTerrain(terrainProvider, tool === 'ruler' ? ruler : [], 120)
  const sightLine = useMemo(() => (sight.a && sight.b ? [sight.a, sight.b] : []), [sight.a, sight.b])
  const sightSamples = useTerrain(terrainProvider, tool === 'sight' ? sightLine : [], 200)
  const sightResult = sightSamples ? lineOfSight(sightSamples, sight.observer, sight.target) : null
  const walkBack = limits.range
  const reach = flatReach(limits)

  // Draw the active tool.
  useEffect(() => {
    if (!overlay.current) return
    const text = css('--color-text')
    const muted = css('--color-text-muted')
    const dim = css('--color-text-dim')
    const lines = []
    const dots = []
    if (tool === 'ruler' && ruler.length) {
      lines.push({ points: ruler, color: text, width: 2 })
      if (hover) lines.push({ points: [ruler.at(-1), hover], color: muted, dash: [5, 5], width: 1.5 })
      let along = 0
      ruler.forEach((point, i) => {
        if (i > 0) along += distance(ruler[i - 1], point)
        dots.push({ point, color: text, hollow: i > 0 && i < ruler.length - 1, label: i === 0 ? undefined : formatDistance(along) })
      })
      if (hover) dots.push({ point: hover, color: muted, hollow: true, label: formatDistance(along + distance(ruler.at(-1), hover)) })
    }
    if (tool === 'range' && center) {
      lines.push({ points: ring(center, walkBack), color: text, dash: [8, 5] })
      lines.push({ points: ring(center, reach), color: muted, dash: [3, 5] })
      dots.push({ point: center, color: text })
      dots.push({ point: ring(center, walkBack, 4)[0], color: text, hollow: true, label: `Walk-back ${formatDistance(walkBack)}` })
      dots.push({ point: ring(center, reach, 4)[1], color: muted, hollow: true, label: `Reach ${formatDistance(reach)}` })
    }
    if (tool === 'sight' && sight.a) {
      dots.push({ point: sight.a, color: text, label: `Eye ${sight.observer} m` })
      if (sight.b) {
        dots.push({ point: sight.b, color: text, label: `Target ${sight.target} m` })
        const blocked = sightResult && !sightResult.visible && sightSamples
        if (blocked) {
          const at = sightSamples.find((s) => s.d >= sightResult.blockedAt) ?? sightSamples.at(-1)
          lines.push({ points: [sight.a, at.point], color: text, width: 2 })
          lines.push({ points: [at.point, sight.b], color: dim, dash: [4, 5], width: 2 })
          dots.push({ point: at.point, color: text, hollow: true, label: 'Blocked' })
        } else {
          lines.push({ points: [sight.a, sight.b], color: text, width: 2, dash: sightResult ? undefined : [4, 5] })
        }
      }
    }
    overlay.current.set({ lines, dots })
  }, [tool, ruler, hover, center, walkBack, reach, sight, sightResult, sightSamples])

  if (!tool) return null
  const meta = TOOLS.find((t) => t.id === tool)
  const rulerTerrain = rulerSamples ? terrainAlong(rulerSamples) : null
  const heading = lastBearing(ruler)

  return (
    <section className="tools" aria-label={meta.name}>
      <header className="tools__head">
        <h2>{meta.name}</h2>
        <button type="button" className="tools__close" onClick={() => onTool(null)} aria-label={`Close ${meta.name}`}>×</button>
      </header>

      {tool === 'ruler' && (
        <>
          <p className="tools__big">{formatDistance(pathLength(ruler))}</p>
          {ruler.length < 2 ? (
            <p className="tools__hint">{ruler.length ? 'Click the next point.' : 'Click the map to start measuring.'} Backspace removes the last point.</p>
          ) : (
            <dl className="tools__rows">
              <Row label="Climb">{rulerTerrain ? `↑ ${Math.round(rulerTerrain.climb)} m` : '…'}</Row>
              <Row label="Descent">{rulerTerrain ? `↓ ${Math.round(rulerTerrain.descent)} m` : '…'}</Row>
              <Row label="Max slope" className={rulerTerrain ? `is-${slopeLevel(rulerTerrain.maxSlope, limits.slope)}` : ''}>
                {rulerTerrain ? formatSlope(rulerTerrain.maxSlope) : '…'}
              </Row>
              <Row label="Walk one way">{rulerSamples ? formatDuration(traverseTime(rulerSamples, limits)) : '…'}</Row>
              <Row label="Bearing">{heading === null ? '—' : `${String(Math.round(heading) % 360).padStart(3, '0')}°`}</Row>
            </dl>
          )}
          <div className="tools__actions">
            <button type="button" onClick={() => setRuler([])} disabled={!ruler.length}>Clear</button>
            <button type="button" onClick={() => onUseRoute(ruler)} disabled={ruler.length < 2} title="Start at the first point, end at the last">Use as route</button>
          </div>
        </>
      )}

      {tool === 'range' && (
        <>
          {center ? (
            <dl className="tools__rows">
              <Row label="Center"><span className="tools__where">{formatLatLon(...center)}</span></Row>
              <Row label="Walk-back">{formatDistance(walkBack)}</Row>
              <Row label="Flat reach">{formatDistance(reach)}</Row>
            </dl>
          ) : (
            <p className="tools__hint">Click the map to place the rings.</p>
          )}
          <p className="tools__hint">
            Walk-back is the limit from your settings. Reach is how far you can walk out and back on flat ground in {formatDuration(limits.eva)}, after {formatDuration(limits.work)} at the target.
          </p>
        </>
      )}

      {tool === 'sight' && (
        <>
          <div className="tools__fields">
            <HeightField label="Eye" value={sight.observer} onChange={(observer) => setSight((s) => ({ ...s, observer }))} />
            <HeightField label="Target" value={sight.target} onChange={(target) => setSight((s) => ({ ...s, target }))} />
          </div>
          {!sight.b ? (
            <p className="tools__hint">{sight.a ? 'Click what you want to see.' : 'Click where you stand.'}</p>
          ) : !sightResult ? (
            <p className="tools__hint" role="status">Sampling terrain…</p>
          ) : (
            <>
              <p className={`tools__big${sightResult.visible ? '' : ' is-blocked'}`} role="status">
                {sightResult.visible ? 'In view' : 'Blocked'}
              </p>
              <dl className="tools__rows">
                <Row label="Distance">{formatDistance(distance(sight.a, sight.b))}</Row>
                {sightResult.visible
                  ? <Row label="Clearance">{Math.round(sightResult.clearance * 10) / 10} m</Row>
                  : (
                    <>
                      <Row label="First block">{formatDistance(sightResult.blockedAt)} out</Row>
                      <Row label="Ground above line">{Math.round(sightResult.blockedBy)} m</Row>
                    </>
                  )}
              </dl>
              <p className="tools__hint">Click again to start over. Heights are above the ground at each end.</p>
            </>
          )}
        </>
      )}
    </section>
  )
}
