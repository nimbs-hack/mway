import type { Reason } from './plan'

// CMEs forecast to reach Mars, from WSA-ENLIL runs in NASA DONKI, read
// through the Go server at /api/spaceweather. Times are UTC ISO strings.

export type Arrival = {
  cme: string
  launched: string
  speedKmS: number
  arrival: string
  glancing: boolean
  minor: boolean
  modelRun: string
  simulationId: string
  link: string
}

export type SpaceWeather = {
  fetchedAt: string
  stale: boolean
  source: string
  arrivals: Arrival[]
}

export async function fetchSpaceWeather(signal?: AbortSignal): Promise<SpaceWeather> {
  const response = await fetch('/api/spaceweather', { signal })
  if (!response.ok) throw new Error(`Space weather returned ${response.status}`)
  return response.json()
}

// Margin on both sides of the EVA. ENLIL arrival times at Earth miss by
// roughly 10 hours on average, and Mars is farther out, so 12 hours is a
// planning assumption, not a model error bar.
export const CME_MARGIN = 12 * 3600 * 1000

// A full hit, or only the edge of the CME or a weak one.
export function strength(a: Arrival) {
  return a.glancing || a.minor ? 'glancing' : 'full'
}

export type SpaceCheck = {
  // Arrivals within the EVA window plus margin, earliest first.
  during: Arrival[]
  // The next arrival after now, and the latest one before now.
  next: Arrival | null
  last: Arrival | null
  reasons: Reason[]
}

const DAY = 86_400_000
// How far ahead a CME forecast can see. See checkSpaceWeather.
export const HORIZON = 2 * DAY

export function formatWhen(iso: string) {
  const d = new Date(iso)
  const month = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })
  return `${d.getUTCDate()} ${month} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

// "in 1 d 6 h" or "20 h ago", to the hour.
export function formatFrom(iso: string, now: number) {
  const ms = Date.parse(iso) - now
  const hours = Math.round(Math.abs(ms) / 3_600_000)
  const text = hours >= 24 ? `${Math.floor(hours / 24)} d${hours % 24 ? ` ${hours % 24} h` : ''}` : `${hours} h`
  return ms >= 0 ? `in ${text}` : `${text} ago`
}

/**
 * Checks forecast CME arrivals against the EVA window. A full hit within
 * the margin is no-go. A glancing or minor one is caution. A missing
 * forecast is caution too: no news is not good news for radiation.
 */
export function checkSpaceWeather(report: SpaceWeather | null, start: number, end: number, now: number): SpaceCheck {
  if (!report) {
    return { during: [], next: null, last: null, reasons: [{ level: 'caution', text: 'No space weather forecast' }] }
  }
  const arrivals = [...report.arrivals].sort((a, b) => Date.parse(a.arrival) - Date.parse(b.arrival))
  const during = arrivals.filter((a) => {
    const t = Date.parse(a.arrival)
    return t >= start - CME_MARGIN && t <= end + CME_MARGIN
  })
  const reasons: Reason[] = during.map((a) => (strength(a) === 'full'
    ? { level: 'no-go', text: `CME reaches Mars ${formatWhen(a.arrival)}, during the EVA` }
    : { level: 'caution', text: `Glancing CME at Mars ${formatWhen(a.arrival)}` }))
  if (report.stale) reasons.push({ level: 'caution', text: 'Space weather forecast is out of date' })
  // Forecasts only cover CMEs already launched. The fastest reach Mars in
  // about 2 days, so an EVA further out than that can still be hit by one
  // that hasn't left the Sun yet.
  if (start > now + HORIZON && !during.length) {
    reasons.push({ level: 'caution', text: 'EVA is past the CME forecast horizon' })
  }
  return {
    during,
    next: arrivals.find((a) => Date.parse(a.arrival) > now) ?? null,
    last: [...arrivals].reverse().find((a) => Date.parse(a.arrival) <= now) ?? null,
    reasons,
  }
}
