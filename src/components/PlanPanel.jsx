import { useEffect, useId, useRef, useState } from 'react'
import { distance } from '../data/geo'
import { DEFAULT_PRESET, PRESETS, SUIT, WALK_BACK_REFERENCE, formatDuration, isGenerated, presetFor, userWaypoints } from '../data/plan'
import { slopeLevel } from '../data/route-profile'
import { formatDistance, formatSlope } from './RouteProfile'
import { ageDays, celsius, formatAge } from '../data/weather'
import { CME_MARGIN, formatFrom, formatWhen, strength } from '../data/space-weather'
import { COARSE_DETAIL, detailLabel } from '../data/terrain-detail'
import { formatSolarTime } from '../data/mars-time'
import { dateKey, monthGrid } from '../data/eva-calendar'
import './plan-panel.css'

/*
 * EVA settings laid out like a 3D-printer slicer's settings panel: a limits
 * block with a preset picker, an Advanced switch and a search. The route's
 * start and target are set from the map's right-click menu or from a
 * mission site. The icon rail picks one tab of settings at a time,
 * and the tab shows only its own groups, so you focus on one concern.
 * Search looks across all tabs. A dot on a rail icon flags a tab with a
 * problem. The verdict and Walk it button sit in a dock at the bottom,
 * like Slice plate and Send print.
 *
 * Props:
 *   plan        { start, startName, target, waypoints } in [lat, lon] degrees
 *   limits      { slope °, pace m/s, eva s, work s, range m, and rocks and
 *               ripples as a share of pace }
 *   assessment  result of assess() in src/data/plan.ts, or null
 *   status      profile sampling: 'idle' | 'loading' | 'ready' | 'error'
 *   placing     'waypoint' | 'site' | null, what a map click does
 *   dose        { site, when, measurement } for the radiation reference
 *   weather     nearest rover station: { report, distance, estimate, atHigh },
 *               estimates in pascals scaled to the start and highest point
 *   space       { status, data, check, start, end, now }: CME forecasts at
 *               Mars checked against the EVA window, times in ms
 *   when        EVA start typed in, UTC ISO string, or null for automatic
 *   calendar    Map of UTC date to the best EVA window of that date's sol,
 *               over the next six weeks, or null before there is a start
 *   startCheck  { window, picked, searched, pending, failed }: the EVA start's window
 *               (src/data/eva-window), picked on the calendar or worked out
 *               from the next seven sols. Null when none was found, and
 *               searched false before there is a start point
 *   terrainDetail { finest, coarsest, coarse } in meters under the route
 *   onWhen(iso | null)
 *   onPlacing(mode), onRemoveWaypoint(index), onLimits(limits),
 *   onRetry(), onWalk(), onClear()
 *   onAddToMission  adds this EVA to the mission. Null while there is no
 *                   assessed route, undefined when no mission is open.
 *   missionSites    content of an extra rail tab, the mission's sites and
 *                   tasks. missionFlag puts a dot on its icon, and the tab
 *                   opens when missionFocus, the selected site, changes.
 *   missionPlan     content of a second extra tab, the plan: the sites in
 *                   the order the EVA visits them.
 */

const ICONS = {
  route: <path d="M4 18c3 0 3-6 8-6s5-6 8-6M4 18h.01M20 6h.01" />,
  terrain: <path d="M3 19 9 9l4 6 3-4 5 8Z" />,
  time: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  range: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  suit: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  dose: <><circle cx="12" cy="12" r="1.5" /><path d="M12 4a8 8 0 0 1 7 4l-5 3M5 8a8 8 0 0 1 7-4M5 8l5 3M12 20a8 8 0 0 1-7-4l5-3M19 16a8 8 0 0 1-7 4v-6" /></>,
  site: <path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  mission: <path d="M6 21V4m0 1h11l-2.5 4L17 13H6" />,
  stops: <path d="M10 6h10M10 12h10M10 18h10M4 5v3M3.5 12h2l-2 3h2M3.5 18h2" />,
  limits: <path d="M5 4v16M12 4v16M19 4v16M3 8h4M10 15h4M17 10h4" />,
  pick: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  weather: <path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7Z" />,
}

function Icon({ name }) {
  return (
    <svg className="plan__icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MARK = { go: { sign: '●', text: 'clear window' }, caution: { sign: '△', text: 'window with cautions' }, 'no-go': { sign: '▲', text: 'no safe window' } }
const utcTime = (t) => new Date(t).toISOString().slice(11, 16)

// The EVA start, picked on a month calendar of UTC dates. Each date in the
// search shows the best start of the sol that falls on it, marked by how good
// it is. A date picks that start, and the time field moves it within the
// date. Best goes back to the start worked out from the next seven sols.
function StartCalendar({ days, start, when, now, onWhen }) {
  const monthOf = (t) => ({ year: new Date(t).getUTCFullYear(), month: new Date(t).getUTCMonth() })
  const [shown, setShown] = useState(() => monthOf(start ?? now))
  // A new start in another month brings that month up.
  const startMonth = start ? dateKey(start).slice(0, 7) : null
  useEffect(() => {
    if (start) setShown(monthOf(start))
  }, [startMonth])
  const keys = days ? [...days.keys()].sort() : []
  const first = monthOf(now)
  const last = keys.length ? monthOf(Date.parse(keys.at(-1))) : first
  const index = (m) => m.year * 12 + m.month
  const step = (by) => setShown(({ year, month }) => monthOf(Date.UTC(year, month + by, 1)))
  const picked = start ? dateKey(start) : null
  const today = dateKey(now)
  // 24-hour UTC, typed. A browser's time field follows its locale and can
  // show 4:40 PM, so this is text that applies once it reads HH:MM.
  const [typing, setTyping] = useState(null)
  const time = typing ?? (start ? utcTime(start) : '')
  const typeTime = (text) => {
    setTyping(text)
    if (picked && /^([01]\d|2[0-3]):[0-5]\d$/.test(text)) onWhen(`${picked}T${text}:00Z`)
  }
  return (
    <div className="calendar">
      <div className="calendar__head">
        <button type="button" className="plan__tool" aria-label="Previous month" data-tip="Previous month" disabled={index(shown) <= index(first)} onClick={() => step(-1)}>‹</button>
        <strong>{MONTHS[shown.month]} {shown.year}</strong>
        <button type="button" className="plan__tool" aria-label="Next month" data-tip="Next month" disabled={index(shown) >= index(last)} onClick={() => step(1)}>›</button>
      </div>
      <table className="calendar__grid">
        <thead>
          <tr>{WEEKDAYS.map((d) => <th key={d} scope="col">{d}</th>)}</tr>
        </thead>
        <tbody>
          {monthGrid(shown.year, shown.month).map((week, w) => (
            <tr key={w}>
              {week.map((day, d) => {
                if (day === null) return <td key={d} />
                const key = dateKey(day)
                const best = days?.get(key)
                const mark = best && MARK[best.verdict]
                const label = `${new Date(day).getUTCDate()} ${MONTHS[shown.month]}`
                return (
                  <td key={d}>
                    <button
                      type="button"
                      className={`calendar__day${key === today ? ' is-today' : ''}`}
                      aria-pressed={key === picked}
                      aria-label={best ? `${label}, ${mark.text}, best start ${utcTime(best.start)} UTC` : `${label}, not searched`}
                      title={best ? `Best start ${utcTime(best.start)} UTC, ${formatSolarTime(best.startSolar)} local solar time${best.reasons.length ? `. ${best.reasons.map((r) => r.text).join('. ')}` : ''}` : undefined}
                      disabled={!best}
                      onClick={() => onWhen(new Date(best.start).toISOString().slice(0, 19) + 'Z')}
                    >
                      {new Date(day).getUTCDate()}
                      {mark && <span className={`calendar__mark is-${best.verdict === 'no-go' ? 'hazard' : best.verdict}`} aria-hidden="true">{mark.sign}</span>}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="calendar__time">
        <label className={`plan__box plan__box--edit plan__box--when${when ? ' is-modified' : ''}`}>
          <input
            type="text"
            inputMode="numeric"
            maxLength={5}
            placeholder="HH:MM"
            aria-label="EVA start time, UTC, 24-hour"
            disabled={!start}
            value={time}
            onChange={(event) => typeTime(event.target.value)}
            onBlur={() => setTyping(null)}
          />
          <span className="plan__unit">UTC</span>
        </label>
        {when && (
          <button type="button" className="plan__tool plan__tool--text" onClick={() => onWhen(null)} title="Go back to the best window of the next seven sols, worked out from the Sun, temperature and space weather">
            Best
          </button>
        )}
      </div>
      <ul className="calendar__key">
        {Object.entries(MARK).map(([verdict, { sign, text }]) => (
          <li key={verdict}><span className={`calendar__mark is-${verdict === 'no-go' ? 'hazard' : verdict}`} aria-hidden="true">{sign}</span> {text[0].toUpperCase() + text.slice(1)}</li>
        ))}
      </ul>
    </div>
  )
}

// Editable limits. Display units convert to and from the SI values in limits.
// The ranges only keep out values the model cannot use, such as no time or
// no speed. They are not mission rules: the presets and the verdict say what
// is advisable. `why` explains a bound that comes from a standard.
const FIELDS = {
  slope: { unit: '°', step: 1, min: 1, max: 60, toView: (v) => v, fromView: (v) => v },
  pace: { unit: 'km/h', step: 0.1, min: 0.1, max: 20, toView: (v) => +(v * 3.6).toFixed(1), fromView: (v) => v / 3.6 },
  eva: { unit: 'h', step: 0.5, min: 0.5, max: 24, toView: (v) => +(v / 3600).toFixed(2), fromView: (v) => v * 3600 },
  work: { unit: 'min', step: 5, min: 0, max: 1440, toView: (v) => Math.round(v / 60), fromView: (v) => v * 60 },
  range: {
    unit: 'km', step: 0.25, min: 0.25, max: WALK_BACK_REFERENCE / 1000, toView: (v) => +(v / 1000).toFixed(2), fromView: (v) => v * 1000,
    why: 'the walk-back NASA-STD-3001 sizes suit water for [V2 11030]',
  },
  climb: { unit: 'm/h', step: 10, min: 10, max: 10000, toView: (v) => Math.round(v * 3600), fromView: (v) => v / 3600 },
  descent: { unit: 'm/h', step: 10, min: 10, max: 10000, toView: (v) => Math.round(v * 3600), fromView: (v) => v / 3600 },
  // Speed on rough ground never drops under 5% of the flat speed (groundPace).
  rocks: { unit: '%', step: 1, min: 5, max: 100, toView: (v) => Math.round(v * 100), fromView: (v) => v / 100 },
  ripples: { unit: '%', step: 1, min: 5, max: 100, toView: (v) => Math.round(v * 100), fromView: (v) => v / 100 },
}

// Same value within float noise from unit conversion.
function same(a, b) {
  return Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b))
}

// An editable limit. When it differs from the preset it was based on, the box
// is marked and a reset button shows the preset value, as slicers do.
function NumberField({ field, value, base, presetName, onChange, label }) {
  const spec = FIELDS[field]
  const [draft, setDraft] = useState(null)
  const shown = draft ?? String(spec.toView(value))
  const modified = base !== undefined && !same(value, base)
  // Typed text the limits cannot take stays in the box, unapplied, with the
  // range under it. Nothing is changed behind the user's back.
  const typed = draft === null || draft === '' ? null : Number(draft)
  const outside = typed !== null && !(typed >= spec.min && typed <= spec.max)
  const commit = (text) => {
    const n = Number(text)
    if (text !== '' && n >= spec.min && n <= spec.max) onChange(spec.fromView(n))
  }
  const presetValue = modified ? `${spec.toView(base)} ${spec.unit}` : null
  return (
    <>
    <label className={`plan__box plan__box--edit${modified ? ' is-modified' : ''}`} title={modified ? `${presetName}: ${presetValue}` : undefined}>
      {modified && (
        <button
          type="button"
          className="plan__reset"
          onClick={() => { setDraft(null); onChange(base) }}
          aria-label={`Reset ${label} to ${presetName} value, ${presetValue}`}
        >
          ↺
        </button>
      )}
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={outside || undefined}
        step={spec.step}
        min={spec.min}
        max={spec.max}
        value={shown}
        onChange={(event) => {
          setDraft(event.target.value)
          commit(event.target.value)
        }}
        onBlur={() => !outside && setDraft(null)}
      />
      <span className="plan__unit">{spec.unit}</span>
    </label>
    {outside && (
      <span className="plan__invalid" role="alert">
        Not applied. {label} takes {spec.min} to {spec.max} {spec.unit}.{spec.why ? ` ${spec.max} ${spec.unit} is ${spec.why}.` : ''} Still using {spec.toView(value)} {spec.unit}.
      </span>
    )}
    </>
  )
}

function Value({ children, unit, level }) {
  return (
    <span className={`plan__box${level ? ` is-${level}` : ''}`}>
      <output>{children}</output>
      {unit && <span className="plan__unit">{unit}</span>}
    </span>
  )
}

function Row({ label, hint, wide, children }) {
  return (
    <div className={`plan__row${wide ? ' plan__row--wide' : ''}`} title={hint}>
      <span className="plan__label">{label}</span>
      {children}
    </div>
  )
}

// Space weather rows: CMEs forecast to reach Mars, checked against the EVA
// window. Strength wording follows DONKI: a glancing blow or minor impact
// is the CME's edge or a weak one.
function spaceRows(space) {
  const group = 'Space weather'
  if (!space || space.status === 'loading') return [{ label: 'During EVA', group, basic: true, node: <Value>…</Value> }]
  if (!space.data) return [{ label: 'During EVA', group, basic: true, node: <Value level="caution">No forecast</Value> }]
  const { check, now } = space
  const margin = `${CME_MARGIN / 3_600_000} h`
  const during = check?.during ?? []
  const worst = during.some((x) => strength(x) === 'full') ? 'hazard' : during.length ? 'caution' : null
  const describe = (x) => `${strength(x) === 'full' ? 'Full hit' : 'Glancing'}, ${Math.round(x.speedKmS)} km/s, ${formatWhen(x.arrival)}`
  const rows = [
    { label: 'During EVA', group, basic: true, hint: `CME arrivals from ${margin} before the start to ${margin} after the end. Arrival forecasts can be off by about that much.`, node: <Value level={worst}>{during.length ? `${strength(during[0]) === 'full' ? 'CME' : 'Glancing CME'} ${formatFrom(during[0].arrival, now)}` : 'Clear'}</Value> },
    { label: 'Next CME at Mars', group, basic: true, hint: check?.next ? describe(check.next) : 'Forecasts only cover CMEs already launched.', node: <Value>{check?.next ? formatFrom(check.next.arrival, now) : 'None forecast'}</Value> },
    { label: 'Last CME at Mars', group, basic: false, hint: check?.last ? describe(check.last) : undefined, node: <Value>{check?.last ? formatFrom(check.last.arrival, now) : 'None in 30 d'}</Value> },
  ]
  const run = check?.next ?? check?.last
  if (run?.link) {
    rows.push({ label: 'Model run', group, basic: false, hint: `${space.data.source}. Checked ${formatWhen(space.data.fetchedAt)}.`, node: (
      <span className="plan__box"><a className="plan__out" href={run.link} target="_blank" rel="noopener noreferrer">{run.simulationId.replace('WSA-ENLIL/', 'ENLIL ')} ↗</a></span>
    ) })
  }
  return rows
}

// Weather tab rows from the nearest rover station. Values arrive in SI and
// convert here for display only.
function weatherRows(weather) {
  const r = weather?.report
  const latest = r?.latest
  if (!weather) return [{ label: 'Station', group: 'Station', basic: true, node: <Value>Pick a start</Value> }]
  if (!r || r === 'error' || !latest) {
    return [{ label: 'Station', group: 'Station', basic: true, node: <Value>{r === 'error' ? 'Feed unavailable' : 'Loading…'}</Value> }]
  }
  const age = ageDays(latest)
  const source = `${r.rover} ${r.instrument}, ${r.site}`
  const temp = (k) => (k == null ? '—' : Math.round(celsius(k)))
  const hpa = (pa) => (pa == null ? '—' : (pa / 100).toFixed(2))
  const scaled = 'Scaled from the station with a 10.8 km scale height. Ignores weather between the two places.'
  return [
    { label: 'Station', group: 'Station', basic: true, hint: `${source}${r.stale ? '. Feed down, showing the last copy.' : ''}`, node: <Value>{r.rover} {r.instrument}</Value> },
    { label: 'Latest sol', group: 'Station', basic: true, hint: latest.date, node: <Value unit={formatAge(age)} level={age !== null && age > STALE_DAYS ? 'caution' : null}>{latest.sol}</Value> },
    { label: 'Distance', group: 'Station', basic: false, node: <Value unit={weather.distance >= 1000 ? 'km' : 'm'}>{weather.distance >= 1000 ? (weather.distance / 1000).toFixed(1) : Math.round(weather.distance)}</Value> },
    { label: 'Season Ls', group: 'Station', basic: false, hint: 'Solar longitude. 0° is northern spring, 90° summer, 180° autumn, 270° winter.', node: <Value unit="°">{latest.ls == null ? '—' : Math.round(latest.ls)}</Value> },
    { label: 'Air low', group: 'Air', basic: true, node: <Value unit="°C">{temp(latest.airMinK)}</Value> },
    { label: 'Air high', group: 'Air', basic: true, node: <Value unit="°C">{temp(latest.airMaxK)}</Value> },
    { label: 'Ground low', group: 'Air', basic: false, node: <Value unit="°C">{temp(latest.groundMinK)}</Value> },
    { label: 'Ground high', group: 'Air', basic: false, node: <Value unit="°C">{temp(latest.groundMaxK)}</Value> },
    { label: 'At station', group: 'Pressure', basic: true, node: <Value unit="hPa">{hpa(latest.pressurePa)}</Value> },
    { label: 'At start', group: 'Pressure', basic: true, hint: scaled, node: <Value unit="hPa">{weather.estimate == null ? '—' : `≈ ${hpa(weather.estimate)}`}</Value> },
    { label: 'At highest point', group: 'Pressure', basic: false, hint: scaled, node: <Value unit="hPa">{weather.atHigh == null ? '—' : `≈ ${hpa(weather.atHigh)}`}</Value> },
    { label: 'Sky', group: 'Sky', basic: true, node: <Value>{latest.opacity || '—'}</Value> },
    { label: 'UV', group: 'Sky', basic: false, node: <Value>{latest.uv || '—'}</Value> },
    { label: 'Sunrise', group: 'Sky', basic: false, hint: 'Local mean solar time at the station', node: <Value unit="LMST">{latest.sunrise || '—'}</Value> },
    { label: 'Sunset', group: 'Sky', basic: false, hint: 'Local mean solar time at the station', node: <Value unit="LMST">{latest.sunset || '—'}</Value> },
    { label: 'Trend', group: `Last ${r.history.length} sols`, basic: true, full: true, node: <Trend history={r.history} /> },
  ]
}

// Whole minutes for a value box with a "min" unit.
function minutes(seconds) {
  return Math.round(seconds / 60)
}

const BASE_KEY = 'nimbs.plan-b.preset'

function loadBase() {
  try {
    return localStorage.getItem(BASE_KEY) ?? DEFAULT_PRESET
  } catch {
    return DEFAULT_PRESET
  }
}

function saveBase(id) {
  try {
    localStorage.setItem(BASE_KEY, id)
  } catch {
    // Not remembered without storage.
  }
}

const CATS = [
  { id: 'route', icon: 'route', title: 'Route' },
  { id: 'terrain', icon: 'terrain', title: 'Terrain' },
  { id: 'time', icon: 'time', title: 'Time' },
  { id: 'range', icon: 'range', title: 'Walk-back' },
  { id: 'suit', icon: 'suit', title: 'Suit load' },
  { id: 'dose', icon: 'dose', title: 'Radiation' },
  { id: 'weather', icon: 'weather', title: 'Weather' },
]
const MISSION_CAT = { id: 'mission', icon: 'mission', title: 'Sites' }
const PLAN_CAT = { id: 'stops', icon: 'stops', title: 'Plan' }

// A reading older than this is flagged on the rail. The rovers report about
// once a sol, so a month without one means the feed stopped.
const STALE_DAYS = 30

// Air temperature range and pressure over recent sols, one column per sol.
function Trend({ history }) {
  const temps = history.filter((r) => r.airMinK != null && r.airMaxK != null)
  const pressures = history.filter((r) => r.pressurePa != null)
  if (temps.length < 2 && pressures.length < 2) return null
  const first = history[0].sol
  const last = history.at(-1).sol
  const x = (sol) => ((sol - first) / Math.max(1, last - first)) * 100
  const lowT = Math.min(...temps.map((r) => r.airMinK))
  const highT = Math.max(...temps.map((r) => r.airMaxK))
  const lowP = Math.min(...pressures.map((r) => r.pressurePa))
  const highP = Math.max(...pressures.map((r) => r.pressurePa))
  const yT = (k) => 38 - ((k - lowT) / Math.max(1, highT - lowT)) * 36
  const yP = (pa) => 38 - ((pa - lowP) / Math.max(1, highP - lowP)) * 36
  return (
    <div className="plan__trend">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        {temps.map((r) => <line key={r.sol} className="plan__trend-band" x1={x(r.sol)} x2={x(r.sol)} y1={yT(r.airMinK)} y2={yT(r.airMaxK)} vectorEffect="non-scaling-stroke" />)}
        <polyline className="plan__trend-line" points={pressures.map((r) => `${x(r.sol)},${yP(r.pressurePa)}`).join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>
      <p>
        <span>Sol {first} to {last}</span>
        <span><i className="plan__key plan__key--band" aria-hidden="true" />Air {Math.round(celsius(lowT))} to {Math.round(celsius(highT))} °C</span>
        <span><i className="plan__key plan__key--line" aria-hidden="true" />Pressure {(lowP / 100).toFixed(2)} to {(highP / 100).toFixed(2)} hPa</span>
      </p>
    </div>
  )
}

// Index among the stops of plan.waypoints[i], which is a stop.
function stopIndex(plan, i) {
  return userWaypoints({ ...plan, waypoints: plan.waypoints.slice(0, i) }).length
}

export default function PlanPanel({
  plan, limits, assessment, status, placing, dose, weather, space, when, startCheck = null, calendar = null, terrainDetail,
  onWhen, onPlacing, onRemoveWaypoint, onLimits, onRetry, onWalk, onClear, onAddToMission,
  missionSites, missionPlan, missionFlag = null, missionFocus = -1,
}) {
  const searchId = useId()
  const [advanced, setAdvanced] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('route')
  // The verdict shows its first reason. The rest open under it on request.
  const [allReasons, setAllReasons] = useState(false)
  const extras = { mission: missionSites, stops: missionPlan }
  const cats = [...(missionSites ? [MISSION_CAT] : []), ...(missionPlan ? [PLAN_CAT] : []), ...CATS]
  // Picking a mission site, on the map or by adding one, opens its tab.
  useEffect(() => {
    if (missionSites && missionFocus >= 0) setActive('mission')
  }, [missionFocus])
  const rail = useRef(null)
  // The preset stays chosen while you edit. Edits show as changes from it.
  const [baseId, setBaseId] = useState(() => presetFor(limits)?.id ?? loadBase())
  const base = PRESETS.find((p) => p.id === baseId) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET)
  const changes = Object.keys(base.limits).filter((key) => !same(limits[key], base.limits[key]))
  // Follow preset matches when limits change from the map controls.
  const exact = presetFor(limits)?.id
  useEffect(() => {
    if (exact && exact !== baseId) setBaseId(exact)
  }, [exact, baseId])
  useEffect(() => saveBase(baseId), [baseId])
  const field = (key, label) => (
    <NumberField field={key} label={label} value={limits[key]} base={base.limits[key]} presetName={base.name} onChange={set(key)} />
  )
  const a = assessment
  const ready = Boolean(plan.start && plan.target)
  const pending = status === 'loading' ? '…' : '—'

  // Arrow keys move between tabs, as in any tab list.
  const onRailKey = (event) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = (cats.findIndex((cat) => cat.id === active) + step + cats.length) % cats.length
    setActive(cats[index].id)
    rail.current?.querySelectorAll('button')[index]?.focus()
  }

  const set = (key) => (value) => onLimits({ ...limits, [key]: value })
  const match = (label) => !query || label.toLowerCase().includes(query.toLowerCase())

  // A leg stat added up over the route.
  const sum = (key) => (a ? a.legs.reduce((total, leg) => total + leg[key], 0) : 0)

  // Rows per category. Basic rows always show. Advanced rows need the switch
  // or a search that matches them.
  const rows = {
    route: [
      { label: 'Waypoints', group: 'Points', basic: true, node: (
        <span className="plan__box plan__box--action">
          <output>{userWaypoints(plan).length}</output>
          <button type="button" aria-pressed={placing === 'waypoint'} disabled={!ready} onClick={() => onPlacing(placing === 'waypoint' ? null : 'waypoint')}>
            {placing === 'waypoint' ? 'Done' : 'Add'}
          </button>
        </span>
      ) },
      { label: 'Distance one way', group: 'Points', basic: true, node: <Value unit={a ? (a.distance >= 1000 ? 'km' : 'm') : undefined}>{a ? (a.distance >= 1000 ? (a.distance / 1000).toFixed(2) : Math.round(a.distance)) : pending}</Value> },
      { label: 'Straight line', group: 'Points', basic: false, node: <Value unit={ready ? (distance(plan.start, plan.target) >= 1000 ? 'km' : 'm') : undefined}>{!ready ? '—' : distance(plan.start, plan.target) >= 1000 ? (distance(plan.start, plan.target) / 1000).toFixed(2) : Math.round(distance(plan.start, plan.target))}</Value> },
      ...(a ? a.legs.map((leg, i) => ({
        label: `Leg ${leg.index}`,
        group: 'Legs',
        wide: true,
        basic: true,
        node: (
          <span className={`plan__box plan__box--leg is-${slopeLevel(leg.maxSlope, limits.slope)}`}>
            <output>{formatDistance(leg.length)} · {formatSlope(leg.maxSlope)}</output>
            {i < plan.waypoints.length && !isGenerated(plan, plan.waypoints[i]) && (
              <button type="button" onClick={() => onRemoveWaypoint(stopIndex(plan, i))} aria-label={`Remove stop ${stopIndex(plan, i) + 1}`} title={`Remove stop ${stopIndex(plan, i) + 1}`}>×</button>
            )}
          </span>
        ),
      })) : []),
    ],
    terrain: [
      { label: 'Slope limit', group: 'Limit', basic: true, node: field('slope', 'Slope limit') },
      { label: 'Caution from', group: 'Limit', basic: false, node: <Value unit="°">{limits.slope - 5}</Value> },
      { label: 'Max slope', group: 'This route', basic: true, node: <Value unit="°" level={a && slopeLevel(a.maxSlope, limits.slope)}>{a?.maxSlope != null ? Math.round(a.maxSlope) : pending}</Value> },
      { label: 'Over limit', group: 'This route', basic: true, node: <Value unit="m" level={a && a.legs.some((l) => l.over > 0) ? 'hazard' : null}>{a ? Math.round(a.legs.reduce((s, l) => s + l.over, 0)) : pending}</Value> },
      { label: 'Near limit', group: 'This route', basic: false, node: <Value unit="m">{a ? Math.round(a.legs.reduce((s, l) => s + l.caution, 0)) : pending}</Value> },
      { label: 'No terrain data', group: 'This route', basic: false, node: <Value unit="m">{a ? Math.round(a.legs.reduce((s, l) => s + l.unknown, 0)) : pending}</Value> },
      { label: 'Finest', group: 'Detail', basic: false, hint: 'Ground spacing of the best elevation model under the route. Fine terrain shows scarps a few meters high.', node: <Value>{terrainDetail ? detailLabel(terrainDetail.finest) : pending}</Value> },
      { label: 'Coarsest', group: 'Detail', basic: true, hint: `Coarser than ${COARSE_DETAIL} m hides boulders and small scarps, so slope there is a smoothed lower bound. Dashed outlines on the map mark fine terrain.`, node: <Value level={terrainDetail && terrainDetail.coarsest > COARSE_DETAIL ? 'caution' : null}>{terrainDetail ? detailLabel(terrainDetail.coarsest) : pending}</Value> },
      { label: 'On coarse terrain', group: 'Detail', basic: true, node: <Value unit="m" level={terrainDetail?.coarse > 0 ? 'caution' : null}>{terrainDetail ? Math.round(terrainDetail.coarse) : pending}</Value> },
      { label: 'Over rocks', group: 'Ground in HiRISE', basic: true, hint: 'Sharp shadows that point every way: boulders, blocks and ledges. Estimated from the image. Rocks under about 1 m and low-contrast ground do not show.', node: <Value unit="m" level={sum('rocks') > 0 ? 'caution' : null}>{a ? Math.round(sum('rocks')) : pending}</Value> },
      { label: 'Over ripples', group: 'Ground in HiRISE', basic: true, hint: 'Shadows that line up: wind ripples and dunes, usually loose sand. Estimated from the image.', node: <Value unit="m" level={sum('ripples') > 0 ? 'caution' : null}>{a ? Math.round(sum('ripples')) : pending}</Value> },
      { label: 'No image', group: 'Ground in HiRISE', basic: true, hint: 'No HiRISE image was read here, so rocks are unknown, not absent. The mosaics cover the four rover sites.', node: <Value unit="m" level={sum('unchecked') > 0 ? 'caution' : null}>{a ? Math.round(sum('unchecked')) : pending}</Value> },
    ],
    time: [
      { label: 'EVA start', group: 'Schedule', basic: true, full: true, node: (
        <StartCalendar days={calendar} start={space?.start ?? null} when={when} now={space?.now ?? Date.now()} onWhen={onWhen} />
      ) },
      { label: 'Start chosen', group: 'Schedule', basic: true, wide: true, hint: 'How the EVA start was set. Space weather and the verdict are checked against this start.', node: (
        <Value level={!startCheck?.searched ? null : !startCheck.window ? 'caution' : { go: null, caution: 'caution', 'no-go': 'hazard' }[startCheck.window.verdict]}>
          {!startCheck?.searched
            ? 'Now, until there is a start point'
            : startCheck.pending
              ? 'Finding a start window…'
              : startCheck.failed
                ? <>Start window unavailable. <button type="button" onClick={onRetry}>Retry</button></>
            : !startCheck.window
              ? 'Now: no daylight in the next 7 sols'
              : `${startCheck.picked ? 'Your pick' : startCheck.window.verdict === 'go' ? 'Best window' : 'Best available'}, ${formatSolarTime(startCheck.window.startSolar)} local${startCheck.window.reasons.length ? `. ${startCheck.window.reasons[0].text}` : ''}`}
        </Value>
      ) },
      { label: 'EVA end', group: 'Schedule', basic: true, wide: true, hint: 'Start plus the route time, or the whole budget before there is a route.', node: <Value unit={space ? 'UTC' : undefined}>{space ? formatWhen(new Date(space.end).toISOString()).replace(' UTC', '') : '—'}</Value> },
      { label: 'EVA budget', group: 'Budget', basic: true, node: field('eva', 'EVA budget') },
      { label: 'Time at target', group: 'Budget', basic: true, node: field('work', 'Time at target') },
      { label: 'Flat speed', group: 'Speed', basic: true, hint: 'Over level ground', node: field('pace', 'Flat speed') },
      { label: 'Climb rate', group: 'Speed', basic: false, hint: 'Height gained per hour, added to the time for the distance', node: field('climb', 'Climb rate') },
      { label: 'Descent rate', group: 'Speed', basic: false, hint: 'Height lost per hour, added to the time for the distance', node: field('descent', 'Descent rate') },
      { label: 'On rocks', group: 'Speed', basic: false, hint: 'Share of the flat speed kept over rocks. Assumed: no suited walking speed over rocks is published.', node: field('rocks', 'Speed on rocks') },
      { label: 'On ripples', group: 'Speed', basic: false, hint: 'Share of the flat speed kept over ripples. From walking on loose sand at 2.1 times the energy of a road (Soule and Goldman 1972), at the same effort.', node: field('ripples', 'Speed on ripples') },
      { label: 'Walk out', group: 'This route', basic: false, node: <Value unit="min">{a ? minutes(a.timeOut) : pending}</Value> },
      { label: 'Walk back', group: 'This route', basic: false, node: <Value unit="min">{a ? minutes(a.timeBack) : pending}</Value> },
      { label: 'EVA total', group: 'This route', basic: true, node: <Value level={a && a.total > limits.eva ? 'hazard' : null}>{a ? formatDuration(a.total) : pending}</Value> },
    ],
    range: [
      { label: 'Walk-back limit', group: 'Limit', basic: true, hint: `NASA sizes suit water for a ${WALK_BACK_REFERENCE / 1000} km walk back after a rover failure (NASA-STD-3001 Vol 2, V2 11030), so the limit stops there.`, node: field('range', 'Walk-back limit') },
      { label: 'Walk back', group: 'This route', basic: true, hint: 'Along the route from the target, the farthest point', node: <Value unit="km" level={a && a.walkBack > limits.range ? 'hazard' : null}>{a ? (a.walkBack / 1000).toFixed(2) : pending}</Value> },
      { label: 'Max from start', group: 'This route', basic: false, hint: 'Straight line', node: <Value unit="km">{a ? (a.maxFromStart / 1000).toFixed(2) : pending}</Value> },
    ],
    suit: [
      { label: 'Peak rate', group: 'Metabolic, estimated', basic: true, hint: `Apollo EVA average of ${Math.round(SUIT.baseW)} W plus lifting ${SUIT.massKg} kg of crew and suit up each climb. Estimated, not measured. Over ${Math.round(SUIT.limitW)} W is past what NASA sizes suit cooling for.`, node: <Value unit="W" level={a && a.suit.peakW > SUIT.limitW ? 'caution' : null}>{a ? Math.round(a.suit.peakW) : pending}</Value> },
      { label: 'Average rate', group: 'Metabolic, estimated', basic: true, node: <Value unit="W">{a ? Math.round(a.suit.averageW) : pending}</Value> },
      { label: 'Energy', group: 'Metabolic, estimated', basic: false, hint: 'Replace with food after the EVA (NASA-STD-3001 V2 7004)', node: <Value unit="kcal">{a ? Math.round(a.suit.energyJ / 4184) : pending}</Value> },
      { label: 'Oxygen', group: 'Consumables', basic: true, hint: 'Breathed, from the energy estimate, plus suit loss. BVAD Tables 3-33 and 4-75.', node: <Value unit="kg">{a ? a.suit.oxygenKg.toFixed(2) : pending}</Value> },
      { label: 'Water', group: 'Consumables', basic: true, hint: `Drinking ${SUIT.drinkKgPerHour * 1000} mL/h (V2 11030) plus suit cooling ${SUIT.coolingKgPerHour * 1000} mL/h (BVAD Table 4-75)`, node: <Value unit="L">{a ? a.suit.waterKg.toFixed(1) : pending}</Value> },
    ],
    weather: weatherRows(weather),
    dose: [
      ...spaceRows(space),
      { label: 'Dose rate', group: 'Reference', basic: false, hint: dose ? `${dose.site} RAD mean, ${dose.when}` : undefined, node: <Value unit="mSv/day">{dose ? (dose.measurement.value * 1000).toFixed(2) : '—'}</Value> },
      { label: 'EVA dose', group: 'This route', basic: true, hint: dose ? `${dose.site} RAD mean, ${dose.when}. Assumes a quiet sun; a solar particle event can raise it many times over.` : undefined, node: <Value unit="mSv">{a?.dose != null ? (a.dose * 1000).toFixed(3) : pending}</Value> },
    ],
    // The mission tabs hold lists, not setting rows.
    mission: [],
    stops: [],
  }

  const visible = (row) => (query ? match(row.label) : advanced || row.basic)
  const weatherAge = weather?.report?.latest ? ageDays(weather.report.latest) : null

  // Worst state per tab, for the dot on its rail icon.
  const flags = {
    route: null,
    terrain: !a ? null : sum('over') > 0 ? 'hazard' : sum('caution') > 0 || sum('unknown') > 0 || sum('coarse') > 0 || sum('rocks') > 0 || sum('ripples') > 0 || sum('unchecked') > 0 ? 'caution' : null,
    time: !a ? null : a.total > limits.eva ? 'hazard' : a.total > limits.eva * 0.85 ? 'caution' : null,
    range: a && a.walkBack > limits.range ? 'hazard' : null,
    suit: a && a.suit.peakW > SUIT.limitW ? 'caution' : null,
    dose: space?.check?.reasons.some((r) => r.level === 'no-go') ? 'hazard' : space?.check?.reasons.length ? 'caution' : null,
    weather: weatherAge !== null && weatherAge > STALE_DAYS ? 'caution' : null,
    mission: missionFlag,
    stops: null,
  }

  // One tab, or every tab's matches while searching.
  const tabs = query ? CATS : CATS.filter((cat) => cat.id === active)
  const showMission = Boolean(extras[active]) && !query
  const panel = tabs.map((cat) => {
    const shown = rows[cat.id].filter(visible)
    const groups = [...new Set(shown.map((row) => row.group))]
    return { cat, groups: groups.map((group) => ({ group, rows: shown.filter((row) => row.group === group) })) }
  }).filter((tab) => tab.groups.length)
  const current = cats.find((cat) => cat.id === active)

  return (
    <aside className="plan" aria-label="EVA plan">
      <div className="plan__rail" role="tablist" aria-label="Settings" aria-orientation="vertical" ref={rail} onKeyDown={onRailKey}>
        {cats.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            id={`plan-tab-${cat.id}`}
            aria-selected={!query && active === cat.id}
            aria-controls="plan-panel"
            tabIndex={active === cat.id ? 0 : -1}
            onClick={() => { setActive(cat.id); setQuery('') }}
            aria-label={flags[cat.id] ? `${cat.title}, ${flags[cat.id] === 'hazard' ? 'over a limit' : 'near a limit'}` : cat.title}
            title={cat.title}
          >
            <Icon name={cat.icon} />
            <span className="plan__rail-label" aria-hidden="true">{cat.title}</span>
            {flags[cat.id] && <span className={`plan__flag is-${flags[cat.id]}`} aria-hidden="true" />}
          </button>
        ))}
      </div>

      <div className="plan__main">
        {showMission && (
          <section className="plan__card plan__card--limits" aria-label={current.title}>
            <div className="plan__scroll" id="plan-panel" role="tabpanel" aria-labelledby={`plan-tab-${active}`}>
              <h3 className="plan__tab-title"><Icon name={current.icon} />{current.title}</h3>
              {extras[active]}
            </div>
          </section>
        )}
        <section className="plan__card plan__card--limits" aria-label="Limits" hidden={showMission}>
          <div className="plan__card-head">
            <h2 className="plan__card-title"><Icon name="limits" />Limits</h2>
            <label className="plan__switch">
              Advanced
              <input type="checkbox" role="switch" checked={advanced} onChange={() => setAdvanced(!advanced)} />
              <span aria-hidden="true" />
            </label>
          </div>
          <div className={`plan__line${changes.length ? ' plan__line--reset' : ''}`}>
            <select
              className={`plan__select${changes.length ? ' is-modified' : ''}`}
              aria-label="Limit preset"
              value={base.id}
              onChange={(event) => {
                const next = PRESETS.find((p) => p.id === event.target.value)
                if (!next) return
                setBaseId(next.id)
                onLimits(next.limits)
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.limits.slope}° · {formatDuration(p.limits.eva)}
                </option>
              ))}
            </select>
            {changes.length > 0 && (
              <button type="button" className="plan__tool plan__tool--text" onClick={() => onLimits(base.limits)} title={`Reset all to ${base.name}`}>
                Reset
              </button>
            )}
            <button type="button" className="plan__tool" aria-pressed={searching} aria-controls={searchId} aria-label="Search settings" title="Search settings" onClick={() => { setSearching(!searching); setQuery('') }}>
              <Icon name="search" />
            </button>
          </div>
          {searching && (
            <input id={searchId} className="plan__search" type="search" placeholder="Find a setting" value={query} autoFocus onChange={(event) => setQuery(event.target.value)} />
          )}

          <div className="plan__scroll" id={showMission ? undefined : 'plan-panel'} role="tabpanel" aria-labelledby={query ? undefined : `plan-tab-${active}`} aria-label={query ? 'Search results' : undefined}>
            {!query && (
              <h3 className="plan__tab-title"><Icon name={current.icon} />{current.title}</h3>
            )}
            {panel.map(({ cat, groups }) => (
              <div key={cat.id}>
                {query && (
                  <button   type="button" className="plan__tab-title plan__tab-title--link" onClick={() => { setActive(cat.id); setQuery('') }}>
                    <Icon name={cat.icon} />{cat.title}
                  </button>
                )}
                {groups.map(({ group, rows: list }) => (
                  <section key={group} className="plan__cat" aria-label={group}>
                    <h4 className="plan__cat-title">{group}</h4>
                    {list.map((row) => (row.full
                      ? <div key={row.label} className="plan__row plan__row--full">{row.node}</div>
                      : <Row key={row.label} label={row.label} hint={row.hint} wide={row.wide}>{row.node}</Row>))}
                  </section>
                ))}
              </div>
            ))}
            {query && !panel.length && <p className="plan__note">No setting matches.</p>}
            {!query && !advanced && rows[active].some((row) => !row.basic) && (
              <button type="button" className="plan__more-rows" onClick={() => setAdvanced(true)}>
                {rows[active].filter((row) => !row.basic).length} more in Advanced
              </button>
            )}
          </div>
        </section>

        <footer className="plan__dock">
          {status === 'error' ? (
            <div className="plan__verdict is-caution">
              <strong>No terrain</strong>
              <button type="button" className="plan__link" onClick={onRetry}>Retry</button>
            </div>
          ) : a ? (
            <div className={`plan__verdict is-${a.verdict}`} role="status">
              <strong>{a.verdict === 'no-go' ? 'No-go' : a.verdict === 'go' ? 'Go' : 'Caution'}</strong>
              <span>{a.reasons[0]?.text ?? `${formatDuration(a.total)} of ${formatDuration(limits.eva)}`}</span>
              {a.reasons.length > 1 && (
                <button type="button" className="plan__more" aria-expanded={allReasons} onClick={() => setAllReasons(!allReasons)}>
                  {allReasons ? 'Fewer' : `${a.reasons.length - 1} more ${a.reasons.length === 2 ? 'reason' : 'reasons'}`}
                </button>
              )}
              {allReasons && a.reasons.length > 1 && (
                <ul className="plan__reasons">
                  {a.reasons.slice(1).map((r) => <li key={r.text} className={`is-${r.level}`}>{r.text}</li>)}
                </ul>
              )}
            </div>
          ) : startCheck?.failed ? (
            <div className="plan__verdict is-caution" role="status">
              <strong>Start window unavailable</strong>
              <button type="button" className="plan__link" onClick={onRetry}>Retry</button>
            </div>
          ) : (
            <div className="plan__verdict">
              <span>{status === 'loading' ? 'Sampling terrain…' : startCheck?.pending ? 'Finding a start window…' : !plan.start ? 'Right-click the map or use a site to set a start' : 'Right-click the map or use a site to set a target'}</span>
            </div>
          )}
          <div className="plan__actions">
            <button type="button" className="plan__button" onClick={onClear} disabled={!plan.start}>Clear</button>
            <button type="button" className="plan__button plan__button--primary" onClick={onWalk} disabled={!a}>Walk it</button>
            {onAddToMission !== undefined && (
              <button
                type="button"
                className="plan__button plan__button--wide"
                onClick={onAddToMission ?? undefined}
                disabled={!onAddToMission}
                title="Adds a site at the target with one EVA task as long as this EVA"
              >
                Add EVA to mission
              </button>
            )}
          </div>
        </footer>
      </div>
    </aside>
  )
}
