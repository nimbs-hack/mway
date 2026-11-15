import { expect, test } from 'bun:test'
import { SCALE_HEIGHT, ageDays, celsius, formatAge, formatPressure, formatTemp, nearestStation, pressureAt } from './weather'

test('pressure drops by e for one scale height of climb', () => {
  expect(pressureAt(777, -4000, -4000 + SCALE_HEIGHT)).toBeCloseTo(777 / Math.E, 6)
  expect(pressureAt(777, -4000, -4000)).toBe(777)
  // A crater rim 1 km above the rover reads about 9% lower.
  expect(pressureAt(777, -4500, -3500) / 777).toBeCloseTo(0.9116, 3)
})

test('units convert for display only', () => {
  expect(celsius(273.15)).toBe(0)
  expect(formatTemp(202.15)).toBe('-71 °C')
  expect(formatTemp(null)).toBe('—')
  expect(formatPressure(777)).toBe('7.77 hPa')
})

test('the nearest station wins', () => {
  const positions = { gale: [-4.6, 137.4], jezero: [18.4, 77.5] }
  expect(nearestStation([-5, 137], positions).id).toBe('gale')
  expect(nearestStation([18, 77], positions).id).toBe('jezero')
  expect(nearestStation([0, 0], {})).toBeNull()
})

test('reading age reads in the largest sensible unit', () => {
  const now = Date.parse('2026-11-14T12:00:00Z')
  expect(ageDays({ date: '2026-08-25' }, now)).toBe(81)
  expect(formatAge(5)).toBe('5 d ago')
  expect(formatAge(81)).toBe('3 mo ago')
  expect(formatAge(930)).toBe('2.5 yr ago')
})
