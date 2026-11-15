import { BREATH_SECONDS } from './look'

// SIMULATED suit readings for the helmet view. No sensor and no model is
// behind them: they are smooth curves around typical values, so the display
// has numbers that move. The page labels them "Suit, simulated". Do not show
// them anywhere as measurements.
//
// Typical values: 29.6 kPa is the 4.3 psi of NASA's current EVA suits, and
// carbon dioxide in a helmet stays well under 1 kPa. Heart rate is that of
// steady walking.

export type SuitReadings = {
  // Seconds since the EVA began.
  elapsed: number
  // Beats per minute.
  heart: number
  // Suit pressure, pascals.
  pressure: number
  // Carbon dioxide partial pressure in the helmet, pascals.
  carbonDioxide: number
}

// The view opens this far into the walk.
const ELAPSED_AT_START = 12 * 60 + 38

export function suitReadings(time: number): SuitReadings {
  // 1 at the end of a breath out, -1 at the end of a breath in.
  const breath = Math.sin((time / BREATH_SECONDS) * 2 * Math.PI)
  return {
    elapsed: ELAPSED_AT_START + time,
    heart: 104 + 5 * Math.sin(time * 0.9) + 3 * Math.sin(time * 2.3 + 1),
    pressure: 29_600 + 45 * breath,
    carbonDioxide: 340 + 50 * breath,
  }
}

// Hours, minutes and seconds: 0:12:41.
export function elapsedText(seconds: number) {
  const whole = Math.floor(seconds)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(whole / 3600)}:${two(Math.floor(whole / 60) % 60)}:${two(whole % 60)}`
}

// A heading as three digits, 000 to 359.
export const headingText = (degrees: number) => String(Math.round(degrees) % 360).padStart(3, '0')

// What a compass tape writes under a tick: a letter on the four cardinal
// points, three digits elsewhere.
export function tickLabel(degrees: number) {
  const heading = ((degrees % 360) + 360) % 360
  return { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[heading] ?? headingText(heading)
}
