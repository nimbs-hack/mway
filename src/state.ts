import { useCallback, useRef, useState } from 'react'
import type { Astronaut, Catalog, Mission, Phase, Site, Task } from './api'
import { planStops } from './data/stops'
import type { LatLon } from './data/geo'
import { PHOTOS_KEY } from './data/photos'
export { loadPhotos, photoKey, type Photos } from './data/photos'

// What the editor holds. Same shape as a Mission, but a field may be out of
// range or empty while someone is typing in it.
export type Draft = Mission

// The stages of making a mission, in the order they are done. Each is a page.
export const STEPS = [
  { id: 'home', label: 'Home' },
  { id: 'crew', label: 'Crew' },
  { id: 'phases', label: 'Phases' },
  { id: 'sites', label: 'Sites' },
  { id: 'review', label: 'Review' },
] as const
export type StepId = (typeof STEPS)[number]['id']

// The stage in the address, so a reload or the back button lands on it.
export const stepFromHash = (): StepId => STEPS.find((entry) => `#${entry.id}` === location.hash)?.id ?? 'home'

export type Selection = { list: 'crew' | 'phase' | 'site'; index: number } | null

// Which step a validation message belongs to, from how createMission words it.
// Null is the mission's own name, type or margin, which the top bar edits.
export function stepOfProblem(message: string): StepId | null {
  if (/^(site|task|marker)/.test(message) || message.includes('in the sites twice')) return 'sites'
  if (message.startsWith('phase') || message.includes('needs a list of phases')) return 'phases'
  if (/^(crew|roster|"|no ")/.test(message)) return 'crew'
  return null
}

// What a mission is called before it is given a name.
export const UNNAMED = 'Unnamed mission'

// The type a new mission starts as.
export const DEFAULT_TYPE = 'mars-long-stay'

// Earlier versions kept one mission in progress here. It is now a file in
// the library like any other.
const DRAFT_KEY = 'nimbs:planner:draft'
const ROSTER_KEY = 'nimbs:planner:roster'
const LIBRARY_KEY = 'nimbs:planner:library'
const CURRENT_KEY = 'nimbs:planner:current'

function stored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

// False when the browser did not keep the value.
export function store(key: 'roster' | 'library' | 'current' | 'photos', value: unknown): boolean {
  // A number field being retyped is NaN, which JSON turns into null. A roster
  // saved like that would lose the person on the next start, so wait.
  if (key === 'roster' && /:null[,}]/.test(JSON.stringify(value))) return false
  try {
    localStorage.setItem(
      { roster: ROSTER_KEY, library: LIBRARY_KEY, current: CURRENT_KEY, photos: PHOTOS_KEY }[key],
      JSON.stringify(value),
    )
    // Once the library is written, the old draft has its place in it.
    if (key === 'library') localStorage.removeItem(DRAFT_KEY)
    return true
  } catch {
    // Storage can be blocked or full. The editor still works for this session.
    return false
  }
}

const isProfile = (value: unknown): value is Astronaut =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Astronaut).name === 'string' &&
  typeof (value as Astronaut).sex === 'string' &&
  typeof (value as Astronaut).massKg === 'number'

// Replace the former sample names while keeping edited planning inputs.
const FORMER_CREW = new Map([
  ['VEGA', 'Christina Koch'],
  ['ORLOV', 'Robert Hines'],
  ['NAKAMURA', 'Jessica Meir'],
  ['OKAFOR', 'Victor Glover'],
  ['LINDQVIST', 'Kjell Lindgren'],
  ['REYES', 'Jessica Watkins'],
  ['HADDAD', 'Frank Rubio'],
  ['KOWALSKI', 'Kathleen Rubins'],
])

// Sample people no longer in the roster the planner ships, under their names
// then and now. Missions that took them keep their own copy.
const RETIRED = new Set(['REYES', 'KOWALSKI', 'Jessica Watkins', 'Kathleen Rubins'])

// Names and portraits are NASA astronauts. Their planning inputs are examples.
export function loadRoster(catalog: Pick<Catalog, 'sampleRoster'>): Astronaut[] {
  const saved = stored(ROSTER_KEY)
  if (!Array.isArray(saved)) return catalog.sampleRoster
  const roster = saved.filter(isProfile).filter((person) => !RETIRED.has(person.name))
  const names = new Set(roster.map((person) => person.name))
  return roster.flatMap((person) => {
    const name = FORMER_CREW.get(person.name)
    if (!name) return [person]
    // Keep an existing profile under the new name instead of duplicating it.
    return names.has(name) ? [] : [{ ...person, name }]
  })
}

function isRetiredExample(mission: unknown): boolean {
  return typeof mission === 'object' && mission !== null && 'name' in mission
    && typeof mission.name === 'string' && mission.name.trim().toUpperCase() === 'ARES-3'
}

// A mission file kept on the home page: made here, or received as a file.
// The one being edited is saved into its entry after every edit that plans.
export interface LibraryEntry {
  id: string
  mission: Mission
  // ISO time it was last saved, or received.
  at: string
  source: 'saved' | 'received'
  // Name of the file it came from, for a received one.
  file?: string
}

// The most missions the home page keeps. The oldest go first.
const LIBRARY_LIMIT = 50

const isEntry = (value: unknown): value is LibraryEntry => {
  const entry = value as LibraryEntry | null
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.id === 'string' &&
    typeof entry.at === 'string' &&
    (entry.source === 'saved' || entry.source === 'received') &&
    typeof entry.mission === 'object' &&
    entry.mission !== null &&
    typeof entry.mission.name === 'string' &&
    Array.isArray(entry.mission.crew) &&
    Array.isArray(entry.mission.phases) &&
    Array.isArray(entry.mission.sites)
  )
}

// Undefined before anything was ever kept, which is how a first run is told
// from a library the user emptied.
export function loadLibrary(): LibraryEntry[] | undefined {
  const saved = stored(LIBRARY_KEY)
  return Array.isArray(saved) ? saved.filter(isEntry).filter((entry) => !isRetiredExample(entry.mission)).map(withCrewLists) : undefined
}

// A task kept before tasks could have several people has one person or null.
function withCrewLists(entry: LibraryEntry): LibraryEntry {
  const tasks = (entry.mission.tasks ?? []).map((task) => {
    const crew: unknown = task.crew
    return Array.isArray(crew) ? task : { ...task, crew: typeof crew === 'number' ? [crew] : [] }
  })
  return { ...entry, mission: { ...entry.mission, tasks } }
}

export const newEntry = (mission: Mission, source: LibraryEntry['source'], file?: string): LibraryEntry => ({
  id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
  mission,
  at: new Date().toISOString(),
  source,
  file,
})

// The library with one more mission, newest first.
export const withEntry = (library: LibraryEntry[], entry: LibraryEntry): LibraryEntry[] =>
  [entry, ...library].slice(0, LIBRARY_LIMIT)

// The id of the file that was open in the last session.
export const storedCurrent = (): string | null => {
  const id = stored(CURRENT_KEY)
  return typeof id === 'string' ? id : null
}

// The mission in progress from an earlier version, unchecked.
export const storedDraft = (): unknown => {
  const draft = stored(DRAFT_KEY)
  return isRetiredExample(draft) ? undefined : draft
}

function freeName(taken: string[], prefix: string): string {
  for (let n = taken.length + 1; ; n++) {
    const name = `${prefix}-${n}`
    if (!taken.includes(name)) return name
  }
}

const replaceAt = <T>(items: T[], index: number, item: T): T[] =>
  items.map((current, i) => (i === index ? item : current))

const insertAfter = <T>(items: T[], index: number, item: T): T[] => [
  ...items.slice(0, index + 1),
  item,
  ...items.slice(index + 1),
]

// Where position `index` ends up after the item at `from` moves to `to`.
export const movedIndex = (index: number, from: number, to: number): number => {
  if (index === from) return to
  if (from < index && index <= to) return index - 1
  if (to <= index && index < from) return index + 1
  return index
}

// Tasks point at crew, phases and sites by position, so every edit that
// shifts a list has to move those pointers with it.
const retarget = (draft: Draft, change: (task: Task) => Task | null): Task[] =>
  draft.tasks.flatMap((task) => {
    const next = change(task)
    return next ? [next] : []
  })

// Keeps the plan stops `keep` allows. A stop that now visits the same site as
// the one before it merges into it. `to[i]` is where old stop i went, -1 when
// it is gone. `site` renumbers sites, after one is removed.
function restop(draft: Draft, keep: (stop: number) => boolean, site: (index: number) => number = (i) => i) {
  const route: number[] = []
  const to: number[] = []
  ;(draft.route ?? []).forEach((at, i) => {
    to[i] = -1
    if (!keep(i)) return
    if (route.at(-1) !== site(at)) route.push(site(at))
    to[i] = route.length - 1
  })
  return { route, to }
}

// The task with its stop moved as `to` says. A task whose stop is gone keeps
// its site and goes to the site's first visit.
function followStop(task: Task, to: number[]): Task {
  if (task.stop === undefined) return task
  const stop = to[task.stop] ?? -1
  if (stop >= 0) return { ...task, stop }
  const { stop: _gone, ...rest } = task
  return rest
}

// Map stops become mission sites and visits in one undoable edit. Existing
// sites keep their names and tasks, even when the new route no longer visits them.
export function setRoutePoints(draft: Draft, points: LatLon[]): Draft {
  const sites = [...draft.sites]
  const route: number[] = []
  for (const [lat, lon] of points) {
    let site = sites.findIndex((entry) => entry.lat === lat && entry.lon === lon)
    if (site < 0) {
      site = sites.length
      sites.push({ name: freeName(sites.map((entry) => entry.name), 'SITE'), lat, lon })
    }
    if (route.at(-1) !== site) route.push(site)
  }
  // Match repeated visits in order, so each visit keeps its own tasks.
  const lastVisit = new Map<number, number>()
  const to = planStops(draft).map((site) => {
    const stop = route.indexOf(site, (lastVisit.get(site) ?? -1) + 1)
    if (stop >= 0) lastVisit.set(site, stop)
    return stop
  })
  return { ...draft, sites, route, tasks: draft.tasks.map((task) => followStop(task, to)) }
}

// Edits. Each returns a new draft and leaves the old one alone. Presets and
// templates come from the planner's catalog.
export function createEdits(catalog: Catalog) {
  const presetPhase = (kind: string, days: number): Phase => {
    const { id: _, summary: __, ...params } = catalog.phaseKinds.find((entry) => entry.id === kind)!
    return { kind, days, ...params }
  }
  const template = (type: string) => catalog.missionTypes.find((entry) => entry.id === type)!.phases
  const newPerson = (crew: Astronaut[]): Astronaut => ({
    name: freeName(
      crew.map((person) => person.name),
      'CREW',
    ),
    sex: 'female',
    age: 35,
    massKg: 65,
    heightCm: 168,
    role: 'mission-specialist',
    activity: 'active',
    evaShare: 1,
  })

  return {
    newPerson,
    setRoutePoints,

    blank: (): Draft => ({
      name: '',
      type: DEFAULT_TYPE,
      marginPercent: catalog.defaultMarginPercent,
      // Nobody is going until picked on the Crew page.
      crew: [],
      phases: template(DEFAULT_TYPE).map((p) => presetPhase(p.kind, p.days)),
      sites: [],
      tasks: [],
    }),

    // Picking a type loads its phases. `custom` has none, so it keeps yours.
    setType: (draft: Draft, type: string): Draft => {
      const phases = template(type)
      if (phases.length === 0) return { ...draft, type }
      const last = phases.length - 1
      return {
        ...draft,
        type,
        phases: phases.map((p) => presetPhase(p.kind, p.days)),
        tasks: retarget(draft, (task) => ({ ...task, phase: Math.min(task.phase, last) })),
      }
    },

    addCrew: (draft: Draft, person?: Astronaut): Draft => ({
      ...draft,
      crew: [...draft.crew, person ?? newPerson(draft.crew)],
    }),
    updateCrew: (draft: Draft, index: number, patch: Partial<Astronaut>): Draft => ({
      ...draft,
      crew: replaceAt(draft.crew, index, { ...draft.crew[index]!, ...patch }),
    }),
    // Their tasks stay, with whoever else was on them.
    removeCrew: (draft: Draft, index: number): Draft => ({
      ...draft,
      crew: draft.crew.filter((_, i) => i !== index),
      tasks: retarget(draft, (task) => ({
        ...task,
        crew: task.crew.filter((member) => member !== index).map((member) => (member > index ? member - 1 : member)),
      })),
    }),

    addPhase: (draft: Draft, kind: string, after: number): Draft => ({
      ...draft,
      phases: insertAfter(draft.phases, after, presetPhase(kind, 30)),
      tasks: retarget(draft, (task) => (task.phase > after ? { ...task, phase: task.phase + 1 } : task)),
    }),
    duplicatePhase: (draft: Draft, index: number): Draft => ({
      ...draft,
      phases: insertAfter(draft.phases, index, { ...draft.phases[index]! }),
      tasks: retarget(draft, (task) => (task.phase > index ? { ...task, phase: task.phase + 1 } : task)),
    }),
    updatePhase: (draft: Draft, index: number, patch: Partial<Phase>): Draft => ({
      ...draft,
      phases: replaceAt(draft.phases, index, { ...draft.phases[index]!, ...patch }),
    }),
    // A new kind brings its own preset; the length stays.
    setPhaseKind: (draft: Draft, index: number, kind: string): Draft => ({
      ...draft,
      phases: replaceAt(draft.phases, index, presetPhase(kind, draft.phases[index]!.days)),
    }),
    // The phases between the two positions shift by one to make room.
    movePhase: (draft: Draft, from: number, to: number): Draft => {
      if (from === to || to < 0 || to >= draft.phases.length) return draft
      const phases = [...draft.phases]
      phases.splice(to, 0, ...phases.splice(from, 1))
      return {
        ...draft,
        phases,
        tasks: retarget(draft, (task) => ({ ...task, phase: movedIndex(task.phase, from, to) })),
      }
    },
    // Its tasks move to the phase that takes its place.
    removePhase: (draft: Draft, index: number): Draft => {
      const last = draft.phases.length - 2
      return {
        ...draft,
        phases: draft.phases.filter((_, i) => i !== index),
        tasks: retarget(draft, (task) => ({
          ...task,
          phase: Math.min(task.phase > index ? task.phase - 1 : task.phase, last),
        })),
      }
    },

    addSite: (draft: Draft, lat: number, lon: number): Draft => ({
      ...draft,
      sites: [
        ...draft.sites,
        {
          name: freeName(
            draft.sites.map((site) => site.name),
            'SITE',
          ),
          lat,
          lon,
        },
      ],
    }),
    updateSite: (draft: Draft, index: number, patch: Partial<Site>): Draft => ({
      ...draft,
      sites: replaceAt(draft.sites, index, { ...draft.sites[index]!, ...patch }),
    }),
    // A site takes its tasks and its plan stops with it.
    removeSite: (draft: Draft, index: number): Draft => {
      const { route, to } = restop(draft, (stop) => draft.route![stop] !== index, (site) => (site > index ? site - 1 : site))
      return {
        ...draft,
        sites: draft.sites.filter((_, i) => i !== index),
        tasks: retarget(draft, (task) => {
          if (task.site === index) return null
          return followStop(task.site > index ? { ...task, site: task.site - 1 } : task, to)
        }),
        route,
      }
    },

    // The plan. A stop is a site; the same site cannot follow itself. A task
    // set at a stop moves with it.
    addStop: (draft: Draft, site: number): Draft => {
      const route = draft.route ?? []
      if (route.at(-1) === site) return draft
      return { ...draft, route: [...route, site] }
    },
    // Unchanged when the move would put a site right after itself.
    moveStop: (draft: Draft, index: number, to: number): Draft => {
      const route = draft.route ?? []
      if (to < 0 || to >= route.length || to === index) return draft
      const order = route.map((_, i) => i)
      order.splice(to, 0, ...order.splice(index, 1))
      const moved = order.map((i) => route[i]!)
      if (moved.some((site, i) => i > 0 && site === moved[i - 1])) return draft
      const where: number[] = []
      order.forEach((old, now) => (where[old] = now))
      return { ...draft, route: moved, tasks: draft.tasks.map((task) => followStop(task, where)) }
    },
    // The stop's own tasks go with it.
    removeStop: (draft: Draft, index: number): Draft => {
      const { route, to } = restop(draft, (stop) => stop !== index)
      return { ...draft, route, tasks: retarget(draft, (task) => (task.stop === index ? null : followStop(task, to))) }
    },

    // An EVA planned on the map: a site at its target, unless one is already
    // there, and one EVA task as long as the walk out, the work and the walk back.
    addEva: (draft: Draft, lat: number, lon: number, hours: number, note: string): Draft => {
      const existing = draft.sites.findIndex((site) => site.lat === lat && site.lon === lon)
      const sites =
        existing >= 0
          ? draft.sites
          : [
              ...draft.sites,
              {
                name: freeName(
                  draft.sites.map((site) => site.name),
                  'EVA',
                ),
                lat,
                lon,
              },
            ]
      const outside = draft.phases.findIndex((phase) => phase.evaHoursPerWeek > 0)
      const site = existing >= 0 ? existing : draft.sites.length
      // The EVA ends at the plan's last visit to its site.
      const route = draft.route?.length ? draft.route : planStops(draft)
      const stop = route.lastIndexOf(site)
      const task: Task = {
        site,
        phase: Math.max(outside, 0),
        crew: [],
        kind: catalog.taskKinds[0]!,
        eva: true,
        hours,
        note,
        ...(stop >= 0 ? { stop } : {}),
      }
      return { ...draft, sites, tasks: [...draft.tasks, task], ...(stop >= 0 ? { route } : {}) }
    },

    // New tasks start in the first phase that has EVA hours to spend.
    // A task at a plan stop. A mission without a plan gets one: its sites in
    // list order, as the route already visits them.
    addTask: (draft: Draft, stop: number): Draft => {
      const route = draft.route?.length ? draft.route : planStops(draft)
      const site = route[stop]
      if (site === undefined) return draft
      const outside = draft.phases.findIndex((phase) => phase.evaHoursPerWeek > 0)
      const task: Task = {
        site,
        stop,
        phase: Math.max(outside, 0),
        crew: [],
        kind: catalog.taskKinds[0]!,
        eva: true,
        hours: 2,
        note: '',
      }
      return { ...draft, route, tasks: [...draft.tasks, task] }
    },
    updateTask: (draft: Draft, index: number, patch: Partial<Task>): Draft => ({
      ...draft,
      tasks: replaceAt(draft.tasks, index, { ...draft.tasks[index]!, ...patch }),
    }),
    removeTask: (draft: Draft, index: number): Draft => ({
      ...draft,
      tasks: draft.tasks.filter((_, i) => i !== index),
    }),
  }
}

const HISTORY_LIMIT = 200
const MERGE_WINDOW_MS = 1000

// Undo and redo over whole drafts. Edits that share a key and arrive close
// together, like one drag of a slider, collapse into a single undo step.
export function useHistory<T>(initial: () => T) {
  const [state, setState] = useState(() => ({
    past: [] as T[],
    present: initial(),
    future: [] as T[],
  }))
  const last = useRef({ key: '', time: 0 })

  const commit = useCallback((recipe: (current: T) => T, key = '') => {
    const now = Date.now()
    const merge = key !== '' && key === last.current.key && now - last.current.time < MERGE_WINDOW_MS
    last.current = { key, time: now }
    setState((s) => {
      const present = recipe(s.present)
      if (present === s.present) return s
      if (merge) return { ...s, present }
      return { past: [...s.past, s.present].slice(-HISTORY_LIMIT), present, future: [] }
    })
  }, [])

  // Replaces the present without adding an undo step.
  const amend = useCallback((present: T) => setState((s) => ({ ...s, present })), [])

  // Starts over from another value, as when another file is opened.
  const reset = useCallback((present: T) => {
    last.current = { key: '', time: 0 }
    setState({ past: [], present, future: [] })
  }, [])

  const undo = useCallback(() => {
    last.current = { key: '', time: 0 }
    setState((s) =>
      s.past.length === 0
        ? s
        : {
            past: s.past.slice(0, -1),
            present: s.past[s.past.length - 1]!,
            future: [s.present, ...s.future],
          },
    )
  }, [])

  const redo = useCallback(() => {
    last.current = { key: '', time: 0 }
    setState((s) =>
      s.future.length === 0 ? s : { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) },
    )
  }, [])

  return {
    present: state.present,
    // What undo would go back to, if anything.
    previous: state.past[state.past.length - 1],
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit,
    amend,
    reset,
    undo,
    redo,
  }
}
