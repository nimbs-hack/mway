import { expect, test } from 'bun:test'
import { OBSERVATIONS } from './science-observations'
import { SITES } from './sites'

test('historical records have unique IDs and resolve to existing mission sites', () => {
  const siteIds = new Set(SITES.map((site) => site.id))
  expect(new Set(OBSERVATIONS.map((record) => record.id)).size).toBe(OBSERVATIONS.length)
  for (const record of OBSERVATIONS) {
    expect(record.siteIds.length).toBeGreaterThan(0)
    expect(new Set(record.siteIds).size).toBe(record.siteIds.length)
    for (const siteId of record.siteIds) expect(siteIds.has(siteId)).toBe(true)
  }
})

test('all four requested subjects have a cited numerical reference', () => {
  const categories = new Set(OBSERVATIONS.filter((record) =>
    record.measurements.length > 0 && new URL(record.sourceUrl).protocol === 'https:',
  ).map((record) => record.category))
  for (const category of ['radiation', 'atmospheric', 'chemical', 'geophysical']) {
    expect(categories.has(category)).toBe(true)
  }
})

test('stored readings use finite SI values and fractions rather than display prefixes', () => {
  const unitsByCategory = {
    thermal: new Set(['K']),
    radiation: new Set(['Sv/day', 'Gy/day']),
    atmospheric: new Set(['K', 'Pa', 'm/s']),
    chemical: new Set(['mol/mol', 'kg/kg']),
    geophysical: new Set(['m/s', 'm/s²', 'm', 's', 'Hz']),
  }
  for (const record of OBSERVATIONS) {
    for (const measurement of record.measurements) {
      expect(Number.isFinite(measurement.value)).toBe(true)
      expect(unitsByCategory[record.category].has(measurement.unit)).toBe(true)
      if (['mol/mol', 'kg/kg'].includes(measurement.unit)) {
        expect(measurement.value).toBeGreaterThanOrEqual(0)
        expect(measurement.value).toBeLessThanOrEqual(1)
      }
      if (['K', 'Pa', 'Sv/day', 'Gy/day'].includes(measurement.unit)) {
        expect(measurement.value).toBeGreaterThanOrEqual(0)
      }
    }
  }
})
