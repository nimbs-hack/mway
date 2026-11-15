import { describe, expect, test } from 'bun:test'
import { elapsedText, headingText, suitReadings, tickLabel } from './suit-sim'

describe('suitReadings', () => {
  test('the same time gives the same readings on each loop', () => {
    expect(suitReadings(3.21)).toEqual(suitReadings(3.21))
  })

  test('stays near typical values for as long as anyone would watch', () => {
    for (let t = 0; t < 600; t += 0.37) {
      const now = suitReadings(t)
      expect(now.heart).toBeGreaterThan(90)
      expect(now.heart).toBeLessThan(120)
      expect(Math.abs(now.pressure - 29_600)).toBeLessThan(100)
      expect(now.carbonDioxide).toBeGreaterThan(250)
      expect(now.carbonDioxide).toBeLessThan(450)
    }
  })

  test('the elapsed time runs at one second per second', () => {
    expect(suitReadings(10).elapsed - suitReadings(4).elapsed).toBe(6)
  })
})

test('elapsedText writes hours, minutes and seconds', () => {
  expect(elapsedText(0)).toBe('0:00:00')
  expect(elapsedText(761.9)).toBe('0:12:41')
  expect(elapsedText(3600 + 62)).toBe('1:01:02')
})

test('headings are three digits and wrap at north', () => {
  expect(headingText(7.4)).toBe('007')
  expect(headingText(359.6)).toBe('000')
  expect(tickLabel(360)).toBe('N')
  expect(tickLabel(-90)).toBe('W')
  expect(tickLabel(210)).toBe('210')
})
