import { expect, test } from 'bun:test'
import { CME_MARGIN, HORIZON, checkSpaceWeather, formatFrom, formatWhen } from './space-weather'
import { levelForSpacing } from './terrain-detail'

const now = Date.parse('2026-11-14T12:00:00Z')
const hours = (h) => now + h * 3_600_000
const arrival = (h, extra = {}) => ({ cme: `c${h}`, arrival: new Date(hours(h)).toISOString(), glancing: false, minor: false, modelRun: new Date(hours(-24)).toISOString(), ...extra })
const report = (arrivals, stale = false) => ({ fetchedAt: new Date(now).toISOString(), stale, source: 'test', arrivals })

test('a full CME hit inside the window and margin is no-go', () => {
  // Arrives 10 h after the EVA ends, inside the 12 h margin.
  const check = checkSpaceWeather(report([arrival(24)]), hours(10), hours(14), now)
  expect(check.during).toHaveLength(1)
  expect(check.reasons[0]).toEqual({ level: 'no-go', text: 'CME reaches Mars 15 Nov 12:00 UTC, during the EVA' })
  // 16 h after the EVA ends is outside it.
  expect(checkSpaceWeather(report([arrival(30)]), hours(10), hours(14), now).reasons).toEqual([])
  expect(CME_MARGIN).toBe(12 * 3_600_000)
})

test('glancing or minor hits are caution, and next and last are found', () => {
  const check = checkSpaceWeather(report([arrival(-20), arrival(5, { glancing: true }), arrival(80)]), hours(0), hours(4), now)
  expect(check.reasons.map((r) => r.level)).toEqual(['caution'])
  expect(check.last.cme).toBe('c-20')
  expect(check.next.cme).toBe('c5')
})

test('missing, stale or too-distant forecasts are caution', () => {
  expect(checkSpaceWeather(null, hours(0), hours(4), now).reasons[0].text).toBe('No space weather forecast')
  expect(checkSpaceWeather(report([], true), hours(0), hours(4), now).reasons[0].text).toMatch(/out of date/)
  const later = checkSpaceWeather(report([]), now + HORIZON + 3_600_000, now + HORIZON + 7_200_000, now)
  expect(later.reasons[0].text).toBe('EVA is past the CME forecast horizon')
})

test('times read in UTC and relative to now', () => {
  expect(formatWhen('2026-11-13T12:00:00Z')).toBe('13 Nov 12:00 UTC')
  expect(formatFrom(new Date(hours(30)).toISOString(), now)).toBe('in 1 d 6 h')
  expect(formatFrom(new Date(hours(-20)).toISOString(), now)).toBe('20 h ago')
})

test('grid spacing picks a terrain level that resolves it without waste', () => {
  // 15.6 m cells want terrain of 7.8 m or finer: level 15, 5.1 m.
  expect(levelForSpacing(15.6)).toBe(15)
  expect(levelForSpacing(15.6, 12)).toBe(12)
  expect(levelForSpacing(5000)).toBe(9)
  expect(levelForSpacing(1)).toBe(17)
})
