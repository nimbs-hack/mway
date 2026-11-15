import type { LatLon } from './geo'
import type { RouteField } from './route-field'
import { yieldTask } from './yield-task'

type LoadLeg = (start: LatLon, target: LatLon, publish: (field: RouteField) => void, signal: AbortSignal) => Promise<void>
type Entry = {
  start: LatLon
  target: LatLon
  controller: AbortController
  status: 'queued' | 'loading' | 'done' | 'error'
  field?: RouteField
}

// Keep samples and in-flight work for unchanged directed legs. Only the
// current route is retained; splitting or removing a leg cancels its work.
export function createRouteFields(load: LoadLeg) {
  let entries = new Map<string, Entry>()
  let order: string[] = []
  let active = 0
  let disposed = false
  let publish: (fields: RouteField[]) => void = () => {}
  let fail: () => void = () => {}
  let last: RouteField[] = []
  const notify = () => {
    if (disposed || !order.length) return
    const wanted = order.map((key) => entries.get(key)!)
    if (wanted.some((entry) => entry.status === 'error')) return fail()
    const fields = wanted.map((entry) => entry.field)
    if (fields.every((field) => field !== undefined) && (fields.length !== last.length || fields.some((field, i) => field !== last[i]))) {
      last = fields
      publish(fields)
    }
  }
  const pump = () => {
    if (disposed) return
    for (const entry of entries.values()) {
      if (active >= 2) break
      if (entry.status !== 'queued') continue
      entry.status = 'loading'
      active++
      let released = false
      const release = () => {
        if (released) return
        released = true
        active--
        entry.controller.signal.removeEventListener('abort', release)
        pump()
      }
      entry.controller.signal.addEventListener('abort', release, { once: true })
      // A task boundary lets the new waypoint paint before grid creation.
      void yieldTask().then(() => {
        entry.controller.signal.throwIfAborted()
        return load(entry.start, entry.target, (field) => {
          if (entry.controller.signal.aborted) return
          entry.field = field
          notify()
          // Optional imagery and slope probes may arrive later. They must
          // not hold up the next leg's first terrain result.
          release()
        }, entry.controller.signal)
      }).then(() => {
        entry.status = entry.field ? 'done' : 'error'
      }, () => {
        entry.status = 'error'
      }).finally(() => {
        if (!entry.controller.signal.aborted) notify()
        release()
      })
    }
  }
  return {
    update(stops: LatLon[], onFields: typeof publish, onError: typeof fail) {
      publish = onFields
      fail = onError
      last = []
      order = stops.slice(1).map((target, i) => JSON.stringify([stops[i], target]))
      const next = new Map<string, Entry>()
      order.forEach((key, i) => next.set(key, entries.get(key) ?? next.get(key) ?? {
        start: stops[i], target: stops[i + 1], controller: new AbortController(), status: 'queued',
      }))
      const previous = entries
      entries = next
      for (const [key, entry] of previous) if (!next.has(key)) entry.controller.abort()
      notify()
      pump()
    },
    destroy() {
      disposed = true
      for (const entry of entries.values()) entry.controller.abort()
      entries.clear()
    },
  }
}
