import { describe, expect, test } from 'bun:test'
import { assessStart, dailyCurve, DAYLIGHT_RESERVE, findWindows } from './eva-window'
import { localSolarTime, sunElevation, sunState } from './mars-time'
import type { SpaceWeather } from './space-weather'
import type { Reading } from './weather'

const GALE: [number, number] = [-4.5895, 137.4417]
const NOW = Date.parse('2026-11-15T10:00:00Z')
const HOUR = 3_600_000

const reading: Reading = {
  sol: 4995, date: '2026-08-25', ls: 341,
  airMinK: 202, airMaxK: 268, groundMinK: 189, groundMaxK: 277, pressurePa: 777,
}

const forecast = (arrival: string, glancing = false): SpaceWeather => ({
  fetchedAt: '2026-11-15T09:00:00Z',
  stale: false,
  source: 'test',
  arrivals: [{ cme: 'x', launched: '2026-11-14T00:00:00Z', speedKmS: 900, arrival, glancing, minor: false, modelRun: '', simulationId: '', link: '' }],
})

describe('Mars time', () => {
  test('matches the Mars24 worked example for 2000-01-06 00:00 UTC', () => {
    const state = sunState(Date.UTC(2000, 0, 6))
    expect(state.ls).toBeCloseTo(277.18758, 3)
    expect(state.eot).toBeCloseTo(-5.18774, 3)
    expect(state.mst).toBeCloseTo(23.99558, 3)
  })

  test('puts sunrise at Gale where Curiosity reported it on sol 4995', () => {
    // REMS gave sunrise 06:46 local mean solar time on 25 August 2026.
    const from = Date.parse('2026-08-24T12:00:00Z')
    let t = from
    while (!(sunElevation(t, ...GALE) < 0 && sunElevation(t + 60_000, ...GALE) >= 0)) t += 60_000
    const lmst = (sunState(t).mst + GALE[1] / 15 + 24) % 24
    expect(Math.abs(lmst - (6 + 46 / 60))).toBeLessThan(5 / 60)
  })
})

describe('daily curve', () => {
  test('is coldest at sunrise and warmest at the peak', () => {
    expect(dailyCurve(6, 6, 14)).toBeCloseTo(0, 5)
    expect(dailyCurve(14, 6, 14)).toBeCloseTo(1, 5)
    expect(dailyCurve(18, 6, 14)).toBeLessThan(dailyCurve(15, 6, 14))
    expect(dailyCurve(3, 6, 14)).toBeLessThan(0.1)
  })
})

describe('EVA windows', () => {
  test('keeps the Sun up from the start to an hour after the end', () => {
    const { sols, best } = findWindows({ point: GALE, duration: 3 * 3600, now: NOW, reading, space: forecast('2026-12-30T00:00:00Z') })
    expect(sols).toHaveLength(7)
    expect(best).not.toBeNull()
    for (const s of sols) {
      const w = s.best!
      expect(w.sun.min).toBeGreaterThan(0)
      expect(w.daylightLeft).toBeGreaterThanOrEqual(DAYLIGHT_RESERVE)
      expect(w.start).toBeGreaterThanOrEqual(NOW)
    }
  })

  test('picks a warm afternoon and estimates temperature from the station', () => {
    const { best } = findWindows({ point: GALE, duration: 3 * 3600, now: NOW, reading, space: forecast('2026-12-30T00:00:00Z') })
    const middle = localSolarTime((best!.start + best!.end) / 2, GALE[1])
    expect(middle).toBeGreaterThan(11)
    expect(middle).toBeLessThan(15)
    expect(best!.air!.max).toBeLessThanOrEqual(reading.airMaxK!)
    expect(best!.air!.min).toBeGreaterThan(reading.airMinK!)
  })

  test('skips a sol with a CME hit and says why', () => {
    const { sols, best } = findWindows({ point: GALE, duration: 3 * 3600, now: NOW, reading, space: forecast('2026-11-15T16:00:00Z') })
    expect(sols[0]!.best!.verdict).toBe('no-go')
    expect(sols[0]!.best!.reasons[0]!.text).toContain('CME')
    expect(best!.verdict).not.toBe('no-go')
    expect(best!.start).toBeGreaterThan(sols[0]!.best!.start)
  })

  test('cautions past the forecast horizon and without a forecast', () => {
    const { sols } = findWindows({ point: GALE, duration: 2 * 3600, now: NOW, reading, space: forecast('2026-12-30T00:00:00Z') })
    expect(sols.at(-1)!.best!.reasons.map((r) => r.text)).toContain('EVA is past the CME forecast horizon')
    const none = findWindows({ point: GALE, duration: 2 * 3600, now: NOW, reading: null, space: null })
    expect(none.best!.verdict).toBe('caution')
    expect(none.best!.air).toBeNull()
  })

  test('calls a night start no-go', () => {
    const { sols } = findWindows({ point: GALE, duration: 2 * 3600, now: NOW })
    const night = sols[1]!.noon + 12 * HOUR
    const w = assessStart({ point: GALE, duration: 2 * 3600, now: NOW }, night)
    expect(w.verdict).toBe('no-go')
    expect(w.reasons[0]!.text).toBe('Sun is down during the EVA')
    // The daylight reason on its own, for the route verdict.
    expect(w.daylight).toEqual({ level: 'no-go', text: 'Sun is down during the EVA' })
  })

  test('starts an EVA that outlasts the day at sunrise, and calls it no-go', () => {
    const { best, sols } = findWindows({ point: GALE, duration: 13 * 3600, now: NOW })
    expect(best).not.toBeNull()
    expect(best!.verdict).toBe('no-go')
    expect(best!.reasons[0]!.text).toBe('Sun is down during the EVA')
    // The start is the first step after a sunrise, the most light it can get.
    const sol = sols.find((s) => s.best === best)!
    expect(best!.start - sol.sunrise!).toBeLessThan(600_000)
    expect(best!.start).toBeGreaterThan(NOW)
  })
})
