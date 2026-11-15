import type { Marker } from './data/markers'

// The planner itself is Go, in apps/api/internal/planner. This file is the
// editor's view of it: the shapes of its JSON and the three calls it offers.

export interface Astronaut {
  name: string
  sex: string
  age: number
  massKg: number
  heightCm: number
  role: string
  activity: string
  evaShare: number
}

export interface PhaseParams {
  evaHoursPerWeek: number
  waterRecovery: number
  oxygenRecovery: number
  hygieneWaterKg: number
  basePowerW: number
  crewPowerW: number
}

export interface Phase extends PhaseParams {
  kind: string
  days: number
}

// Planetocentric latitude, east-positive longitude from -180 to 180.
export interface Site {
  name: string
  lat: number
  lon: number
  // A short description: what is there and why the crew goes. Up to 500
  // bytes of UTF-8.
  description?: string
}

// `site`, `phase` and `crew` are positions in the mission's lists, from zero.
// `crew` is everyone on the task, in crew order, and empty while nobody is.
// Each of them works the task's hours.
export interface Task {
  site: number
  phase: number
  crew: number[]
  kind: string
  eva: boolean
  hours: number
  note: string
  // The plan stop it is done at. Missing means the site's first visit.
  stop?: number
}

export interface Mission {
  name: string
  type: string
  marginPercent: number
  crew: Astronaut[]
  phases: Phase[]
  sites: Site[]
  tasks: Task[]
  markers?: Marker[]
  briefing?: string
  // The plan: site positions in visiting order. See src/data/stops.ts.
  route?: number[]
}

export interface Range {
  min: number
  max: number
}

export interface DailyNeeds {
  foodEnergyMJ: number
  proteinG: Range
  carbohydrateG: Range
  fatG: Range
  fluidL: number
  nutrients: Array<{ id: string; label: string; unit: string; amount: number; max?: number }>
}

// Mass in kilograms, energy in megajoules.
export interface Resources {
  foodEnergyMJ: number
  foodKg: number
  waterUsedKg: number
  waterSupplyKg: number
  oxygenUsedKg: number
  oxygenSupplyKg: number
  co2Kg: number
  heatMJ: number
  electricityMJ: number
  evaHours: number
}

export interface MissionPlan {
  days: number
  // doseSv: mission dose equivalent on a quiet sun, in sieverts.
  crew: Array<{ name: string; daily: DailyNeeds; total: Resources; taskHours: { eva: number; inside: number }; doseSv: number }>
  phases: Array<{ kind: string; days: number; total: Resources }>
  total: Resources
  marginPercent: number
  provision: Pick<Resources, 'foodEnergyMJ' | 'foodKg' | 'waterSupplyKg' | 'oxygenSupplyKg' | 'electricityMJ'>
  unassignedTaskHours: number
  evaOverruns: Array<{ crew: number; phase: number; plannedHours: number; budgetHours: number }>
  // Days in phases with no dose rate, left out of doseSv.
  doseUnknownDays: number
  // NASA-STD-3001 Vol 1 career limit, 0.6 Sv.
  doseLimitSv: number
}

export interface LinkEstimate {
  id: string
  label: string
  bitsPerSecond: number
  seconds: number
}

// What the planner answers for a mission that adds up.
export interface Planned {
  // The mission as the planner understood it, snapped to what the file stores.
  mission: Mission
  plan: MissionPlan
  cautions: string[]
  // The mission file, base64 encoded.
  file: string
  fileBytes: number
  links: LinkEstimate[]
}

export interface Catalog {
  missionTypes: Array<{ id: string; summary: string; phases: Array<{ kind: string; days: number }> }>
  phaseKinds: Array<{ id: string; summary: string } & PhaseParams>
  sexes: string[]
  roles: string[]
  activities: string[]
  taskKinds: string[]
  defaultMarginPercent: number
  minMarginPercent: number
  maxMarginPercent: number
  rates: Record<string, number>
  // Fictional, to start from.
  example: Mission
  sampleRoster: Astronaut[]
}

// `invalid`: the planner read the mission and says what is wrong with it.
// `offline`: the planner could not be reached or failed.
export class PlannerError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'offline',
  ) {
    super(message)
  }
}

// The planner names fields the way the file format does. On screen they get
// the words the form uses.
const FIELD_WORDS: Array<[RegExp, string]> = [
  [/\bmassKg\b/, 'mass in kg'],
  [/\bheightCm\b/, 'height in cm'],
  [/\bevaShare\b/, 'share of EVA hours, as a fraction'],
  [/\bmarginPercent\b/, 'margin in percent'],
  [/\bevaHoursPerWeek\b/, 'EVA hours per person-week'],
  [/\bwaterRecovery\b/, 'water recycled, as a fraction'],
  [/\boxygenRecovery\b/, 'oxygen recycled, as a fraction'],
  [/\bhygieneWaterKg\b/, 'hygiene water in kg'],
  [/\bbasePowerW\b/, 'vehicle base power in W'],
  [/\bcrewPowerW\b/, 'power per person in W'],
  [/\blat\b/, 'latitude'],
  [/\blon\b/, 'longitude'],
]
export const plainWords = (message: string): string =>
  FIELD_WORDS.reduce((text, [field, words]) => text.replace(field, words), message)

const BASE = '/api/planner'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(BASE + path, init)
  } catch (error) {
    // A newer edit cancelling this request is not a failure to report.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new PlannerError('the planner service did not answer', 'offline')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.ok && body !== null) return body as T
  const reason = (body as { error?: unknown } | null)?.error
  if (response.status === 422 && typeof reason === 'string') throw new PlannerError(reason, 'invalid')
  throw new PlannerError(
    typeof reason === 'string' ? reason : `the planner service answered ${response.status}`,
    'offline',
  )
}

export const fetchCatalog = (): Promise<Catalog> => call('/catalog')

// Checks a mission and works out its plan and its file. `mission` may be a
// draft with empty fields, or JSON from a file; the planner says what is wrong.
export const requestPlan = (mission: unknown, roster?: Astronaut[], signal?: AbortSignal): Promise<Planned> =>
  call('/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(roster && roster.length > 0 ? { mission, roster } : { mission }),
    signal,
  })

export const decodeFile = (bytes: Uint8Array): Promise<Mission> =>
  call<{ mission: Mission }>('/decode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes as BodyInit,
  }).then((answer) => answer.mission)

export function fileBytes(planned: Planned): Uint8Array {
  return Uint8Array.from(atob(planned.file), (char) => char.charCodeAt(0))
}
