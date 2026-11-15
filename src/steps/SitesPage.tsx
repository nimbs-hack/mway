import { type ComponentType, type ReactNode, useMemo, useState } from 'react'
import type { Viewer } from 'cesium'
import type { Astronaut, Catalog, MissionPlan, Site, Task } from '../api'
import UntypedGlobe from '../components/MarsGlobe.jsx'
import StatusBar from '../components/StatusBar.jsx'
import { portraitUrl } from '../components/Portrait'
import { SITES } from '../data/sites.js'
import type { Marker } from '../data/markers'
import type { LatLon } from '../data/geo'
import { loadPhotos, photoKey, type Draft, type Selection } from '../state'
import { PlanStep } from './PlanStep'
import { SitesStep } from './SitesStep'

export type RouteEnds = { start: boolean; target: boolean }

// What the map hands over when an assessed EVA is added to the mission.
interface Eva {
  // Planetocentric latitude and east longitude, -180 to 180.
  target: [lat: number, lon: number]
  // Walk out, work at the target and walk back.
  seconds: number
  // One way, in metres.
  distance: number
  maxSlope: number | null
  verdict: 'go' | 'caution' | 'no-go'
}

// What the map gives its side panel so the panel can drive the map.
interface MapHooks {
  placing: string | null
  onPlacing: (mode: string | null) => void
}

// MarsGlobe is plain JavaScript. These are the props this page relies on.
const MarsGlobe = UntypedGlobe as unknown as ComponentType<{
  site: (typeof SITES)[number] | null
  onSite: (id: string | null) => void
  onStatus: (status: string) => void
  onImagerySource: (source: string) => void
  onScienceSource: (credit: string) => void
  onViewer: (viewer: Viewer | null) => void
  mission: {
    id: string
    crew: (Astronaut & { photo?: string })[]
    markers: Marker[]
    onMarkers: (markers: Marker[]) => void
    sites: Site[]
    // The plan: site positions in visiting order.
    route: number[]
    taskCounts: number[]
    selected: number
    onSelect: (index: number) => void
    onAddSite: (point: [number, number]) => void
    onRoutePoints: (points: LatLon[]) => void
    onAddEva: (eva: Eva) => void
    flag: 'caution' | null
  }
  missionPanel: (hooks: MapHooks) => ReactNode
  missionPlan: ReactNode
  onRoute?: (ends: RouteEnds) => void
}>

// Tasks are stored in half hours, from 0.5 to 127.5.
const taskHours = (seconds: number): number => Math.min(127.5, Math.max(0.5, Math.ceil(seconds / 1800) / 2))

// The task note is 31 ASCII characters at most, so it carries the verdict,
// the one-way distance and the steepest slope.
function evaNote({ verdict, distance, maxSlope }: Eva): string {
  const slope = maxSlope === null ? '' : `, ${Math.round(maxSlope)} deg max`
  return `${verdict.toUpperCase()} ${(distance / 1000).toFixed(1)} km${slope}`.slice(0, 31)
}

// The sites stage: the map with the plan panel on its left. Its Sites tab
// holds the mission's places, and its Plan tab their visiting order and
// tasks, next to the EVA route settings. The route runs through
// the plan's stops. An assessed EVA becomes a task at its target site, so its
// hours count against the phase.
export function SitesPage({
  missionId,
  catalog,
  draft,
  plan,
  taskCounts,
  selection,
  onSelect,
  onSettle,
  onMarkers,
  onAddSite,
  onRoutePoints,
  onAddEva,
  onUpdateSite,
  onRemoveSite,
  onAddStop,
  onMoveStop,
  onRemoveStop,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
  onRoute,
}: {
  missionId: string
  catalog: Catalog
  draft: Draft
  plan: MissionPlan | null
  taskCounts: number[]
  selection: Selection
  onSelect: (selection: Selection) => void
  onSettle: () => void
  onMarkers: (markers: Marker[]) => void
  onAddSite: (lat: number, lon: number) => void
  onRoutePoints: (points: LatLon[]) => void
  onAddEva: (lat: number, lon: number, hours: number, note: string) => void
  onUpdateSite: (index: number, patch: Partial<Site>, field: string) => void
  onRemoveSite: (index: number) => void
  onAddStop: (site: number) => void
  onMoveStop: (index: number, to: number) => void
  onRemoveStop: (index: number) => void
  // A task at a plan stop.
  onAddTask: (stop: number) => void
  onUpdateTask: (index: number, patch: Partial<Task>, field: string) => void
  onRemoveTask: (index: number) => void
  // Whether the EVA route has a start and a target, each time that changes.
  onRoute?: (ends: RouteEnds) => void
}) {
  // The landing site in view, from the map's own list of NASA missions.
  const [siteId, setSiteId] = useState<string | null>(null)
  const [status, setStatus] = useState('loading')
  const [imagerySource, setImagerySource] = useState('V01')
  const [scienceCredit, setScienceCredit] = useState('')
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [photos] = useState(loadPhotos)

  const site = SITES.find((entry) => entry.id === siteId) ?? null
  const credits = [
    ...(scienceCredit ? scienceCredit.split(' · ') : []),
    `CTX ${imagerySource}: NASA / JPL / USGS / MSSS / The Murray Lab / Esri`,
    'Terrain: NASA Mars Trek',
  ]

  const mission = useMemo(
    () => ({
      id: missionId,
      crew: draft.crew.map((person) => ({ ...person, photo: portraitUrl(person.name, photos[photoKey(person.name)]) })),
      markers: draft.markers ?? [],
      onMarkers,
      sites: draft.sites,
      route: draft.route ?? [],
      taskCounts,
      selected: selection?.list === 'site' ? selection.index : -1,
      onSelect: (index: number) => onSelect({ list: 'site', index }),
      onAddSite: ([lat, lon]: [number, number]) => onAddSite(lat, lon),
      onRoutePoints,
      onAddEva: (eva: Eva) => onAddEva(eva.target[0], eva.target[1], taskHours(eva.seconds), evaNote(eva)),
      // Tasks nobody is assigned to, or more EVA task hours than a phase gives.
      flag: plan && (plan.unassignedTaskHours > 0 || plan.evaOverruns.length > 0) ? ('caution' as const) : null,
    }),
    // The handlers close over the current draft, so they change with it.
    [missionId, draft, plan, taskCounts, selection, onMarkers, photos],
  )

  return (
    <>
      <MarsGlobe
        site={site}
        onSite={setSiteId}
        onRoute={onRoute}
        onStatus={setStatus}
        onImagerySource={setImagerySource}
        onScienceSource={setScienceCredit}
        onViewer={setViewer}
        mission={mission}
        missionPanel={({ placing, onPlacing }: MapHooks) => (
          <div className="sites" onBlur={onSettle}>
            <SitesStep
              draft={draft}
              selection={selection}
              onSelect={onSelect}
              placing={placing === 'site'}
              onPlacing={(on) => onPlacing(on ? 'site' : null)}
              onUpdateSite={onUpdateSite}
              onRemoveSite={onRemoveSite}
            />
          </div>
        )}
        missionPlan={
          <div className="sites" onBlur={onSettle}>
            <PlanStep
              catalog={catalog}
              draft={draft}
              plan={plan}
              onAdd={onAddStop}
              onMove={onMoveStop}
              onRemove={onRemoveStop}
              onAddTask={onAddTask}
              onUpdateTask={onUpdateTask}
              onRemoveTask={onRemoveTask}
            />
          </div>
        }
      />
      <StatusBar viewer={viewer} status={status} credits={credits} />
    </>
  )
}
