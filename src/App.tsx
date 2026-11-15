import { type ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Viewer } from 'cesium'
import { INITIAL_MAP_STATUS, mapStatusReducer, mapStatusState } from './globe/map-status.ts'
import { type Astronaut, type Catalog, type Planned, PlannerError, fetchCatalog, fileBytes, plainWords, requestPlan } from './api'
import { Mark, StageIcon } from './components/icons'
import { MissionMenu } from './components/MissionMenu'
import { NewMission } from './components/NewMission'
import { Tutorial, tutorialSeen } from './components/Tutorial'
import type { RouteEnds } from './steps/SitesPage'
import { CrewStep } from './steps/CrewStep'
import { HomeStep } from './steps/HomeStep'
import { PhasesStep } from './steps/PhasesStep'
import { ReviewStep } from './steps/ReviewStep'
import { download, fileStem, readMissionFile } from './files'
import { clearHandOff, incomingMission } from './handoff'
import { loadHud } from './data/hud-snapshot'
import { planStops } from './data/stops'
import {
  type Draft,
  STEPS,
  type Selection,
  type StepId,
  type LibraryEntry,
  UNNAMED,
  createEdits,
  loadLibrary,
  loadRoster,
  movedIndex,
  newEntry,
  stepFromHash,
  stepOfProblem,
  store,
  storedCurrent,
  storedDraft,
  useHistory,
  withEntry,
} from './state'

// The map library is tens of megabytes. Only the two pages with a map need
// it, so they load on their own and the first page does not wait for them.
const loadSites = () => import('./steps/SitesPage')
const loadGlobe = () => import('./globe/GlobeCanvas')
const SitesPage = lazy(() => loadSites().then((module) => ({ default: module.SitesPage })))
// The status bar reads the map under the cursor, so it needs the map library
// too. Imported here directly, it made every page, Home included, wait for
// that library before asking the planner anything.
const StatusBar = lazy(() => import('./components/StatusBar.jsx'))
const GlobeCanvas = lazy(() => loadGlobe().then((module) => ({ default: module.GlobeCanvas })))
// Opened straight onto a map page: fetch its map code while the planner
// gives its first answer, rather than after it.
if (stepFromHash() === 'sites') void loadSites()
else if (stepFromHash() === 'review') void loadGlobe()

const mapLoading = (
  <main className="stage stage--loading">
    <p className="loading" role="status">
      <span className="spinner spinner--large" aria-hidden="true" />
      Loading the map
    </p>
  </main>
)

// A page that stays mounted once opened. A Cesium viewer takes seconds to
// build and then loads its tiles again, so a map page is hidden, not thrown
// away, when another stage is shown. While hidden it keeps its last content
// and does not render again, so edits elsewhere cost it nothing.
function KeepAlive({ active, children }: { active: boolean; children: ReactNode }) {
  const last = useRef(children)
  if (active) last.current = children
  return (
    <div className="keep" hidden={!active}>
      {last.current}
    </div>
  )
}

// Compares values, not key order: the planner's JSON and the editor's
// objects list the same fields in different orders.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  )
}

// Map positions arrive with fifteen decimals. The file keeps six.
const degrees = (value: number): number => Math.round(value * 1e6) / 1e6

const count = (n: number, thing: string) => `${n} ${thing}${n === 1 ? '' : 's'}`

// Keeps people where they were in the roster. Someone new to it goes last.
const byRosterOrder = (roster: Astronaut[]) => {
  const place = (person: Astronaut) => {
    const at = roster.findIndex((entry) => entry.name === person.name)
    return at < 0 ? roster.length : at
  }
  return (a: Astronaut, b: Astronaut) => place(a) - place(b)
}

interface Start {
  catalog: Catalog
  // The mission files kept in this browser.
  library: LibraryEntry[]
  // The file to open with, or null to open on Home with none.
  fileId: string | null
  // That file's mission, or an empty one, already checked and planned.
  planned: Planned
}

// A draft saved before the margin had limits would be refused whole. Move its
// margin to the nearest limit so the rest of it opens.
function withinMargin(saved: unknown, catalog: Catalog): unknown {
  const margin = (saved as { marginPercent?: unknown } | null)?.marginPercent
  if (typeof margin !== 'number') return saved
  return {
    ...(saved as object),
    marginPercent: Math.min(Math.max(margin, catalog.minMarginPercent), catalog.maxMarginPercent),
  }
}

// Asks the planner about a stored mission. Undefined when the planner reads
// it and refuses it, as it does one from an older version.
async function planStored(mission: unknown): Promise<Planned | undefined> {
  try {
    return await requestPlan(mission)
  } catch (error) {
    if (!(error instanceof PlannerError) || error.kind !== 'invalid') throw error
    return undefined
  }
}

// Fetches the planner's catalog and the mission files, then opens the file
// from the last session if the planner still accepts it.
async function start(): Promise<Start> {
  const catalog = await fetchCatalog()
  const kept = loadLibrary()
  let library = kept ?? []
  let fileId = storedCurrent()

  // The mission in progress of an earlier version becomes a file, and stays open.
  const draft = storedDraft()
  const moved = draft === undefined ? undefined : await planStored(withinMargin(draft, catalog))
  if (moved) {
    const entry = newEntry(moved.mission, 'saved')
    library = withEntry(kept ?? [], entry)
    fileId = entry.id
  }

  // A mission sent from the viewer's Edit button opens over the last one. One
  // already in the list is opened again rather than added twice.
  const incoming = incomingMission()
  const received = incoming && (await planStored(incoming.mission))
  if (incoming && received) {
    const same = JSON.stringify(received.mission)
    const known = library.find((entry) => JSON.stringify(entry.mission) === same)
    const entry = known ?? newEntry(received.mission, 'received', incoming.fileName)
    if (!known) library = withEntry(library, entry)
    return { catalog, library, fileId: entry.id, planned: received }
  }

  const file = library.find((entry) => entry.id === fileId)
  const planned = moved ?? (file && (await planStored(file.mission)))
  if (planned) return { catalog, library, fileId, planned }
  return { catalog, library, fileId: null, planned: await requestPlan(createEdits(catalog).blank()) }
}

export default function App() {
  const [state, setState] = useState<Start | string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setState(null)
    start().then(
      (started) => current && setState(started),
      (error: unknown) => current && setState(error instanceof Error ? error.message : 'unknown failure'),
    )
    return () => {
      current = false
    }
  }, [attempt])

  if (state !== null && typeof state !== 'string') return <Editor {...state} />
  return (
    <div className="console console--mission">
      <header className="topbar"></header>
      <main className="startup">
        {state === null ? (
          <p className="loading" role="status">
            <span className="spinner spinner--large" aria-hidden="true" />
            Starting the planner
          </p>
        ) : (
          <div className="problem" role="alert">
            <b>Planner not available</b>
            The editor could not reach the planner service: {state}. Start it with the dev server, then retry.
            <button type="button" onClick={() => setAttempt(attempt + 1)}>
              Retry
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

// The planner's answer for one exact draft object.
type Answer = { draft: Draft; planned: Planned } | { draft: Draft; problem: string }

function Editor({ catalog, planned: opening, library: kept, fileId: openingId }: Start) {
  const edits = useMemo(() => createEdits(catalog), [catalog])
  const history = useHistory(() => opening.mission)
  const { present: draft } = history
  // What the planner changed on its own as part of the last action.
  const [notice, setNotice] = useState<string | null>(null)
  const commit = useCallback(
    (recipe: (draft: Draft) => Draft, key = '') => {
      setNotice(null)
      history.commit(recipe, key)
    },
    [history.commit],
  )
  // The mission files, and the one being edited. With none open only Home shows.
  const [library, setLibrary] = useState(kept)
  const [fileId, setFileId] = useState(openingId)
  const [creating, setCreating] = useState(false)
  // The guided tour starts by itself once, on the first visit.
  const [touring, setTouring] = useState(() => !tutorialSeen())
  // Whether the EVA route on the map has its two ends, for the tour.
  const [routeEnds, setRouteEnds] = useState<RouteEnds>({ start: false, target: false })
  useEffect(() => void store('library', library), [library])
  useEffect(() => void store('current', fileId), [fileId])
  // The viewer's mission is in the list now, so the next start opens it from there.
  useEffect(() => clearHandOff(), [])
  const [step, setStep] = useState<StepId>(() => (openingId === null ? 'home' : stepFromHash()))
  const [selection, setSelection] = useState<Selection>(null)
  const [roster, setRoster] = useState(() => loadRoster(catalog))
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // The review globe. The sites page reports its own map state.
  const [mapStatus, dispatchMapStatus] = useReducer(mapStatusReducer, INITIAL_MAP_STATUS)
  const [imagerySource, setImagerySource] = useState<'V01' | 'beta01'>('V01')
  const [retryKey, setRetryKey] = useState(0)
  const [reviewViewer, setReviewViewer] = useState<Viewer | null>(null)
  // The route for the Review globe: the one the Sites page assessed and saved
  // for the HUD, or the plan's stops in order before there is one.
  const reviewRoute = useMemo(() => {
    if (step !== 'review') return null
    const saved = loadHud(fileId ?? 'draft')?.route
    if (saved) return { points: saved.samples.map((sample) => sample.point), assessed: true }
    const stops = planStops(draft)
      .map((index) => draft.sites[index])
      .filter((site) => site !== undefined && !Number.isNaN(site.lat + site.lon))
    return stops.length > 1 ? { points: stops.map((site): [number, number] => [site!.lat, site!.lon]), assessed: false } : null
  }, [step, fileId, draft])

  const [answer, setAnswer] = useState<Answer>({ draft: opening.mission, planned: opening })
  // Why the planner did not answer, when it did not.
  const [offline, setOffline] = useState<string | null>(null)
  const [planAttempt, setPlanAttempt] = useState(0)

  // Fetch the map pages once the first page is up, so their tabs open fast.
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSites()
      void loadGlobe()
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  // Ask the planner about every new draft. An older request still in flight
  // is cancelled, so answers cannot arrive out of order.
  useEffect(() => {
    if (answer.draft === draft && !offline) return
    const controller = new AbortController()
    requestPlan(draft, undefined, controller.signal).then(
      (planned) => {
        setOffline(null)
        setAnswer({ draft, planned })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof PlannerError && error.kind === 'invalid') {
          setOffline(null)
          setAnswer({ draft, problem: error.message })
        } else {
          setOffline(error instanceof Error ? error.message : 'unknown failure')
        }
      },
    )
    return () => controller.abort()
  }, [draft, planAttempt])

  const current = answer.draft === draft
  const valid = current && 'planned' in answer ? answer.planned : null
  const problem = current && 'problem' in answer ? answer.problem : null
  // While the draft is being typed into, keep showing the last plan that worked.
  const lastGood = useRef(opening)
  if (valid) lastGood.current = valid
  const shown = lastGood.current
  const stale = problem !== null || offline !== null

  // Every edit the planner accepts is saved into the open file.
  useEffect(() => {
    if (!valid) return
    setLibrary((entries) => {
      const file = entries.find((entry) => entry.id === fileId)
      if (!file || same(file.mission, valid.mission)) return entries
      const saved = { ...file, mission: valid.mission, at: new Date().toISOString() }
      return entries.map((entry) => (entry === file ? saved : entry))
    })
  }, [valid])

  // Shows a file's mission for editing. Undo starts over: it never crosses
  // from one file into another.
  const openFile = (entry: LibraryEntry, stage: StepId) => {
    history.reset(entry.mission)
    setFileId(entry.id)
    setSelection(null)
    setNotice(null)
    setFileProblem(null)
    // Avoid a hashchange while fileId still refers to the previous render.
    window.history.pushState(null, '', `#${stage}`)
    setStep(stage)
  }
  const addFile = (entry: LibraryEntry, stage: StepId) => {
    setLibrary((entries) => withEntry(entries, entry))
    openFile(entry, stage)
  }

  // The stage lives in the address. Tabs and buttons change the address, and
  // the page follows it, so back and forward move between stages. A stage
  // other than Home needs a file, so going to one with none open makes one.
  const goTo = (next: StepId) => {
    if (next !== 'home' && fileId === null) return addFile(newEntry({ ...edits.blank(), name: UNNAMED }, 'saved'), next)
    location.hash = next
    setStep(next)
  }
  const follow = useRef(goTo)
  follow.current = goTo
  useEffect(() => {
    // With no file open the page is Home, whatever stage the address named.
    if (openingId === null) window.history.replaceState(null, '', '#home')
    const onHash = () => follow.current(stepFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // The map pages that have been opened. They stay mounted from then on.
  const opened = useRef(new Set<StepId>())
  opened.current.add(step)
  const problemStep = problem ? stepOfProblem(problem) : null
  const cautionCount = valid?.cautions.length ?? 0

  const updateRoster = (entries: Astronaut[]) => {
    setRoster(entries)
    store('roster', entries)
  }

  const open = async (file: File | undefined) => {
    if (!file) return
    try {
      addFile(newEntry(await readMissionFile(file, roster), 'received', file.name), 'review')
    } catch (error) {
      if (!(error instanceof PlannerError)) throw error
      setFileProblem(`Could not open ${file.name}: ${error.message}`)
    }
  }

  // The file is already kept here. Saving writes it out to send or store.
  const save = () => {
    if (valid) download(`${fileStem(valid.mission)}.mhr`, fileBytes(valid), 'application/octet-stream')
  }
  const exportJson = () => {
    if (valid) download(`${fileStem(valid.mission)}.json`, JSON.stringify(valid.mission, null, 2), 'application/json')
  }

  const remove = (entry: LibraryEntry) => {
    setLibrary((entries) => entries.filter((other) => other.id !== entry.id))
    if (entry.id !== fileId) return
    history.reset(edits.blank())
    setFileId(null)
    setSelection(null)
    setNotice(null)
  }

  // Latest handlers for the key listener, which is attached once.
  const keys = useRef({ save, undo: history.undo, redo: history.redo })
  keys.current = { save, undo: history.undo, redo: history.redo }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The new mission dialog has fields of its own, not part of any mission.
      if (!(e.ctrlKey || e.metaKey) || document.querySelector('dialog[open]')) return
      // The letter typed, or on a keyboard layout without Latin letters, the
      // key in that letter's place.
      const key = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase()
      if (key === 'z' && e.shiftKey) keys.current.redo()
      else if (key === 'z') keys.current.undo()
      else if (key === 'y') keys.current.redo()
      else if (key === 's') keys.current.save()
      else if (key === 'o') fileInput.current?.click()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Leaving a field snaps what was typed to what the file can store. The
  // planner's answer already holds for the snapped mission, so keep it.
  const settle = () => {
    if (!valid || same(valid.mission, draft)) return
    setAnswer({ draft: valid.mission, planned: valid })
    history.amend(valid.mission)
  }

  // Adding, removing or moving an item changes which one is open. `done`
  // says what else the planner changed to keep the mission consistent.
  const structural = (recipe: (draft: Draft) => Draft, selected: Selection = null, done?: string) => {
    commit(recipe)
    setSelection(selected)
    if (done) setNotice(done)
  }

  // Off the crew, back to the roster as the mission had them, so edits made
  // while they were selected are kept.
  const deselect = (i: number, keep = true) => {
    const person = draft.crew[i]!
    if (keep)
      updateRoster([...roster.filter((entry) => entry.name !== person.name), person].sort(byRosterOrder(roster)))
    const orphaned = draft.tasks.filter((task) => task.crew.length === 1 && task.crew[0] === i).length
    structural(
      (d) => edits.removeCrew(d, i),
      selection?.list === 'crew' ? null : selection,
      `${person.name} is off the crew.${orphaned > 0 ? ` ${count(orphaned, 'task')} of theirs now ${orphaned === 1 ? 'has' : 'have'} nobody assigned.` : ''}`,
    )
  }

  const taskCounts = useMemo(
    () => draft.sites.map((_, i) => draft.tasks.filter((task) => task.site === i).length),
    [draft.sites, draft.tasks],
  )

  // A page that is one column of cards.
  const column = (children: ReactNode) => (
    <main className="page" onBlur={settle}>
      <div className="page__column">
        {children}
      </div>
    </main>
  )

  return (
    <div
      className="console console--mission"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void open(e.dataTransfer.files[0])
      }}
    >
      <header className="topbar">
        <nav className="tabs" aria-label="Stages">
          {STEPS.map((entry) => {
            const flag =
              entry.id === problemStep
                ? 'Fix'
                : entry.id === 'review' && cautionCount > 0
                  ? count(cautionCount, 'caution')
                  : ''
            return (
              <button
                key={entry.id}
                type="button"
                className="tab"
                aria-current={entry.id === step ? 'page' : undefined}
                onClick={() => goTo(entry.id)}
              >
                <StageIcon id={entry.id} />
                {entry.label}
                {flag && <span className="tab__flag">{flag}</span>}
              </button>
            )
          })}
        </nav>
        {fileId !== null && (
          <div className="topbar__meta">
            <MissionMenu
              catalog={catalog}
              draft={draft}
              flag={problem !== null && problemStep === null}
              onName={(name) => commit((d) => ({ ...d, name }), 'name')}
              onType={(type) => {
                const loaded = edits.setType(draft, type).phases
                structural(
                  (d) => edits.setType(d, type),
                  null,
                  loaded === draft.phases
                    ? undefined
                    : `Phases replaced with the ${count(loaded.length, 'default')} for this type. Tasks kept their phase number where it still exists.`,
                )
              }}
              onMargin={(marginPercent) => commit((d) => ({ ...d, marginPercent }), 'margin')}
              onSettle={settle}
            />
            <button
              type="button"
              className="topbar__action topbar__action--icon"
              disabled={!history.canUndo}
              onClick={history.undo}
              aria-label="Undo"
              data-tip="Undo (Ctrl+Z)"
              data-tip-side="bottom"
            >
              <Mark id="undo" />
            </button>
            <button
              type="button"
              className="topbar__action topbar__action--icon"
              disabled={!history.canRedo}
              onClick={history.redo}
              aria-label="Redo"
              data-tip="Redo (Ctrl+Shift+Z)"
              data-tip-side="bottom"
            >
              <Mark id="redo" />
            </button>
            <button
              type="button"
              className="topbar__action topbar__action--icon"
              disabled={!valid}
              onClick={save}
              aria-label="Save mission file"
              data-tip="Save mission file (Ctrl+S)"
              data-tip-side="bottom"
            >
              <Mark id="save" />
            </button>
          </div>
        )}
        <button
          type="button"
          className={`topbar__action tutorial-button${fileId === null ? ' tutorial-button--end' : ''}`}
          onClick={() => setTouring(true)}
        >
          Tutorial
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".mhr,.json,application/json"
          hidden
          onChange={(e) => {
            void open(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </header>

      <div className="alerts">
        {offline && (
          <p className="problem" role="alert">
            <b>Planner not answering</b>
            The numbers shown are from the last answer it gave: {offline}.
            <button type="button" onClick={() => setPlanAttempt(planAttempt + 1)}>
              Retry
            </button>
          </p>
        )}
        {fileProblem && (
          <p className="problem" role="alert">
            <b>Caution</b>
            {fileProblem}
            <button type="button" aria-label="Dismiss" onClick={() => setFileProblem(null)}>
              ×
            </button>
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            <b>Done</b>
            {notice}
            <button
              type="button"
              onClick={() => {
                history.undo()
                setNotice(null)
              }}
            >
              Undo
            </button>
          </p>
        )}
        {problem && (
          <p className="problem" role="alert">
            <b>Cannot plan yet</b>
            {plainWords(problem)}.
            {problemStep !== null && problemStep !== step && (
              <button type="button" onClick={() => goTo(problemStep)}>
                Go to {STEPS.find((entry) => entry.id === problemStep)!.label}
              </button>
            )}
          </p>
        )}
      </div>

      {step === 'home' &&
        column(
          <HomeStep
            library={library}
            currentId={fileId}
            onOpen={openFile}
            onDelete={remove}
            onOpenFile={() => fileInput.current?.click()}
            onNew={() => setCreating(true)}
          />,
        )}
      {touring && (
        <Tutorial
          progress={{
            fileId,
            draft,
            stage: step,
            creating,
            routeStart: routeEnds.start,
            routeTarget: routeEnds.target,
          }}
          onEnd={() => setTouring(false)}
        />
      )}
      {creating && (
        <NewMission
          catalog={catalog}
          onCancel={() => setCreating(false)}
          onCreate={(name, type, marginPercent) => {
            setCreating(false)
            addFile(newEntry(edits.setType({ ...edits.blank(), name: name || UNNAMED, marginPercent }, type), 'saved'), 'crew')
          }}
        />
      )}

      {step === 'crew' &&
        column(
          <CrewStep
            catalog={catalog}
            crew={draft.crew}
            plan={valid?.plan ?? null}
            roster={roster}
            onNew={() => {
              // Counted once each, so the new call sign follows the size of the list.
              const person = edits.newPerson([
                ...roster,
                ...draft.crew.filter((member) => !roster.some((entry) => entry.name === member.name)),
              ])
              updateRoster([...roster, person])
              commit((d) => edits.addCrew(d, person))
              return person.name
            }}
            onSelect={(person) => commit((d) => edits.addCrew(d, person))}
            onDeselect={deselect}
            onUpdate={(i, patch, field) => {
              // A new call sign goes to the roster too, or the old one would stay behind as a second person.
              const old = draft.crew[i]!.name
              if (patch.name !== undefined && !roster.some((entry) => entry.name === patch.name)) {
                updateRoster(roster.map((entry) => (entry.name === old ? { ...entry, name: patch.name! } : entry)))
              }
              commit((d) => edits.updateCrew(d, i, patch), `crew ${i} ${field}`)
            }}
            onUpdateRoster={(name, patch) =>
              updateRoster(roster.map((entry) => (entry.name === name ? { ...entry, ...patch } : entry)))
            }
            onDelete={(name) => {
              const at = draft.crew.findIndex((member) => member.name === name)
              if (at >= 0) deselect(at, false)
              updateRoster(roster.filter((entry) => entry.name !== name))
            }}
          />,
        )}

      {step === 'phases' &&
        column(
          <PhasesStep
            catalog={catalog}
            phases={draft.phases}
            selection={selection}
            onSelect={setSelection}
            onAdd={(kind) => {
              const after = selection?.list === 'phase' ? selection.index : draft.phases.length - 1
              structural((d) => edits.addPhase(d, kind, after), { list: 'phase', index: after + 1 })
            }}
            onUpdate={(i, patch, field) =>
              commit((d) => edits.updatePhase(d, i, patch), field && `phase ${i} ${field}`)
            }
            onKind={(i, kind) => commit((d) => edits.setPhaseKind(d, i, kind))}
            onMove={(from, to) =>
              structural(
                (d) => edits.movePhase(d, from, to),
                // The open phase stays open wherever the move puts it.
                selection?.list === 'phase'
                  ? { list: 'phase', index: movedIndex(selection.index, from, to) }
                  : selection,
              )
            }
            onDuplicate={(i) => structural((d) => edits.duplicatePhase(d, i), { list: 'phase', index: i + 1 })}
            onRemove={(i) => {
              const moved = draft.tasks.filter((task) => task.phase === i).length
              structural(
                (d) => edits.removePhase(d, i),
                null,
                `Phase ${i + 1} removed.${moved > 0 ? ` Its ${count(moved, 'task')} moved to the phase now in that place.` : ''}`,
              )
            }}
          />,
        )}

      {opened.current.has('sites') && (
        <KeepAlive active={step === 'sites'}>
          <Suspense fallback={mapLoading}>
            <SitesPage
              key={fileId}
              missionId={fileId ?? 'draft'}
              catalog={catalog}
              draft={draft}
              plan={valid?.plan ?? null}
              taskCounts={taskCounts}
              selection={selection}
              onSelect={setSelection}
              onSettle={settle}
              onMarkers={(markers) => commit((d) => ({ ...d, markers }))}
              onRoutePoints={(points) => commit((d) => edits.setRoutePoints(d, points.map(([lat, lon]) => [degrees(lat), degrees(lon)])))}
              onAddSite={(lat, lon) =>
                structural((d) => edits.addSite(d, degrees(lat), degrees(lon)), {
                  list: 'site',
                  index: draft.sites.length,
                })
              }
              onAddEva={(lat, lon, hours, note) => {
                const after = edits.addEva(draft, degrees(lat), degrees(lon), hours, note)
                const task = after.tasks[after.tasks.length - 1]!
                structural(
                  (d) => edits.addEva(d, degrees(lat), degrees(lon), hours, note),
                  { list: 'site', index: task.site },
                  `${after.sites[task.site]!.name} has a new ${hours} h EVA task in phase ${task.phase + 1}. Nobody is assigned to it yet.`,
                )
              }}
              onUpdateSite={(i, patch, field) => commit((d) => edits.updateSite(d, i, patch), `site ${i} ${field}`)}
              onRemoveSite={(i) => {
                const gone = draft.tasks.filter((task) => task.site === i).length
                structural(
                  (d) => edits.removeSite(d, i),
                  null,
                  `${draft.sites[i]!.name} removed${gone > 0 ? ` with its ${count(gone, 'task')}` : ''}.`,
                )
              }}
              onAddStop={(site) => commit((d) => edits.addStop(d, site))}
              onMoveStop={(i, to) => commit((d) => edits.moveStop(d, i, to))}
              onRemoveStop={(i) => commit((d) => edits.removeStop(d, i))}
              onAddTask={(stop) => commit((d) => edits.addTask(d, stop))}
              onUpdateTask={(i, patch, field) => commit((d) => edits.updateTask(d, i, patch), `task ${i} ${field}`)}
              onRemoveTask={(i) => commit((d) => edits.removeTask(d, i))}
              onRoute={setRouteEnds}
            />
          </Suspense>
        </KeepAlive>
      )}

      {opened.current.has('review') && (
        <KeepAlive active={step === 'review'}>
          <div className="workspace workspace--review">
            <aside className={`review${valid ? '' : ' is-stale'}`} aria-label="Review">
              <ReviewStep
                catalog={catalog}
                planned={shown}
                stale={stale}
                onSave={valid ? save : null}
                onExportJson={exportJson}
                selectedSite={selection?.list === 'site' ? selection.index : -1}
                onSite={(index) => setSelection({ list: 'site', index })}
                missionId={fileId ?? 'draft'}
              />
            </aside>
            <Suspense fallback={mapLoading}>
              <GlobeCanvas
                sites={draft.sites}
                taskCounts={taskCounts}
                selected={selection?.list === 'site' ? selection.index : -1}
                editable={false}
                placing={false}
                onPlace={() => {}}
                onSelect={(index) => setSelection({ list: 'site', index })}
                onMove={() => {}}
                onStatus={dispatchMapStatus}
                onImagerySource={setImagerySource}
                onViewer={setReviewViewer}
                retryKey={retryKey}
                route={reviewRoute}
              />
            </Suspense>
          </div>
          <Suspense fallback={<footer className="statusbar" />}>
            <StatusBar
              viewer={reviewViewer}
              status={mapStatusState(mapStatus)}
              credits={[`CTX ${imagerySource}: NASA / JPL / USGS / MSSS / The Murray Lab / Esri`, 'Terrain: NASA Mars Trek']}
              onRetry={() => setRetryKey((key) => key + 1)}
            />
          </Suspense>
        </KeepAlive>
      )}
    </div>
  )
}
