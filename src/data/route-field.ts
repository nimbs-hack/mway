import { gridSlopes } from './route-options'
import type { Field, Grid } from './route-options'
import type { Ground } from './ground'
import type { SurfaceSample } from './terrain-sample'

type Loaders = {
  elevations: () => Promise<(number | null)[]>
  surface: () => Promise<SurfaceSample[]>
  thermal: () => Promise<(number | null)[]>
  // Rocks and ripples at each node. Optional: without it routes ignore them.
  ground?: () => Promise<(Ground | null)[]>
}

export type RouteField = {
  grid: Grid
  field: Field
  thermalPending: boolean
  slopesPending: boolean
  groundPending: boolean
}

// Publish usable terrain before waiting for infrared imagery, the ground
// check or the slope probes used in the explanatory note. All final samples
// keep their detail. A failed ground check leaves the ground unknown.
export async function loadRouteField(grid: Grid, load: Loaders, publish: (field: RouteField) => void, signal: AbortSignal) {
  let elevation: (number | null)[] | undefined
  let surface: SurfaceSample[] | undefined
  let thermal: (number | null)[] = grid.points.map(() => null)
  let thermalPending = true
  let ground: (Ground | null)[] | undefined
  let groundPending = Boolean(load.ground)
  let slope: (number | null)[] = grid.points.map(() => null)
  const update = () => {
    if (!elevation || signal.aborted) return
    publish({
      grid,
      field: { elevation, thermal, slope, ...(ground ? { ground } : {}) },
      thermalPending,
      slopesPending: !surface,
      groundPending,
    })
  }
  await Promise.all([
    load.elevations().then(async (values) => {
      elevation = values
      update()
      if (signal.aborted || !elevation.some((value) => value !== null)) return
      surface = await load.surface().catch(() => [])
      if (signal.aborted) return
      const coarse = gridSlopes(grid, elevation)
      slope = grid.points.map((_, i) => surface![i]?.slope ?? coarse[i])
      update()
    }),
    load.thermal().catch(() => thermal).then((values) => {
      thermal = values
      thermalPending = false
      update()
    }),
    load.ground?.().catch(() => grid.points.map(() => null)).then((values) => {
      ground = values
      groundPending = false
      update()
    }),
  ])
}
