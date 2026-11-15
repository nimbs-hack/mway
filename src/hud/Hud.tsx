import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { formatDuration } from '../data/duration'
import { MARS_RADIUS } from '../data/geo'
import type { LatLon } from '../data/geo'
import { hudKey, hudLegs, hudRelief, loadHud } from '../data/hud-snapshot'
import type { HudLeg, HudRoute } from '../data/hud-snapshot'
import { slopeLevel } from '../data/slope-level'
import { formatElevation, formatLatLon } from '../format.js'
import { meters } from '../numbers'
import { loadLibrary, storedCurrent } from '../state'

// The HUD is drawn over the astronaut's view of the ground, so it has no
// background and keeps the middle of the view clear: the verdict along the
// top, numbers down the left, the route and its legs down the right, the
// elevation profile along the bottom. It is a display, not a tool. It has
// no buttons, links or fields, and lets every click through to what is
// under it. It shows the route the planner last assessed and follows the
// planner while both are open. There is no position feed, so it never shows
// where the astronaut is, only the plan.

type Level = 'hazard' | 'caution' | null

const two = (n: number) => String(n).padStart(2, '0')
const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
}
const day = (ms: number) => `${new Date(ms).getUTCDate()} ${new Date(ms).toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`
// The date too, when it is not today's.
const dayNote = (ms: number, now: number) => (day(ms) === day(now) ? '' : day(ms))
const span = (ms: number) => formatDuration(Math.abs(ms) / 1000)
const degrees = (value: number | null) => (value === null ? '—' : `${Math.round(value)}°`)

function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

// The mission in the address, or the one open in the planner.
const missionId = () => new URLSearchParams(location.search).get('mission') ?? storedCurrent() ?? 'draft'

// Reads the snapshot again whenever the planner, in another tab, writes it.
function useSnapshot(id: string) {
  const read = () => ({
    snapshot: loadHud(id),
    name: loadLibrary()?.find((entry) => entry.id === id)?.mission.name ?? null,
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === hudKey(id) || event.key.includes('library')) setState(read())
    }
    const onShow = () => setState(read())
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onShow)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [id])
  return state
}

function useSize() {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!box.current) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(box.current)
    return () => observer.disconnect()
  }, [])
  return [box, size] as const
}

function Readout({ label, value, unit, sub, level }: { label: string; value: string; unit?: string; sub?: ReactNode; level?: Level }) {
  return (
    <div className={`visor__readout${level ? ` is-${level}` : ''}`}>
      <dt>{label}</dt>
      <dd className="visor__value">
        <b>{value}</b>
        {unit && <span> {unit}</span>}
      </dd>
      {sub && <dd className="visor__sub">{sub}</dd>}
    </div>
  )
}

// Start, back-by and turn-around times. An empty Schedule start means the
// EVA leaves now, as it does in the planner.
function Schedule({ route, now }: { route: HudRoute; now: number }) {
  const start = route.when
  const end = (start ?? now) + route.total * 1000
  if (start === null) return <Readout label="Back by, leaving now" value={clockTime(end)} unit="UTC" sub={dayNote(end, now)} />
  if (now < start) {
    return (
      <>
        <Readout label="Start" value={clockTime(start)} unit="UTC" sub={`in ${span(start - now)} ${dayNote(start, now)}`} />
        <Readout label="Back by" value={clockTime(end)} unit="UTC" sub={dayNote(end, now)} />
      </>
    )
  }
  if (now > end) return <Readout label="Planned end" value={clockTime(end)} unit="UTC" sub={`${span(now - end)} ago ${dayNote(end, now)}`} />
  const turn = end - route.timeBack * 1000
  return (
    <>
      <Readout label="Leave target by" value={clockTime(turn)} unit="UTC" sub={turn >= now ? `in ${span(turn - now)}` : `${span(now - turn)} ago`} />
      <Readout label="Back by" value={clockTime(end)} unit="UTC" sub={`in ${span(end - now)}`} />
    </>
  )
}

const MAP_PAD = 28 // px kept clear around the route for the pins
// Meters. A walk shorter than this is not stretched to fill the map.
const MAP_MIN_SPAN = 200
const GRID_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000]
const GRID_MIN_PX = 48
const PIN = 20

// The route seen from above, north up, on a grid of real distance. No
// imagery and no fill: the ground shows through it.
function RouteMap({ route, legs }: { route: HudRoute; legs: HudLeg[] }) {
  const [box, { width, height }] = useSize()
  const limit = route.limits.slope
  const drawing = useMemo(() => {
    if (width < 2 * MAP_PAD || height < 2 * MAP_PAD) return null
    const { samples } = route
    const rad = Math.PI / 180
    // Longitudes run -180 to 180. Unwrap them around the start so a route
    // across the 180° line stays in one piece.
    const lon = (value: number) => samples[0].point[1] + ((((value - samples[0].point[1] + 540) % 360) + 360) % 360) - 180
    const lats = samples.map((s) => s.point[0])
    const lons = samples.map((s) => lon(s.point[1]))
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
    const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2
    const east = (point: LatLon) => (lon(point[1]) - lon0) * rad * MARS_RADIUS * Math.cos(lat0 * rad)
    const north = (point: LatLon) => (point[0] - lat0) * rad * MARS_RADIUS
    const spanX = Math.max(MAP_MIN_SPAN, 2 * Math.max(...samples.map((s) => Math.abs(east(s.point)))))
    const spanY = Math.max(MAP_MIN_SPAN, 2 * Math.max(...samples.map((s) => Math.abs(north(s.point)))))
    const scale = Math.min((width - 2 * MAP_PAD) / spanX, (height - 2 * MAP_PAD) / spanY)
    const xy = (point: LatLon) => [width / 2 + east(point) * scale, height / 2 - north(point) * scale]
    const at = (i: number) => xy(samples[i].point).map((v) => v.toFixed(1)).join(',')

    const over: string[][] = []
    let open: string[] | null = null
    for (let i = 1; i < samples.length; i++) {
      if (slopeLevel(samples[i].slope, limit) !== 'hazard') {
        open = null
        continue
      }
      if (!open) {
        open = [at(i - 1)]
        over.push(open)
      }
      open.push(at(i))
    }

    const step = GRID_STEPS.find((meters) => meters * scale >= GRID_MIN_PX) ?? GRID_STEPS.at(-1)!
    const cell = step * scale
    const lines = (size: number) => {
      const out: number[] = []
      for (let n = -Math.ceil(size / 2 / cell); n <= Math.ceil(size / 2 / cell); n++) out.push(size / 2 + n * cell)
      return out
    }
    return {
      line: samples.map((_, i) => at(i)).join(' '),
      over: over.map((run) => run.join(' ')),
      xs: lines(width),
      ys: lines(height),
      step,
      cell,
      pins: [
        { label: 'A', kind: 'start', at: xy(legs[0].from) },
        ...legs.map((leg, i) => (i === legs.length - 1 ? { label: 'B', kind: 'target', at: xy(leg.to) } : { label: String(i + 1), kind: 'stop', at: xy(leg.to) })),
      ],
    }
  }, [route, legs, limit, width, height])

  return (
    <>
      <div className="visor__map" ref={box}>
        {drawing && (
          <svg width={width} height={height} role="img" aria-label="Planned route, north up">
            <g className="visor__grid">
              {drawing.xs.map((x) => <line key={`x${x}`} x1={x} x2={x} y1={0} y2={height} />)}
              {drawing.ys.map((y) => <line key={`y${y}`} x1={0} x2={width} y1={y} y2={y} />)}
            </g>
            <polyline className="visor__casing" points={drawing.line} />
            <polyline className="visor__plan" points={drawing.line} />
            {drawing.over.map((points, i) => <polyline key={`c${i}`} className="visor__casing visor__casing--over" points={points} />)}
            {drawing.over.map((points, i) => <polyline key={`o${i}`} className="visor__over" points={points} />)}
            {drawing.pins.map((pin) => (
              <g key={pin.label} className={`visor__pin is-${pin.kind}`} transform={`translate(${pin.at[0].toFixed(1)} ${pin.at[1].toFixed(1)})`}>
                <rect x={-PIN / 2} y={-PIN / 2} width={PIN} height={PIN} />
                <text textAnchor="middle" dy="0.35em">{pin.label}</text>
              </g>
            ))}
            <g className="visor__north" transform={`translate(${width - 18} 20)`}>
              <path d="M0 -10 L6 5 L0 2 L-6 5 Z" />
              <text textAnchor="middle" y="20">N</text>
            </g>
            <g className="visor__scale" transform={`translate(10 ${height - 10})`}>
              <path className="visor__casing" d={`M0 -5 V0 H${drawing.cell.toFixed(1)} V-5`} />
              <path d={`M0 -5 V0 H${drawing.cell.toFixed(1)} V-5`} />
              <text x={drawing.cell / 2} y="-8" textAnchor="middle">{meters(drawing.step)}</text>
            </g>
          </svg>
        )}
      </div>
      <ul className="visor__key">
        <li><i className="visor__swatch" />Plan</li>
        {drawing && drawing.over.length > 0 && <li><i className="visor__swatch visor__swatch--over" />Over {limit}° limit</li>}
      </ul>
    </>
  )
}

const CHART_WIDTH = 1000
const CHART_HEIGHT = 100
// Smallest elevation range the chart shows, so a few meters of relief on a
// flat walk don't fill the height and read as a hill.
const CHART_MIN_SPAN = 40

// Elevation along the route, filled by slope level, as in the planner's
// route profile.
function Profile({ route, legs, low, high }: { route: HudRoute; legs: HudLeg[]; low: number; high: number }) {
  const { samples } = route
  const total = samples.at(-1)!.d || 1
  const mid = (low + high) / 2
  const range = Math.max(CHART_MIN_SPAN, (high - low) * 1.15)
  const bottom = mid - range / 2
  const top = mid + range / 2
  const x = (d: number) => (d / total) * CHART_WIDTH
  const y = (elevation: number) => CHART_HEIGHT - ((elevation - bottom) / (top - bottom)) * CHART_HEIGHT

  const bands: ReactNode[] = []
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if (a.elevation === null || b.elevation === null) continue
    const level = slopeLevel(b.slope, route.limits.slope)
    const points = `${x(a.d)},${CHART_HEIGHT} ${x(a.d)},${y(a.elevation)} ${x(b.d)},${y(b.elevation)} ${x(b.d)},${CHART_HEIGHT}`
    bands.push(<polygon key={i} className={`visor__band is-${level}`} points={points} />)
    // Hatched as well as red, so over-limit ground does not rest on color
    // alone (NASA-STD-3001 Vol 2, V2 10045).
    if (level === 'hazard') bands.push(<polygon key={`h${i}`} className="visor__hatch" points={points} />)
  }
  // Solid on fine terrain, dashed where the terrain is coarse.
  const runs: { coarse: boolean; points: string[] }[] = []
  for (const s of samples) {
    if (s.elevation === null) continue
    const point = `${x(s.d)},${y(s.elevation)}`
    const last = runs.at(-1)
    if (last && last.coarse === s.coarse) last.points.push(point)
    else runs.push({ coarse: s.coarse, points: last ? [last.points.at(-1)!, point] : [point] })
  }
  let d = 0
  const stops = legs.slice(0, -1).map((leg) => (d += leg.length))

  return (
    <section className="visor__profile" aria-label="Elevation along the route">
      <div className="visor__chart">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id="visor-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" />
            </pattern>
          </defs>
          {bands}
          {runs.map((run, i) => (
            <polyline key={`c${i}`} className="visor__line visor__line--casing" points={run.points.join(' ')} vectorEffect="non-scaling-stroke" />
          ))}
          {runs.map((run, i) => (
            <polyline key={i} className={`visor__line${run.coarse ? ' is-coarse' : ''}`} points={run.points.join(' ')} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <span className="visor__axis visor__axis--top">{formatElevation(top)}</span>
        <span className="visor__axis visor__axis--bottom">{formatElevation(bottom)}</span>
        {stops.map((at, i) => (
          <span key={i} className="visor__mark" style={{ left: `${(at / total) * 100}%` }}>{i + 1}</span>
        ))}
      </div>
      <div className="visor__ticks">
        <span>A</span>
        <span>{meters(total / 2)}</span>
        <span>B, {meters(total)}</span>
      </div>
    </section>
  )
}

const VERDICT = { go: 'GO', caution: 'CAUTION', 'no-go': 'NO-GO' }
// The most reasons shown. The planner lists all of them.
const REASONS = 4

function Route({ route, now }: { route: HudRoute; now: number }) {
  const legs = useMemo(() => hudLegs(route), [route])
  const relief = useMemo(() => hudRelief(route.samples), [route])
  const { limits } = route
  const slope = slopeLevel(route.maxSlope, limits.slope)

  return (
    <>
      <dl className="visor__readouts">
        <Schedule route={route} now={now} />
        <Readout
          label="EVA time"
          value={formatDuration(route.total)}
          sub={`budget ${formatDuration(limits.eva)}`}
          level={route.total > limits.eva ? 'hazard' : route.total > limits.eva * 0.85 ? 'caution' : null}
        />
        <Readout label="Out, work, back" value={[route.timeOut, limits.work, route.timeBack].map((s) => Math.round(s / 60)).join(' · ')} unit="min" />
        <Readout label="Distance, one way" value={meters(route.distance)} sub={`↑ ${Math.round(relief.climb)} m  ↓ ${Math.round(relief.descent)} m`} />
        <Readout label="Walk back" value={meters(route.walkBack)} sub={`limit ${meters(limits.range)}`} level={route.walkBack > limits.range ? 'hazard' : null} />
        <Readout
          label="Max slope"
          value={degrees(route.maxSlope)}
          sub={`limit ${limits.slope}°`}
          level={slope === 'hazard' || slope === 'caution' ? slope : null}
        />
      </dl>

      {relief.low !== null && relief.high !== null && <Profile route={route} legs={legs} low={relief.low} high={relief.high} />}

      <aside className="visor__right">
        <RouteMap route={route} legs={legs} />
        <table className="visor__table">
          <thead>
            <tr><th>Leg</th><th>Bearing</th><th>Distance</th><th>Max slope</th></tr>
          </thead>
          <tbody>
            {legs.map((leg, i) => {
              const level = slopeLevel(leg.maxSlope, limits.slope)
              return (
                <tr key={leg.index}>
                  <td>{i === 0 ? 'A' : i} to {i === legs.length - 1 ? 'B' : i + 1}</td>
                  <td>{String(Math.round(leg.bearing) % 360).padStart(3, '0')}°</td>
                  <td>{meters(leg.length)}</td>
                  <td className={level === 'hazard' || level === 'caution' ? `is-${level}` : undefined}>{degrees(leg.maxSlope)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {/* Worked out from a model, not read from the suit. */}
        <table className="visor__table">
          <thead>
            <tr><th colSpan={2}>Estimated, not measured</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Peak load, cooling to {Math.round(route.peakLimitW)} W</td>
              <td className={route.peakW > route.peakLimitW ? 'is-caution' : undefined}>{Math.round(route.peakW)} W</td>
            </tr>
            <tr><td>Oxygen</td><td>{route.oxygenKg.toFixed(2)} kg</td></tr>
            <tr><td>Water</td><td>{route.waterKg.toFixed(1)} L</td></tr>
            {route.dose !== null && <tr><td>Dose, quiet sun</td><td>{(route.dose * 1000).toFixed(3)} mSv</td></tr>}
          </tbody>
        </table>
      </aside>
    </>
  )
}

export function Hud() {
  const [id] = useState(missionId)
  const { snapshot, name } = useSnapshot(id)
  const now = useNow()
  const route = snapshot?.route ?? null
  const status = snapshot?.status ?? 'none'
  const hidden = route ? route.reasons.length - REASONS : 0

  return (
    <div className="visor">
      <header className="visor__head">
        {route ? (
          <strong className={`visor__verdict is-${route.verdict}`}>{VERDICT[route.verdict]}</strong>
        ) : (
          <p className="visor__none" role="status">
            <b>{status === 'failed' ? 'No terrain samples for the route' : status === 'updating' ? 'Assessing the route' : 'No EVA route'}</b>
            {status === 'failed' ? 'Retry in the planner.' : status === 'none' ? 'Set a start and a target on the Sites map in the planner.' : ''}
          </p>
        )}
        {/* Why the verdict is what it is, right beside it. */}
        {route && (
          <ul className="visor__reasons">
            {status === 'updating' && <li className="visor__stale" role="status">The planner is assessing the route again. This is the last one assessed.</li>}
            {status === 'failed' && <li className="visor__stale" role="status">The changed route has no terrain samples. This is the last one assessed. Retry in the planner.</li>}
            {route.reasons.slice(0, REASONS).map((reason, i) => (
              <li key={i} className={reason.level === 'no-go' ? 'is-hazard' : 'is-caution'}>{reason.text}</li>
            ))}
            {hidden > 0 && <li className="visor__more">{hidden} more {hidden === 1 ? 'reason' : 'reasons'} in the planner</li>}
          </ul>
        )}
        <p className="visor__clock"><b>{clockTime(now)}:{two(new Date(now).getUTCSeconds())}</b> UTC</p>
      </header>

      {route && <Route route={route} now={now} />}

      {route && snapshot && (
        <footer className="visor__foot">
          {name && <>{name} · </>}
          {route.startName ?? formatLatLon(...route.samples[0].point)} to {formatLatLon(...route.samples.at(-1)!.point)} · Planned route,
          assessed {day(snapshot.savedAt)} {clockTime(snapshot.savedAt)} UTC. Position is not tracked.
        </footer>
      )}
    </div>
  )
}
