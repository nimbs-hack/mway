import type { RouteField } from './route-field'
import type { RoutePlan } from './route-options'
import type { Limits } from './limits'
import type { LatLon } from './geo'
import type { PlannerResult, PlannerTask } from './planner.worker'

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>
type Request = { legs: RouteField[]; stops: LatLon[]; limits: Limits; key: string; publish: (plan: RoutePlan, note: string | null) => void; fail: () => void }
type Job = { kind: 'route'; leg: RouteField; key: string } | { kind: 'join'; request: Request }

// Search one changed leg at a time. Edits replace the queued work; a result
// already in flight can fill the cache, but only the current route publishes.
export function createRouteSearch(makeWorker: () => WorkerPort = () => new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' })) {
  const cache = new WeakMap<RouteField, { key: string; plan: RoutePlan }>()
  let current: Request | undefined
  let active: Job | undefined
  let worker: WorkerPort | undefined
  const pump = () => {
    if (!current || active) return
    const request = current
    const leg = request.legs.find((item) => cache.get(item)?.key !== request.key)
    try {
      if (!worker) {
        worker = makeWorker()
        worker.onmessage = ({ data }: MessageEvent<PlannerResult>) => {
          if (active?.kind === 'route' && data.kind === 'route') {
            cache.set(active.leg, { key: active.key, plan: data.plan })
          } else if (active?.kind === 'join' && data.kind === 'join') {
            if (current === active.request) {
              current = undefined
              active.request.publish(data.plan, data.note)
            }
          } else return
          active = undefined
          pump()
        }
        worker.onerror = () => {
          const failed = current
          current = undefined
          active = undefined
          worker?.terminate()
          worker = undefined
          failed?.fail()
        }
      }
      if (leg) {
        active = { kind: 'route', leg, key: request.key }
        worker.postMessage({ kind: 'route', leg, limits: request.limits } satisfies PlannerTask)
      } else {
        active = { kind: 'join', request }
        worker.postMessage({
          kind: 'join', plans: request.legs.map((item) => cache.get(item)!.plan), stops: request.stops,
          fields: request.legs.some((item) => item.thermalPending || item.slopesPending) ? null
            : request.legs.map((item) => ({ slope: item.field.slope, thermal: item.field.thermal })),
        } satisfies PlannerTask)
      }
    } catch {
      current = undefined
      active = undefined
      worker?.terminate()
      worker = undefined
      request.fail()
    }
  }
  return {
    update(legs: RouteField[], limits: Limits, stops: LatLon[], publish: Request['publish'], fail: Request['fail']) {
      current = { legs, limits, stops, key: JSON.stringify(limits), publish, fail }
      pump()
    },
    cancel() { current = undefined },
    destroy() { current = undefined; active = undefined; worker?.terminate(); worker = undefined },
  }
}
