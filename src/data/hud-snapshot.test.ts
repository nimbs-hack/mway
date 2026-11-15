import { describe, expect, test } from 'bun:test'
import { hudKey, hudLegs, hudRelief, hudRoute, loadHud, saveHud } from './hud-snapshot'
import type { HudRoute } from './hud-snapshot'
import { DEFAULT_LIMITS } from './plan'

function memory() {
  const kept = new Map<string, string>()
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  }
}

// 300 m due north in 100 m steps, with one steep sample in the second leg.
const route: HudRoute = {
  startName: null,
  when: null,
  limits: { ...DEFAULT_LIMITS, slope: 20 },
  samples: [0, 100, 200, 300].map((d, i) => ({
    d,
    point: [d / 59_274.7, 137],
    elevation: [10, 14, 12, 30][i],
    slope: [2, 4, 3, 25][i],
    coarse: false,
  })),
  marks: [100, 300],
  verdict: 'no-go',
  reasons: [{ level: 'no-go', text: 'Leg 2: 100 m over 20°' }],
  distance: 300,
  timeOut: 400,
  timeBack: 380,
  total: 4380,
  maxSlope: 25,
  walkBack: 300,
  dose: null,
  peakW: 300,
  peakLimitW: 617,
  oxygenKg: 0.2,
  waterKg: 1,
}

describe('saveHud and loadHud', () => {
  test('a saved route comes back for its own mission only', () => {
    const storage = memory()
    saveHud('a', 'ready', route, storage, 1000)
    expect(loadHud('a', storage)).toEqual({ version: 1, savedAt: 1000, status: 'ready', route })
    expect(loadHud('b', storage)).toBeNull()
    expect(hudKey('a')).not.toBe(hudKey())
  })

  test('a changed route keeps the last assessed one and its time', () => {
    const storage = memory()
    saveHud('a', 'ready', route, storage, 1000)
    saveHud('a', 'updating', null, storage, 2000)
    expect(loadHud('a', storage)).toEqual({ version: 1, savedAt: 1000, status: 'updating', route })
    saveHud('a', 'failed', null, storage, 3000)
    expect(loadHud('a', storage)?.status).toBe('failed')
    expect(loadHud('a', storage)?.route).toEqual(route)
  })

  test('a cleared plan drops the route', () => {
    const storage = memory()
    saveHud('a', 'ready', route, storage, 1000)
    saveHud('a', 'none', null, storage, 2000)
    expect(loadHud('a', storage)).toEqual({ version: 1, savedAt: 2000, status: 'none', route: null })
  })

  test('anything that is not a snapshot reads as nothing', () => {
    const storage = memory()
    storage.setItem(hudKey('a'), '{"version":2}')
    expect(loadHud('a', storage)).toBeNull()
    storage.setItem(hudKey('a'), 'not json')
    expect(loadHud('a', storage)).toBeNull()
    storage.setItem(hudKey('a'), JSON.stringify({ version: 1, savedAt: 1, status: 'ready', route: { samples: [] } }))
    expect(loadHud('a', storage)).toBeNull()
  })
})

describe('hudLegs', () => {
  test('one leg per stop, with its own length, slope and bearing', () => {
    const legs = hudLegs(route)
    expect(legs.map((leg) => leg.length)).toEqual([100, 200])
    expect(legs.map((leg) => leg.maxSlope)).toEqual([4, 25])
    expect(legs.map((leg) => leg.over)).toEqual([0, 100])
    expect(Math.round(legs[0].bearing) % 360).toBe(0)
    expect(legs[1].from).toEqual(legs[0].to)
  })

  test('a route with no stops is one leg to the target', () => {
    const legs = hudLegs({ ...route, marks: [300] })
    expect(legs).toHaveLength(1)
    expect(legs[0].length).toBe(300)
  })

  // The planner measures 405.4809 m and the snapshot keeps 405.5. The
  // target's mark must round the same way, or it reads as a stop just short
  // of the end, with a second leg of 0 m after it.
  test('the target is not a stop when the distance has decimals', () => {
    const saved = hudRoute({
      plan: { start: [0, 137], target: [0.00684, 137], waypoints: [] },
      limits: route.limits,
      samples: [0, 405.4809].map((d) => ({ d, point: [d / 59_274.7, 137], elevation: 0, slope: 2, detail: 1 })),
      assessment: { verdict: 'go', reasons: [], distance: 405.4809, timeOut: 1, timeBack: 1, total: 2, maxSlope: 2, walkBack: 405.4809, dose: null, suit: { peakW: 1, oxygenKg: 1, waterKg: 1 } },
      marks: [405.4809],
      coarseDetail: 20,
      peakLimitW: 617,
    } as unknown as Parameters<typeof hudRoute>[0])
    expect(hudLegs(saved)).toHaveLength(1)
  })
})

test('hudRelief adds up climb and descent and skips unknown ground', () => {
  const samples = route.samples.map((s, i) => (i === 1 ? { ...s, elevation: null } : s))
  expect(hudRelief(route.samples)).toEqual({ climb: 22, descent: 2, low: 10, high: 30 })
  expect(hudRelief(samples)).toEqual({ climb: 20, descent: 0, low: 10, high: 30 })
})
