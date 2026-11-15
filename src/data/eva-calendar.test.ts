import { expect, test } from 'bun:test'
import { dateKey, monthGrid, windowsByDate } from './eva-calendar'
import { findWindows } from './eva-window'

const GALE: [number, number] = [-4.5895, 137.4417]
const NOW = Date.parse('2026-11-15T10:00:00Z')

test('November 2026 starts on a Sunday and takes six weeks, Monday first', () => {
  const weeks = monthGrid(2026, 10)
  expect(weeks.length).toBe(6)
  expect(weeks[0]!.slice(0, 6)).toEqual([null, null, null, null, null, null])
  expect(dateKey(weeks[0]![6]!)).toBe('2026-11-01')
  expect(dateKey(weeks[5]![0]!)).toBe('2026-11-30')
  expect(weeks.every((week) => week.length === 7)).toBe(true)
})

test('each sol with a window is filed under the UTC date it starts on', () => {
  const search = findWindows({ point: GALE, duration: 2 * 3600, now: NOW, sols: 10 })
  const days = windowsByDate(search)
  expect(days.size).toBeGreaterThanOrEqual(9)
  for (const [key, w] of days) {
    expect(dateKey(w.start)).toBe(key)
    expect(w.start).toBeGreaterThan(NOW)
  }
})
