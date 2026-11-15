// The mission viewer: opens a mission file and shows its sites on a 3D map,
// the crew and what the mission needs. It is the editor with less on screen,
// for a device that cannot carry the editor's map library. It changes
// nothing: Edit hands the mission to the editor.

import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '../tokens.css'
import './viewer.css'
import { type Mission, type Planned, PlannerError, type Task, decodeFile, fetchCatalog, plainWords, requestPlan } from '../api'
import { registerMapCache } from '../cache/map-cache.js'
import { readMissionFile } from '../files'
import { handOff } from '../handoff'
import { formatLatLon } from '../format.js'
import { kcal, kwh, meters, num, range, words } from '../numbers'
import { siteLegs, totalLegs } from '../steps/legs'
import { type Child, h } from './dom'
import { createGlobe } from './globe'
import { icon } from './icons'
import { crewPortrait } from '../components/map-label-dom'
import { portraitUrl } from '../components/portrait-assets'
import { loadPhotos, photoKey } from '../data/photos'
import { type MapStatus, createMap } from './map'
import { SUIT } from '../data/suit'
import { WALK_SPEED, advanceSimulation, simulatedPositions, type CrewPosition } from './live'
import { type SiteRoute, routeLine } from './route'
import { planStops, taskStop } from '../data/stops'
import { type Level, type SuitReading, readSuitSensors, readingLevels, worstLevel } from './sensors'

interface Doc {
  fileName: string
  // The planner's answer for the mission as opened.
  planned: Planned
}

const STORE = 'nimbs.viewer.file'
const SECONDS_PER_DAY = 86400
const TABS = [
  ['live', 'Simulation'],
  ['overview', 'Mission'],
  ['sites', 'Sites'],
  ['crew', 'Crew'],
  ['phases', 'Phases'],
  ['briefing', 'Briefing'],
] as const
// The editor stage each tab's Edit opens.
const STAGES = { live: 'sites', overview: 'review', sites: 'sites', crew: 'crew', phases: 'phases', briefing: 'review' } as const

let doc: Doc | null = null
// Whether the open mission has a site or symbol for the map to show.
let placed = false
let tab: (typeof TABS)[number][0] = 'overview'
let selected = -1
let sidebarOpen = false
let liveEnabled = true
let livePaused = false
let self = 0
let liveSeconds = 0
let positions: CrewPosition[] = []
// The route between the sites, once the map has found it.
let route: SiteRoute | null = null
// Suit sensor readings, one for each crew member, and whose are open.
let readings: SuitReading[] = []
const openCrew = new Set<number>()
let liveTimer = 0
let lastTick = 0
// Why a file did not open or the editor could not take it, and how to try
// again when there is a way.
let fileProblem: { text: string; retry?: () => void } | null = null
let opening: string | null = null

const count = (n: number, thing: string) => `${n} ${thing}${n === 1 ? '' : 's'}`

// Page skeleton. These nodes stay. render() fills them.

const fileInput = h('input', {
  type: 'file',
  accept: '.mhr,.json,application/json',
  hidden: true,
  onchange: () => {
    openFile(fileInput.files?.[0])
    fileInput.value = ''
  },
})
const title = h('div', { class: 'bar__title' })
const alerts = h('div', { class: 'alerts' })
const tabs = h('nav', { class: 'tabs', 'aria-label': 'Sections' })
const body = h('div', { class: 'panel__body' })
const mapRoot = h('main', { class: 'map', 'aria-label': 'Mission map' })
const tileState = h('span', { role: 'status' })
const scaleBar = h('span', { class: 'scale' })
const scaleLabel = h('span')
const scale = h('span', { class: 'status__scale', title: 'At the middle of the map' }, scaleBar, scaleLabel)
const cursor = h('span', { class: 'status__cursor' })
const sidebarButton = h(
  'button',
  {
    type: 'button',
    class: 'button sidebar-toggle',
    'aria-controls': 'mission-sidebar',
    'aria-expanded': 'false',
    onclick: () => setSidebar(true),
  },
  icon('menu'),
  'Mission',
)
const closeButton = h('button', { type: 'button', class: 'button button--icon', 'aria-label': 'Close sidebar', onclick: () => setSidebar(false) }, icon('close'), 'Close')
const editButton = h('button', { type: 'button', class: 'button', 'data-tip': 'Open this mission in the planner', onclick: () => editInPlanner() }, 'Edit')
const panel = h(
  'aside',
  { class: 'panel', id: 'mission-sidebar', 'aria-label': 'Mission details', inert: true },
  h('header', { class: 'bar' }, title, closeButton),
  h(
    'div',
    { class: 'panel__actions' },
    h('button', { type: 'button', class: 'button', 'data-tip': 'Ctrl+O', 'aria-label': 'Open file', onclick: () => fileInput.click() }, 'Open file'),
    editButton,
    fileInput,
  ),
  alerts,
  h('div', { class: 'panel__content' }, tabs, body),
  h(
    'details',
    { class: 'credits' },
    h('summary', null, 'Map sources'),
    h(
      'div',
      null,
      h('p', null, 'CTX: NASA / JPL / MSSS / The Murray Lab. Tiles: Esri.'),
      h('p', null, 'HiRISE: NASA / JPL / University of Arizona. Terrain and tiles: NASA Mars Trek.'),
      h('p', null, 'Globe: Viking Orbiter color mosaic, MDIM 2.1. NASA / JPL / USGS, through Mars Trek.'),
      h('p', null, 'Planetocentric latitude, east longitude. Terrain shading does not establish safe slopes.'),
    ),
  ),
)
const footer = h('footer', { class: 'status' }, tileState, scale, cursor)
const backdrop = h('button', { type: 'button', class: 'sidebar-backdrop', 'aria-label': 'Close sidebar', tabindex: -1, onclick: () => setSidebar(false) })
// Before a file is open: Mars as a globe, and the ways to open one.
const welcomeActions = h('div', { class: 'globe__actions' })
const welcome = h('section', { class: 'globe', 'aria-label': 'No mission open' }, welcomeActions)
const globe = createGlobe(welcome)
const viewer = document.getElementById('viewer')!
viewer.append(mapRoot, welcome, backdrop, sidebarButton, panel, footer)
// The map's size depends on the status bar's. Changing it inside this
// callback would resize the map within the same frame, which browsers report
// as a ResizeObserver loop, so it waits for the next frame.
new ResizeObserver(() =>
  requestAnimationFrame(() => viewer.style.setProperty('--viewer-status-height', `${footer.getBoundingClientRect().height}px`)),
).observe(footer)

function setSidebar(open: boolean) {
  sidebarOpen = open
  viewer.classList.toggle('sidebar-open', open)
  panel.inert = !open
  sidebarButton.setAttribute('aria-expanded', String(open))
  sidebarButton.hidden = open
  render()
  if (open) closeButton.focus()
  else sidebarButton.focus()
}

const map = createMap(mapRoot, {
  select(site) {
    selected = site
    tab = 'sites'
    setSidebar(true)
    document.getElementById(`site-${site}`)?.scrollIntoView({ block: 'nearest' })
  },
  selectCrew(member) {
    tab = 'live'
    openCrew.add(member)
    setSidebar(true)
    const person = document.getElementById(`crew-${member}`)
    person?.scrollIntoView({ block: 'nearest' })
    person?.querySelector('summary')?.focus()
  },
  status(state: MapStatus) {
    const missing = state.terrainMissing ? 'Terrain missing. Ground shown level.' : state.imageryMissing ? 'Map imagery missing in places.' : ''
    footer.classList.toggle('has-warning', Boolean(missing) || state.flat || state.loading)
    tileState.replaceChildren(
      ...[
        missing || (state.loading ? 'Loading the map' : ''),
        missing && h('button', { type: 'button', class: 'link', onclick: () => map.retry() }, 'Retry'),
        state.flat && 'Flat map · 3D off',
      ].filter((part): part is string | HTMLButtonElement => Boolean(part)),
    )
  },
  cursor(text) {
    cursor.textContent = text
  },
  scale(pixelsPerMeter) {
    // The longest round length that fits in 110 pixels.
    const longest = 110 / pixelsPerMeter
    const decade = 10 ** Math.floor(Math.log10(longest))
    const length = [5, 2, 1].find((n) => n * decade <= longest)! * decade
    scaleBar.style.width = `${length * pixelsPerMeter}px`
    scaleLabel.textContent = length >= 1000 ? `${num(length / 1000)} km` : `${num(length)} m`
  },
  route(next) {
    route = next
    // The crew moves onto the route, and the Sites tab gets its distances.
    updatePositions()
    if (sidebarOpen) renderPanel()
  },
})

// What the crew walks: the route once found, and the plan's stops before.
const walkPath = (mission: Mission): Array<[number, number]> | undefined =>
  route ? routeLine(route) : planStops(mission).map((site): [number, number] => [mission.sites[site]!.lat, mission.sites[site]!.lon])

// The simulation only updates markers and readouts. It never replans the
// mission. Readouts change in place, so open rows and focus stay put.
let liveLevel: Level = 'ok'
function updatePositions() {
  positions = doc && liveEnabled ? simulatedPositions(doc.planned.mission, liveSeconds, self, walkPath(doc.planned.mission)) : []
  readings = doc ? readSuitSensors(doc.planned.mission.crew.length, liveSeconds) : []
  map.setCrew(positions, livePaused)
  const level = worstOf(readings)
  if (level !== liveLevel) {
    liveLevel = level
    if (doc) renderTabs()
  }
  if (!sidebarOpen || tab !== 'live') return
  for (const position of positions) {
    const readout = body.querySelector<HTMLElement>(`[data-position="${position.member}"]`)
    if (readout) readout.textContent = formatLatLon(position.lat, position.lon)
  }
  for (const reading of readings) {
    for (const item of sensorItems(reading).flatMap(([, items]) => items)) {
      const node = body.querySelector<HTMLElement>(`[data-reading="${reading.member}-${item.key}"]`)
      if (!node) continue
      node.textContent = item.value
      node.className = levelClass(item.level)
    }
    const summary = body.querySelector<HTMLElement>(`[data-summary="${reading.member}"]`)
    if (summary) summary.replaceChildren(h('span', null, personSummary(reading)))
  }
  const eva = body.querySelector<HTMLElement>('[data-reading="eva"]')
  if (eva && readings[0]) eva.textContent = duration(readings[0].elapsedS)
}

function scheduleLive() {
  clearInterval(liveTimer)
  liveTimer = 0
  updatePositions()
  // Sensors run while positions are hidden. Pause and a hidden page stop both.
  if (document.hidden || livePaused || readings.length === 0) return
  lastTick = performance.now()
  liveTimer = window.setInterval(() => {
    const now = performance.now()
    liveSeconds = advanceSimulation(liveSeconds, now - lastTick, true)
    lastTick = now
    updatePositions()
  }, 1000)
}
document.addEventListener('visibilitychange', scheduleLive)
window.addEventListener('pagehide', () => clearInterval(liveTimer))
window.addEventListener('pageshow', scheduleLive)

// Opening, and handing over to the editor.

function keep() {
  if (!doc) return
  try {
    localStorage.setItem(STORE, JSON.stringify({ fileName: doc.fileName, file: doc.planned.file }))
  } catch {
    // A blocked or full browser store must not stop the viewer.
  }
}

function show(next: Doc) {
  doc = next
  self = 0
  liveSeconds = 0
  livePaused = false
  fileProblem = null
  selected = -1
  keep()
  const { sites, markers } = next.planned.mission
  placed = map.show(sites, markers ?? [], planStops(next.planned.mission))
  scheduleLive()
  const anchor = sites[0]
  if (anchor && positions.length) map.lookAt(anchor.lat, anchor.lon, 700)
  render()
}

// Reads a mission and asks the planner about it.
async function open(fileName: string, read: () => Promise<Mission>) {
  opening = fileName
  fileProblem = null
  render()
  try {
    const planned = await requestPlan(await read())
    opening = null
    show({ fileName, planned })
  } catch (error) {
    opening = null
    // The planner says what is wrong with a mission. Anything else is the
    // browser failing to read the file.
    const reason = error instanceof PlannerError ? plainWords(error.message) : 'the file could not be read'
    fileProblem = { text: `Could not open ${fileName}: ${reason}.`, retry: () => void open(fileName, read) }
    setSidebar(true)
  }
}

function openFile(file: File | undefined) {
  if (file) void open(file.name, () => readMissionFile(file, []))
}

// Leaves the mission for the editor and opens it on the stage that matches
// the open tab. The editor adds the mission to its list, or reopens it if it
// is there already.
function editInPlanner() {
  if (!doc) return
  if (!handOff({ mission: doc.planned.mission, fileName: doc.fileName })) {
    fileProblem = { text: 'This browser would not pass the mission to the planner. Open the file there with Open mission file.' }
    setSidebar(true)
    return
  }
  location.assign(new URL(`./#${STAGES[tab]}`, location.href))
}

// Small pieces of the panel.

const amount = (value: string, unit: string): Child => [value, h('span', { class: 'unit' }, ` ${unit}`)]
// A caveat is a native tip on the whole row. Its label is underlined dotted,
// as in the editor's plan panel, so the reader knows there is one.
const row = (label: string, value: Child, caveat?: string) =>
  h('div', { class: 'row', title: caveat }, h('span', { class: 'row__label' }, label), h('span', { class: 'row__value' }, value))
const section = (heading: string, ...children: Child[]) => h('section', null, h('h2', null, heading), children)

function overview({ planned }: Doc): Child {
  const { plan, cautions, mission } = planned
  const { total, provision } = plan
  const seconds = plan.days * SECONDS_PER_DAY
  const recycled = (used: number, supplied: number) => (used > 0 ? `${Math.round((1 - supplied / used) * 100)}% recycled` : '')
  const readout = (label: string, value: number, unit: string, sub: string) =>
    h(
      'div',
      { class: 'readout' },
      h('span', { class: 'readout__label' }, label),
      h('span', { class: 'readout__value' }, amount(num(value), unit)),
      h('span', { class: 'readout__sub' }, sub),
    )
  return [
    cautions.length > 0 &&
      h(
        'ul',
        { class: 'cautions', 'aria-label': 'Cautions' },
        cautions.map((text) => h('li', null, text)),
      ),
    h(
      'section',
      null,
      row('Type', words(mission.type)),
      row('Margin', amount(num(mission.marginPercent), '%')),
      row('Length', amount(num(plan.days), 'days')),
      row('Crew', num(mission.crew.length)),
    ),
    section(
      `To supply, ${plan.marginPercent}% margin included`,
      h(
        'div',
        { class: 'readouts' },
        readout('Food, packaged', provision.foodKg, 'kg', `${num(kcal(provision.foodEnergyMJ) / 1e6, 2)} Gcal`),
        readout('Water', provision.waterSupplyKg, 'kg', recycled(total.waterUsedKg, total.waterSupplyKg)),
        readout('Oxygen', provision.oxygenSupplyKg, 'kg', recycled(total.oxygenUsedKg, total.oxygenSupplyKg)),
        readout('Electricity', kwh(provision.electricityMJ), 'kWh', `${num((total.electricityMJ * 1000) / seconds, 2)} kW average`),
      ),
    ),
    h(
      'details',
      { class: 'more' },
      h('summary', null, 'Vehicle loads'),
      row('Carbon dioxide to remove', amount(num(total.co2Kg), 'kg')),
      row('Body heat to reject, average', amount(num((total.heatMJ * 1e6) / seconds), 'W')),
      row('EVA, all crew', amount(num(total.evaHours), 'h')),
    ),
  ]
}

function taskCard(mission: Mission, task: Task) {
  const crew = task.crew.map((member) => mission.crew[member]?.name).filter(Boolean)
  return h(
    'div',
    { class: 'task' },
    h('h3', null, `${words(task.kind)}, ${task.eva ? 'EVA' : 'inside'}, phase ${task.phase + 1}`),
    row('Hours', amount(num(task.hours, 1), 'h'), 'For each person on the task'),
    row('Crew', crew.join(', ') || 'Unassigned'),
    task.note && row('Note', task.note),
  )
}

const ROUTE_NOTE = "The viewer's own route search on the terrain its map loaded, shortest under the planner's Nominal limits. The planner's Sites stage can find other routes."

function sitesTab({ planned: { mission } }: Doc): Child {
  if (mission.sites.length === 0) return h('p', { class: 'note' }, 'This mission has no sites.')
  const stops = planStops(mission)
  const straight = siteLegs(stops.map((site) => mission.sites[site]!))
  const name = (site: number) => mission.sites[site]?.name ?? 'Unknown site'
  const role = (i: number) => (stops.length < 2 ? '' : i === 0 ? 'Start' : i === stops.length - 1 ? 'End' : `Stop ${i}`)
  // The leg into stop `i`: its distance, what that distance is, and why it is
  // drawn straight when it is.
  const leg = (i: number): Child => {
    if (i === 0) return null
    const walked = route?.legs[i - 1]
    const from = name(stops[i - 1]!)
    const distance = walked?.distance ?? straight[i]
    const title = !walked
      ? 'Straight line, until the route is found.'
      : walked.status === 'ok'
        ? `Along the route. Steepest step ${num(walked.maxSlope ?? 0)}° on the search grid.`
        : 'Straight line: the route search has no path here.'
    const note =
      walked?.status === 'unknown'
        ? h('p', { class: 'site__note is-caution' }, `No terrain from ${from}, so the route is unknown. Drawn straight.`)
        : walked?.status === 'blocked'
          ? h(
              'p',
              { class: 'site__note is-hazard' },
              `No path from ${from} under ${route!.limit}°. Drawn straight.${walked.needs === null ? '' : ` A ${num(Math.ceil(walked.needs))}° limit would have one.`}`,
            )
          : null
    return [typeof distance === 'number' && h('span', { class: 'site__leg', title }, `${meters(distance)} from ${from}`), note]
  }
  const pick = (site: number) => {
    selected = site
    map.select(site)
    renderPanel()
  }
  return [
    stops.length > 0 &&
      section(
        mission.route?.length ? 'Plan' : 'Plan, sites in list order',
        h(
          'ol',
          { class: 'stops' },
          stops.map((site, i) =>
            h(
              'li',
              { class: 'stop' },
              h('button', { type: 'button', class: 'site__name', onclick: () => pick(site) }, `${i + 1} ${name(site)}`),
              h('span', { class: 'stop__role' }, role(i)),
              leg(i),
              h(
                'div',
                { class: 'stop__tasks' },
                mission.tasks.map((task) => taskStop(task, stops) === i && taskCard(mission, task)),
              ),
            ),
          ),
        ),
        route
          ? row('Route, all stops', meters(route.distance), ROUTE_NOTE)
          : row('All stops, straight', meters(totalLegs(straight)), 'Straight lines between the stops over the Mars sphere, until the route is found.'),
      ),
    section(
      'Sites',
      mission.sites.map((site, i) =>
        h(
          'section',
          { class: 'site', id: `site-${i}` },
          h(
            'div',
            { class: 'site__head' },
            h('button', { type: 'button', class: 'site__name', 'aria-pressed': i === selected ? 'true' : 'false', onclick: () => pick(i) }, site.name),
          ),
          h('p', { class: 'site__place' }, formatLatLon(site.lat, site.lon)),
          site.description && h('p', { class: 'site__info' }, site.description),
          // Work at a site the plan does not visit still shows, here.
          mission.tasks.map((task) => task.site === i && taskStop(task, stops) < 0 && taskCard(mission, task)),
        ),
      ),
      row(
        'Task hours',
        amount(
          num(
            mission.tasks.reduce((sum, task) => sum + task.hours, 0),
            1,
          ),
          'h',
        ),
      ),
    ),
    (mission.markers?.length ?? 0) > 0 &&
      section(
        'Symbols',
        h(
          'ul',
          { class: 'symbols' },
          mission.markers!.map((marker) =>
            h(
              'li',
              null,
              h('button', { type: 'button', class: 'link', onclick: () => map.lookAt(marker.point[0], marker.point[1]) }, marker.label || 'Unnamed symbol'),
              h('span', { class: 'site__place' }, formatLatLon(marker.point[0], marker.point[1])),
            ),
          ),
        ),
      ),
  ]
}

function crewTab({ planned }: Doc): Child {
  const { plan, mission } = planned
  const kg = (value: number) => amount(num(value, 1), 'kg')
  return plan.crew.map((member, i) => {
    const { daily, total, taskHours } = member
    const over = member.doseSv > plan.doseLimitSv
    const dose =
      'Measured rates by phase: cruise, station, Moon or Mars surface. Habitat time uses the unshielded surface rate, ' +
      'so it is an upper bound. A solar particle event adds to it.' +
      (plan.doseUnknownDays > 0 ? ` Leaves out ${num(plan.doseUnknownDays)} days of custom phases.` : '')
    return h(
      'details',
      { class: 'person' },
      h(
        'summary',
        null,
        h('span', { class: 'person__name' }, member.name),
        h('span', { class: 'person__role' }, words(mission.crew[i]?.role ?? '')),
        h('span', { class: over ? 'is-hazard' : null }, amount(num(member.doseSv * 1000), 'mSv')),
        h('span', { class: 'more-button' }, 'Details', icon('down')),
      ),
      h('h3', null, `Whole mission, ${num(plan.days)} days, before margin`),
      row('Food, packaged', kg(total.foodKg)),
      row('Water to supply after recycling', kg(total.waterSupplyKg)),
      row('Oxygen to supply after recycling', kg(total.oxygenSupplyKg)),
      row('Carbon dioxide to remove', kg(total.co2Kg)),
      row('EVA', amount(num(total.evaHours, 1), 'h')),
      row('Tasks assigned, outside', amount(num(taskHours.eva, 1), 'h')),
      row('Tasks assigned, inside', amount(num(taskHours.inside, 1), 'h')),
      row(
        'Radiation, quiet sun',
        h('span', { class: over ? 'is-hazard' : null }, amount(`${num(member.doseSv * 1000)} of ${num(plan.doseLimitSv * 1000)}`, 'mSv career')),
        dose,
      ),
      h('h3', null, 'Per day inside'),
      row('Food energy', amount(num(kcal(daily.foodEnergyMJ)), 'kcal')),
      row('Protein', amount(range(daily.proteinG), 'g')),
      row('Carbohydrate', amount(range(daily.carbohydrateG), 'g')),
      row('Fat', amount(range(daily.fatG), 'g')),
      row('Fluid', amount(num(daily.fluidL, 2), 'L')),
    )
  })
}

function phasesTab({ planned }: Doc): Child {
  const cell = (text: string) => h('td', null, text)
  return section(
    'To supply by phase, before margin',
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ['Phase', 'Days', 'Food kg', 'Water kg', 'Oxygen kg'].map((name) => h('th', { scope: 'col' }, name)),
          ),
        ),
        h(
          'tbody',
          null,
          planned.mission.phases.map((phase, i) => {
            const total = planned.plan.phases[i]?.total
            return h(
              'tr',
              null,
              h('th', { scope: 'row' }, `${i + 1} ${words(phase.kind)}`),
              cell(num(phase.days)),
              cell(total ? num(total.foodKg) : ''),
              cell(total ? num(total.waterSupplyKg) : ''),
              cell(total ? num(total.oxygenSupplyKg) : ''),
            )
          }),
        ),
      ),
    ),
  )
}

function briefingTab({ planned }: Doc): Child {
  return h('p', { class: 'briefing-text' }, planned.mission.briefing || 'No briefing in this file.')
}

// Suit sensors shown in the simulation.

const levelClass = (level?: Level) => (level === 'hazard' ? 'is-hazard' : level === 'caution' ? 'is-caution' : '')
const worstOf = (all: SuitReading[]): Level => {
  const levels = all.map(worstLevel)
  return levels.includes('hazard') ? 'hazard' : levels.includes('caution') ? 'caution' : 'ok'
}
// Hours and minutes: "6 h 05 min", or "45 min" under an hour.
function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

interface SensorItem {
  key: string
  label: string
  value: string
  unit: string
  level?: Level
  caveat?: string
}

function sensorItems(r: SuitReading): Array<[group: string, items: SensorItem[]]> {
  const levels = readingLevels(r)
  const gramsPerHour = (kgPerSecond: number) => num(kgPerSecond * 3.6e6)
  return [
    [
      'Life signs',
      [
        { key: 'heart', label: 'Heart rate', value: num(r.heartRateBpm), unit: 'bpm' },
        { key: 'breath', label: 'Breathing', value: num(r.breathsPerMin), unit: 'per min' },
        { key: 'spo2', label: 'Blood oxygen', value: num(r.spo2 * 100), unit: '%', level: levels.spo2, caveat: 'Caution under 94%. Over the limit under 90%.' },
        { key: 'temp', label: 'Core temperature', value: num(r.coreTempK - 273.15, 1), unit: '°C' },
      ],
    ],
    [
      'Oxygen',
      [
        { key: 'use', label: 'Breathed', value: gramsPerHour(r.oxygenUseKgS), unit: 'g/h' },
        {
          key: 'leak',
          label: 'Suit leak',
          value: gramsPerHour(r.leakKgS),
          unit: 'g/h',
          level: levels.leak,
          caveat: `The plan allows ${num(SUIT.suitOxygenKgPerHour * 1000)} g/h of suit oxygen loss (BVAD). Caution above 80% of that, over the limit above it.`,
        },
        { key: 'left', label: 'Left in tank', value: num(r.oxygenLeftKg, 2), unit: 'kg' },
        {
          key: 'time',
          label: 'Time left',
          value: duration(r.oxygenTimeLeftS),
          unit: '',
          level: levels.oxygenTime,
          caveat: 'At the current use and leak. Caution under 1 h. Over the limit under 30 min, what a backup oxygen pack gives.',
        },
        { key: 'pressure', label: 'Suit pressure', value: num(r.suitPressurePa / 1000, 1), unit: 'kPa' },
      ],
    ],
    [
      'Energy',
      [
        {
          key: 'metabolic',
          label: 'Metabolic rate',
          value: num(r.metabolicW),
          unit: 'W',
          level: levels.metabolic,
          caveat: `Limit ${num(SUIT.limitW)} W, the top of the nominal suited range NASA-STD-3001 sizes for. Caution above 80% of it.`,
        },
        { key: 'energy', label: 'Since EVA start', value: num(kcal(r.energyJ / 1e6)), unit: 'kcal' },
      ],
    ],
  ]
}

// The line under a person's name: the two numbers that run out, and the
// first reading near or over a limit.
function personSummary(r: SuitReading): Child[] {
  const items = sensorItems(r).flatMap(([, list]) => list)
  const alert = items.find((item) => item.level === 'hazard') ?? items.find((item) => item.level === 'caution')
  return [
    `${num(r.heartRateBpm)} bpm · Oxygen ${duration(r.oxygenTimeLeftS)}`,
    alert && [' · ', h('span', { class: levelClass(alert.level) }, alert.label)],
  ]
}

function liveTab({ planned: { mission } }: Doc): Child {
  const photos = loadPhotos()
  if (!mission.crew.length) return h('p', { class: 'note' }, 'This mission has no crew.')
  return [
    h('p', { class: 'note' }, 'Crew positions and suit readings are simulated.'),
    h(
      'div',
      { class: 'live-actions' },
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: liveEnabled,
          disabled: !mission.sites.length,
          onchange: () => {
            liveEnabled = !liveEnabled
            scheduleLive()
            renderPanel()
          },
        }),
        'Show simulated positions',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          onclick: () => {
            livePaused = !livePaused
            scheduleLive()
            renderPanel()
          },
        },
        livePaused ? 'Resume' : 'Pause',
      ),
    ),
    h(
      'label',
      { class: 'row' },
      h('span', { class: 'row__label' }, 'You are'),
      h(
        'select',
        {
          'aria-label': 'Your crew member',
          onchange: (event: Event) => {
            self = Number((event.target as HTMLSelectElement).value)
            updatePositions()
            renderPanel()
          },
        },
        mission.crew.map((person, i) => h('option', { value: i, selected: i === self }, person.name)),
      ),
    ),
    readings[0] && row('EVA time', h('span', { 'data-reading': 'eva' }, duration(readings[0].elapsedS))),
    h(
      'div',
      { class: 'team' },
      readings.map((reading) => {
        const member = reading.member
        const person = mission.crew[member]!
        const position = positions.find((p) => p.member === member)
        const you = member === self
        return h(
          'details',
          {
            class: 'team__person',
            id: `crew-${member}`,
            'data-member': member,
            open: openCrew.has(member),
            ontoggle: (event: Event) => {
              if ((event.target as HTMLDetailsElement).open) openCrew.add(member)
              else openCrew.delete(member)
            },
          },
          h(
            'summary',
            null,
            h('span', { class: `team__portrait${you ? ' is-selected' : ''}` }, crewPortrait(person.name, portraitUrl(person.name, photos[photoKey(person.name)]))),
            h(
              'span',
              { class: 'team__who' },
              h('strong', null, you ? `${person.name} · You` : person.name),
              h('span', { class: 'team__line', 'data-summary': member }, personSummary(reading)),
            ),
            h('span', { class: 'more-button' }, 'Details', icon('down')),
          ),
          h(
            'div',
            { class: 'team__body' },
            position &&
              h(
                'div',
                { class: 'row' },
                h('span', { class: 'row__label' }, 'Position'),
                h('span', { class: 'row__value team__position', 'data-position': member }, formatLatLon(position.lat, position.lon)),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'link',
                    onclick: () => {
                      const current = positions.find((p) => p.member === member)
                      // Close enough that the group parts and the person shows alone.
                      if (current) map.lookAt(current.lat, current.lon, 150)
                      setSidebar(false)
                    },
                  },
                  'Locate',
                ),
              ),
            sensorItems(reading).map(([group, items]) => [
              h('h3', null, group),
              items.map((item) =>
                row(
                  item.label,
                  [h('span', { class: levelClass(item.level), 'data-reading': `${member}-${item.key}` }, item.value), item.unit && h('span', { class: 'unit' }, ` ${item.unit}`)],
                  item.caveat,
                ),
              ),
            ]),
          ),
        )
      }),
    ),
    h(
      'details',
      { class: 'more' },
      h('summary', null, 'Data sources'),
      h(
        'p',
        { class: 'note' },
        mission.sites.length > 1
          ? `Positions: simulated crew walking the route from site to site, out and back. Not crew telemetry. ${ROUTE_NOTE}`
          : mission.sites.length === 1
            ? `Positions: simulated around ${mission.sites[0]!.name}. Not crew telemetry.`
            : 'Positions: none, the mission has no site.',
      ),
      h(
        'p',
        { class: 'note' },
        "Suit sensors: simulated readings for each crew member, built on the plan's suit model. Not suit telemetry. The fourth suit loses oxygen close to the allowance, to show a caution.",
      ),
      mission.sites.length > 1 && row('Walking speed', amount(num(WALK_SPEED, 1), 'm/s')),
      row('Update interval', '1 s'),
      row('Motion', livePaused ? 'Paused' : 'Running'),
    ),
  ]
}

const PAGES = { live: liveTab, overview, sites: sitesTab, crew: crewTab, phases: phasesTab, briefing: briefingTab }

// Rendering. The panel is rebuilt whole, keeping its scroll.

// What the globe offers with no mission open, or with one that has nothing
// to put on the map. The sidebar keeps only its Open file button, so the two
// never show the same choices side by side.
const openActions = (): Child =>
  opening
    ? h('p', { role: 'status' }, `Opening ${opening}`)
    : doc
      ? [
          h('p', null, `${doc.planned.mission.name || 'This mission'} has no sites, so there is no ground to show. Add sites on the editor's Sites stage.`),
          h('button', { type: 'button', class: 'button button--primary', onclick: () => setSidebar(true) }, 'Mission details'),
          h('button', { type: 'button', class: 'button', onclick: () => fileInput.click() }, 'Open another file'),
        ]
      : [
        h('p', null, 'Open or drop a .mhr or JSON mission file.'),
        h('button', { type: 'button', class: 'button button--primary', onclick: () => fileInput.click() }, 'Open a mission file'),
        h('button', { type: 'button', class: 'button', onclick: () => void open('Example mission', async () => (await fetchCatalog()).example) }, 'Try an example'),
      ]

// The rail. A tab with something near a limit carries a dot, and one with
// something over a limit a triangle.
function renderTabs() {
  if (!doc) return
  const cautions = doc.planned.cautions.length
  tabs.replaceChildren(
    ...TABS.map(([id, label]) =>
      h(
        'button',
        {
          type: 'button',
          'aria-current': id === tab ? 'page' : null,
          onclick: () => {
            tab = id
            renderPanel()
          },
        },
        icon(id),
        h('span', null, label),
        id === 'overview' &&
          cautions > 0 &&
          h('span', { class: 'tabs__flag', role: 'img', 'aria-label': count(cautions, 'caution'), title: count(cautions, 'caution') }),
        id === 'live' &&
          liveLevel !== 'ok' &&
          h(
            'span',
            {
              class: liveLevel === 'hazard' ? 'tabs__flag tabs__flag--hazard' : 'tabs__flag',
              role: 'img',
              'aria-label': liveLevel === 'hazard' ? 'a suit reading over a limit' : 'a suit reading near a limit',
              title: liveLevel === 'hazard' ? 'A suit reading is over a limit' : 'A suit reading is near a limit',
            },
          ),
      ),
    ),
  )
}

function renderPanel() {
  tabs.hidden = doc === null
  if (!doc) {
    body.replaceChildren()
    return
  }
  renderTabs()
  const scroll = body.scrollTop
  body.replaceChildren(h('div', { class: 'page' }, h('h1', { class: 'page__title' }, icon(tab), TABS.find(([id]) => id === tab)![1]), PAGES[tab](doc)))
  body.scrollTop = scroll
}

function render() {
  welcome.hidden = doc !== null && placed
  welcome.setAttribute('aria-label', doc ? 'Nothing to show on the map' : 'No mission open')
  globe.run(!welcome.hidden)
  if (!welcome.hidden) welcomeActions.replaceChildren(h('div', { class: 'empty' }, openActions()))
  title.replaceChildren(
    ...(doc
      ? [h('strong', null, doc.planned.mission.name || 'Unnamed mission')]
      : [h('strong', null, 'Mission viewer')]),
  )
  editButton.hidden = !doc
  scale.hidden = !doc

  const alert = (word: string, text: string, ...actions: Array<[string, () => void]>) =>
    h(
      'p',
      { role: 'alert' },
      h('b', null, word),
      text,
      actions.map(([label, act]) => h('button', { type: 'button', class: 'link', onclick: act }, label)),
    )
  const dismiss = (act: () => void): [string, () => void] => [
    'Dismiss',
    () => {
      act()
      render()
    },
  ]
  alerts.replaceChildren(
    ...[
      fileProblem &&
        alert(
          'Caution',
          fileProblem.text,
          ...(fileProblem.retry ? [['Retry', fileProblem.retry] as [string, () => void]] : []),
          dismiss(() => (fileProblem = null)),
        ),
    ].filter((node): node is HTMLParagraphElement => Boolean(node)),
  )
  renderPanel()
}

// The whole page takes a dropped file.
document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => {
  event.preventDefault()
  openFile(event.dataTransfer?.files[0])
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sidebarOpen) {
    event.preventDefault()
    ;(document.activeElement as HTMLElement)?.blur()
    setSidebar(false)
    return
  }
  // On phones the sidebar covers the map, so keyboard focus stays inside it.
  if (event.key === 'Tab' && sidebarOpen && matchMedia('(max-width: 860px)').matches) {
    const controls = [...panel.querySelectorAll<HTMLElement>('button, input, textarea, select, summary, [tabindex="0"]')].filter(
      (node) => node.getClientRects().length > 0 && !node.matches(':disabled'),
    )
    const first = controls[0],
      last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
  if (!(event.ctrlKey || event.metaKey)) return
  // The letter typed, or on a keyboard layout without Latin letters, the key
  // in that letter's place.
  const letter = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : event.code.replace(/^Key/, '').toLowerCase()
  if (letter === 'o') fileInput.click()
  else return
  event.preventDefault()
})

registerMapCache()
render()
map.show([], [], [])

// The file from the last visit opens again.
try {
  const stored = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { fileName?: unknown; file?: unknown } | null
  if (stored && typeof stored.fileName === 'string' && typeof stored.file === 'string') {
    const bytes = Uint8Array.from(atob(stored.file), (char) => char.charCodeAt(0))
    void open(stored.fileName, () => decodeFile(bytes))
  }
} catch {
  // Nothing usable was stored.
}
