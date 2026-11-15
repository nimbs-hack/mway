import { describe, expect, test } from 'bun:test'
import { BREATH_SECONDS, HEADING, PITCH_MAX, PITCH_MIN, createHead, tour, tourName, tourSeconds, turn } from './look'
import { cameraBasis } from './scene'

describe('turn', () => {
  test('takes the short way across north', () => {
    expect(turn(350, 10)).toBe(20)
    expect(turn(10, 350)).toBe(-20)
    expect(turn(90, 90)).toBe(0)
  })
})

describe('tour', () => {
  test.each(['slow', 'quick'] as const)('the %s tour starts on the heading and comes back to it, so the animation loops', (name) => {
    const start = tour(0, name)
    const end = tour(tourSeconds(name) - 0.001, name)
    expect(Math.abs(turn(HEADING, start.yaw))).toBeLessThan(2)
    expect(Math.abs(turn(start.yaw, end.yaw))).toBeLessThan(3)
    expect(Math.abs(start.pitch - end.pitch)).toBeLessThan(3)
    // A whole number of breaths, so the loop does not cut one short.
    expect(tourSeconds(name) % BREATH_SECONDS).toBe(0)
  })

  test('an unknown tour name means the slow one', () => {
    expect(tourName('quick')).toBe('quick')
    expect(tourName('nonsense')).toBe('slow')
    expect(tourName(null)).toBe('slow')
  })

  test('the same time gives the same look', () => {
    expect(tour(12.34)).toEqual(tour(12.34))
  })

  test('never asks for more than the neck allows', () => {
    for (const name of ['slow', 'quick'] as const) {
      for (let t = 0; t < tourSeconds(name); t += 0.1) {
        const { pitch } = tour(t, name)
        expect(pitch).toBeGreaterThan(PITCH_MIN)
        expect(pitch).toBeLessThan(PITCH_MAX)
      }
    }
  })
})

describe('createHead', () => {
  const settle = (head: ReturnType<typeof createHead>, yaw: number, pitch: number, seconds: number) => {
    let pose = head({ yaw, pitch }, 0, 0)
    for (let t = 0; t < seconds; t += 1 / 60) pose = head({ yaw, pitch }, 1 / 60, t)
    return pose
  }

  test('the rim slides in when the head turns and recenters once the body follows', () => {
    const head = createHead({ yaw: 0, pitch: 0 })
    const turning = settle(head, 50, 0, 0.5)
    // Looking right, the opening sits left of the middle of the view.
    expect(turning.helmet[0]).toBeLessThan(-0.2)
    const held = settle(head, 50, 0, 8)
    expect(Math.abs(held.helmet[0])).toBeLessThan(0.01)
    expect(Math.abs(turn(held.yaw, 50))).toBeLessThan(0.1)
  })

  test('looking down raises the lower rim for as long as the head stays down', () => {
    const head = createHead({ yaw: 0, pitch: 0 })
    const down = settle(head, 0, -30, 8)
    expect(down.helmet[1]).toBeCloseTo(0.42 * Math.sin((30 * Math.PI) / 180), 2)
  })

  test('the look stops at the neck limits', () => {
    const head = createHead({ yaw: 0, pitch: 0 })
    expect(settle(head, 0, -90, 5).pitch).toBeCloseTo(PITCH_MIN, 1)
    expect(settle(head, 0, 90, 5).pitch).toBeCloseTo(PITCH_MAX, 1)
  })

  test('the display trails a fast head by a little and then rests', () => {
    const head = createHead({ yaw: 0, pitch: 0 })
    let most = 0
    for (let t = 0; t < 1; t += 1 / 60) most = Math.max(most, Math.abs(head({ yaw: 120, pitch: 0 }, 1 / 60, t).hud[0]))
    expect(most).toBeGreaterThan(0.005)
    expect(most).toBeLessThanOrEqual(0.03)
    expect(Math.abs(settle(head, 120, 0, 6).hud[0])).toBeLessThan(0.001)
  })
})

describe('cameraBasis', () => {
  const columns = (m: number[]) => [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  test('heading 0 looks north with east on the right', () => {
    const [right, up, forward] = columns(cameraBasis(0, 0, 0))
    const near = (axis: number[], want: number[]) => axis.forEach((value, i) => expect(value).toBeCloseTo(want[i]))
    near(forward, [0, 0, 1])
    near(right, [1, 0, 0])
    near(up, [0, 1, 0])
  })

  test('heading 90 looks east, and pitch lifts the view', () => {
    const [, , east] = columns(cameraBasis(90, 0, 0))
    expect(east[0]).toBeCloseTo(1)
    expect(east[2]).toBeCloseTo(0)
    expect(columns(cameraBasis(0, 30, 0))[2][1]).toBeCloseTo(0.5)
  })

  test('the three axes stay square to each other at any attitude', () => {
    const [right, up, forward] = columns(cameraBasis(217, -33, 1.2))
    for (const axis of [right, up, forward]) expect(dot(axis, axis)).toBeCloseTo(1)
    expect(dot(right, up)).toBeCloseTo(0)
    expect(dot(right, forward)).toBeCloseTo(0)
    expect(dot(up, forward)).toBeCloseTo(0)
  })
})
