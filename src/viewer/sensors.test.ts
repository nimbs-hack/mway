import { expect, test } from 'bun:test'
import { SUIT } from '../data/suit'
import { LEAK_LIMIT_KG_S, TANK_KG, readSuitSensors, readingLevels, worstLevel } from './sensors'

test('one reading for each crew member, in crew order', () => {
  expect(readSuitSensors(6, 0).map((r) => r.member)).toEqual([0, 1, 2, 3, 4, 5])
  expect(readSuitSensors(0, 0)).toEqual([])
})

test('readings stay in usual ranges for a suited walk', () => {
  for (const seconds of [0, 100, 1000, 5000]) {
    for (const r of readSuitSensors(6, seconds)) {
      expect(r.heartRateBpm).toBeGreaterThan(90)
      expect(r.heartRateBpm).toBeLessThan(140)
      expect(r.spo2).toBeGreaterThan(0.95)
      expect(r.spo2).toBeLessThanOrEqual(1)
      expect(r.coreTempK - 273.15).toBeGreaterThan(36.5)
      expect(r.coreTempK - 273.15).toBeLessThan(38)
      expect(r.metabolicW).toBeLessThan(SUIT.limitW)
      expect(r.suitPressurePa).toBeGreaterThan(29_000)
    }
  }
})

test('oxygen use follows metabolic rate by the plan ratio', () => {
  for (const r of readSuitSensors(3, 400)) expect(r.oxygenUseKgS).toBeCloseTo(r.metabolicW * SUIT.oxygenKgPerJ, 12)
})

test('oxygen and energy are used up over time, never below empty', () => {
  const [before] = readSuitSensors(1, 0)
  const [after] = readSuitSensors(1, 600)
  expect(after!.oxygenLeftKg).toBeLessThan(before!.oxygenLeftKg)
  expect(after!.energyJ).toBeGreaterThan(before!.energyJ)
  // Ten minutes at about the average rate.
  expect(after!.energyJ - before!.energyJ).toBeCloseTo(SUIT.baseW * 600, -4)
  expect(before!.oxygenLeftKg).toBeLessThan(TANK_KG)
  const [late] = readSuitSensors(1, 40 * 3600)
  expect(late!.oxygenLeftKg).toBe(0)
  expect(readingLevels(late!).oxygenTime).toBe('hazard')
})

test('the leaking suit is a caution, the others are clear', () => {
  const readings = readSuitSensors(6, 0)
  expect(readings.map(worstLevel)).toEqual(['ok', 'ok', 'ok', 'caution', 'ok', 'ok'])
  expect(readingLevels(readings[3]!).leak).toBe('caution')
  expect(readings[3]!.leakKgS).toBeLessThan(LEAK_LIMIT_KG_S)
})

test('a frozen clock gives the same reading', () => {
  expect(readSuitSensors(2, 300)).toEqual(readSuitSensors(2, 300))
})
