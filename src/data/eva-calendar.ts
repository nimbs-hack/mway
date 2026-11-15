// The EVA start calendar: the best start of each sol in the search, filed
// under its UTC date, and the month grids to show them on. Dates are UTC,
// weeks start on Monday, as on ISO calendars.

import type { EvaWindow, WindowSearch } from './eva-window'

const DAY = 86_400_000

// 'YYYY-MM-DD' of a UTC time.
export const dateKey = (utc: number): string => new Date(utc).toISOString().slice(0, 10)

// The best start of each sol, by the UTC date it falls on. A sol is about 40
// minutes longer than a day, so a date now and then has no sol of its own.
export function windowsByDate(search: WindowSearch): Map<string, EvaWindow> {
  const days = new Map<string, EvaWindow>()
  for (const sol of search.sols) if (sol.best) days.set(dateKey(sol.best.start), sol.best)
  return days
}

// The weeks of a month, Monday first, each day as UTC midnight. Days of the
// months before and after fill the first and last week, as null.
export function monthGrid(year: number, month: number): Array<Array<number | null>> {
  const first = Date.UTC(year, month, 1)
  const days = new Date(Date.UTC(year, month + 1, 1) - DAY).getUTCDate()
  const lead = (new Date(first).getUTCDay() + 6) % 7
  const cells: Array<number | null> = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => first + i * DAY)]
  while (cells.length % 7) cells.push(null)
  const weeks: Array<Array<number | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}
