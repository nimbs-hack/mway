import type { View } from './scene'

// Where the astronaut looks, and how the head, the helmet and the display
// move with it. Angles in degrees, time in seconds. No randomness: the same
// time always gives the same view.

export type Look = { yaw: number; pitch: number }

// The heading the look-around starts from and returns to.
export const HEADING = 205

// A look-around, as [seconds, yaw from HEADING, pitch]. Each ends where it
// starts, so it loops.
type Keys = [number, number, number][]
const TOURS = {
  // Holds on the ground ahead, turns left to the mountain, drops to the rocks
  // at the feet, sweeps right into the sun and comes back.
  slow: [
    [0, 0, -9], [2.5, 0, -9], [6.5, -58, 2], [9, -62, 3], [12, -24, -34], [14.5, -14, -36],
    [18.5, 52, -6], [21.5, 78, 9], [23.5, 80, 8], [27.5, 4, -7], [30, 0, -9],
  ],
  // The same places in six seconds: quick glances, as when checking footing.
  quick: [
    [0, 0, -9], [0.5, 0, -9], [1.25, -56, 3], [1.9, -60, 4], [2.7, -16, -31], [3.2, -12, -33],
    [4.1, 62, 4], [4.7, 70, 7], [5.6, 2, -8], [6, 0, -9],
  ],
} satisfies Record<string, Keys>
export type TourName = keyof typeof TOURS
export const tourName = (value: string | null): TourName => (value === 'quick' ? 'quick' : 'slow')
export const tourSeconds = (name: TourName) => TOURS[name].at(-1)![0]

const SWAY = (2 * Math.PI) / 6
const ease = (x: number) => x * x * x * (x * (x * 6 - 15) + 10)

export function tour(time: number, name: TourName = 'slow'): Look {
  const keys: Keys = TOURS[name]
  const length = tourSeconds(name)
  const t = ((time % length) + length) % length
  let i = 1
  while (i < keys.length - 1 && keys[i][0] <= t) i++
  const [t0, yaw0, pitch0] = keys[i - 1]
  const [t1, yaw1, pitch1] = keys[i]
  const k = ease((t - t0) / (t1 - t0))
  // A head is never quite still. SWAY repeats every six seconds, so this
  // loops with either tour.
  const drift = 0.7 * Math.sin(time * SWAY) + 0.4 * Math.sin(time * 2 * SWAY + 1)
  const nod = 0.5 * Math.sin(time * SWAY + 2) + 0.3 * Math.sin(time * 2 * SWAY)
  return { yaw: HEADING + yaw0 + (yaw1 - yaw0) * k + drift, pitch: pitch0 + (pitch1 - pitch0) * k + nod }
}

// Shortest way from one heading to another, -180 to 180.
export const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180

export const PITCH_MIN = -50
export const PITCH_MAX = 40
const EYE_HEIGHT = 1.68 // meters
// One breath. Both tours last a whole number of breaths, so a loop does not
// cut one short.
export const BREATH_SECONDS = 3

export type Pose = View & {
  // How far the display trails the head, in half screen heights.
  hud: [x: number, y: number]
}

// The head follows the look quickly and the body follows the head slowly.
// The helmet sits on the body, so its rim slides across the view until the
// body has turned too. The display trails a fast head for a moment.
export function createHead(start: Look) {
  let yaw = start.yaw
  let pitch = start.pitch
  let body = start.yaw
  let hudX = 0
  let hudY = 0

  return function step(target: Look, dt: number, time: number): Pose {
    const want = Math.min(PITCH_MAX, Math.max(PITCH_MIN, target.pitch))
    const quick = 1 - Math.exp(-dt * 9)
    const dYaw = turn(yaw, target.yaw) * quick
    const dPitch = (want - pitch) * quick
    yaw += dYaw
    pitch += dPitch
    body += turn(body, yaw) * (1 - Math.exp(-dt * 1.5))
    // The neck turns about 60° before the shoulders must.
    const neck = turn(body, yaw)
    if (Math.abs(neck) > 60) body = yaw - Math.sign(neck) * 60

    const rate = dt > 0 ? [dYaw / dt, dPitch / dt] : [0, 0]
    const lag = 1 - Math.exp(-dt * 7)
    const limit = (value: number) => Math.max(-0.03, Math.min(0.03, value))
    hudX += (limit(-rate[0] * 0.0006) - hudX) * lag
    hudY += (limit(rate[1] * 0.0006) - hudY) * lag

    // Mist on the visor grows through the breath out and clears on the way in.
    const breath = 0.5 + 0.5 * Math.sin((time / BREATH_SECONDS) * 2 * Math.PI)
    return {
      yaw: ((yaw % 360) + 360) % 360,
      pitch,
      roll: Math.max(-1.5, Math.min(1.5, -rate[0] * 0.02)) + 0.3 * Math.sin(time * SWAY),
      // Weight shifts from foot to foot, and the chest lifts with each breath.
      eye: [0.014 * Math.sin(time * SWAY), EYE_HEIGHT + 0.006 * breath, 0.008 * Math.sin(time * SWAY + 1)],
      helmet: [-0.5 * Math.sin((turn(body, yaw) * Math.PI) / 180), -0.42 * Math.sin((pitch * Math.PI) / 180)],
      breath,
      time,
      hud: [hudX, hudY],
    }
  }
}
