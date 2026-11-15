import { DEFAULT_LIMITS, EMPTY_PLAN, type Limits, type Plan } from './plan'
import type { LatLon } from './geo'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>
export type SavedEva = { plan: Plan; limits: Limits }
const legacyKey = 'nimbs.eva-plan'
const keyFor = (missionId?: string) => missionId ? `${legacyKey}:${missionId}` : legacyKey

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const point = (value: unknown): value is LatLon => Array.isArray(value) && value.length === 2
  && value.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))
  && Math.abs(value[0]) <= 90 && Math.abs(value[1]) <= 180
const points = (value: unknown): value is LatLon[] => Array.isArray(value) && value.every(point)

// A new mission must never inherit the standalone map's last route. The old
// key stays intact; only the standalone map reads it.
export function loadEva(missionId?: string, storage: StorageReader = localStorage): SavedEva {
  const empty = () => ({ plan: { ...EMPTY_PLAN, waypoints: [] }, limits: { ...DEFAULT_LIMITS } })
  try {
    const saved: unknown = JSON.parse(storage.getItem(keyFor(missionId)) ?? 'null')
    if (!record(saved) || !record(saved.plan) || !record(saved.limits)) return empty()
    const plan = saved.plan
    if (!(plan.start === null || point(plan.start)) || !(plan.target === null || point(plan.target))
      || !points(plan.waypoints) || (plan.generated !== undefined && !points(plan.generated))) return empty()
    const limits = { ...DEFAULT_LIMITS }
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
      const value = saved.limits[key] ?? limits[key]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return empty()
      limits[key] = value
    }
    return {
      plan: {
        start: plan.start,
        target: plan.target,
        waypoints: plan.waypoints,
        generated: plan.generated,
        startName: typeof plan.startName === 'string' ? plan.startName : null,
        route: typeof plan.route === 'string' ? plan.route : null,
        when: typeof plan.when === 'string' ? plan.when : null,
      },
      limits,
    }
  } catch {
    return empty()
  }
}

export function saveEva(missionId: string | undefined, eva: SavedEva, storage: StorageWriter = localStorage): void {
  try {
    storage.setItem(keyFor(missionId), JSON.stringify(eva))
  } catch {
    // A blocked or full browser store must not interrupt editing.
  }
}

// Sent when another page sets the EVA start, so an open map picks it up.
export const EVA_START_EVENT = 'nimbs:eva-start'
export type EvaStartDetail = { missionId?: string, when: string | null }

// Sets the Schedule start of a mission's EVA. `when` is a UTC ISO string,
// or null for now.
export function setEvaStart(missionId: string | undefined, when: string | null, storage: Storage = localStorage): void {
  const eva = loadEva(missionId, storage)
  saveEva(missionId, { ...eva, plan: { ...eva.plan, when } }, storage)
  window.dispatchEvent(new CustomEvent<EvaStartDetail>(EVA_START_EVENT, { detail: { missionId, when } }))
}
