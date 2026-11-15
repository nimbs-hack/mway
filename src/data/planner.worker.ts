import { areaStats, joinLegs, routeOptions, sameReason } from './route-options'
import type { Field, RoutePlan } from './route-options'
import type { LatLon } from './geo'
import type { RouteField } from './route-field'
import type { Limits } from './limits'
import { findWindows } from './eva-window'
import type { WindowInput, WindowSearch } from './eva-window'

export type PlannerTask =
  | { kind: 'route'; leg: RouteField; limits: Limits }
  | { kind: 'windows'; input: WindowInput; sols: number }
  | { kind: 'join'; plans: RoutePlan[]; stops: LatLon[]; fields: Pick<Field, 'slope' | 'thermal'>[] | null }
export type PlannerResult =
  | { kind: 'route'; plan: RoutePlan }
  | { kind: 'windows'; search: WindowSearch }
  | { kind: 'join'; plan: RoutePlan; note: string | null }

// Both searches are CPU work. No map, DOM, or terrain downloads belong here.
onmessage = ({ data }: MessageEvent<PlannerTask>) => {
  let result: PlannerResult
  if (data.kind === 'route') {
    result = { kind: 'route', plan: routeOptions(data.leg.grid, data.leg.field, data.limits, data.leg.thermalPending) }
  } else if (data.kind === 'windows') {
    result = { kind: 'windows', search: findWindows({ ...data.input, sols: data.sols }) }
  } else {
    const plan = joinLegs(data.plans, data.stops)
    const allSame = plan.options.length > 1 && plan.options.slice(1).every((option) => option.sameAs)
    const note = allSame && data.fields ? sameReason(areaStats({
      slope: data.fields.flatMap((field) => field.slope),
      thermal: data.fields.flatMap((field) => field.thermal),
    })) ?? 'All four strategies agree here.' : null
    result = { kind: 'join', plan, note }
  }
  postMessage(result)
}
