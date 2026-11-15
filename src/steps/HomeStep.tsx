import { useEffect, useState } from 'react'
import { PlannerError, requestPlan } from '../api'
import { Button, ConfirmButton } from '../components/controls'
import { Mark, StageIcon } from '../components/icons'
import { RouteThumb } from '../components/RouteThumb'
import { num, words } from '../numbers'
import { type LibraryEntry, type StepId, UNNAMED } from '../state'

const count = (n: number, thing: string) => `${num(n)} ${thing}${n === 1 ? '' : 's'}`

// Local date and time, short: 14 Nov 2026, 19:42.
const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

// What a mission holds, one line per stage, and what to do with it. Each
// line opens the mission on its stage. The planner is asked what Review
// would say, so a file with cautions shows them before it is opened.
function Contents({
  entry,
  onOpen,
  onDelete,
}: {
  entry: LibraryEntry
  onOpen: (stage: StepId) => void
  onDelete: () => void
}) {
  const { mission } = entry
  const [review, setReview] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    requestPlan(mission, undefined, controller.signal).then(
      ({ cautions }) => setReview(cautions.length > 0 ? count(cautions.length, 'caution') : 'Nothing to fix'),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setReview(error instanceof PlannerError && error.kind === 'invalid' ? 'Cannot plan yet' : 'Planner not answering')
      },
    )
    return () => controller.abort()
  }, [mission])

  const days = mission.phases.reduce((sum, phase) => sum + phase.days, 0)
  const lines: Array<[StepId, string, string]> = [
    ['crew', 'Crew', mission.crew.length === 1 ? '1 person' : `${num(mission.crew.length)} people`],
    ['phases', 'Phases', `${count(mission.phases.length, 'phase')}, ${num(days)} d`],
    ['sites', 'Sites', `${count(mission.sites.length, 'site')}, ${count(mission.tasks.length, 'task')}`],
    ['review', 'Review', review],
  ]
  return (
    <div className="item__body">
      <ul className="contents">
        {lines.map(([id, label, value]) => (
          <li key={id}>
            <button type="button" onClick={() => onOpen(id)}>
              <StageIcon id={id} />
              <span>{label}</span>
              <output>{value}</output>
            </button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <ConfirmButton
          label="Delete"
          confirmLabel="Confirm delete"
          className="button--remove"
          aria-label={`Delete ${mission.name || UNNAMED}`}
          onConfirm={onDelete}
        />
        <Button variant="primary" onClick={() => onOpen('crew')}>
          Edit
        </Button>
      </div>
    </div>
  )
}

// Where the app starts: every mission file kept in this browser, newest
// first, each with its sites on the map. A row opens to what the mission
// holds. The file being edited is outlined.
export function HomeStep({
  library,
  currentId,
  onOpen,
  onDelete,
  onOpenFile,
  onNew,
}: {
  library: LibraryEntry[]
  currentId: string | null
  onOpen: (entry: LibraryEntry, stage: StepId) => void
  onDelete: (entry: LibraryEntry) => void
  onOpenFile: () => void
  onNew: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="card">
      <h2 className="card__title">
        <StageIcon id="home" />
        Missions
      </h2>
      <div className="actions">
        <Button onClick={onOpenFile} title="Ctrl+O">
          Open mission file
        </Button>
        <Button onClick={onNew}>New mission</Button>
        {/* The lighter page for reading a mission file, at /viewer.html. */}
        <a className="button button--secondary" href={`${import.meta.env.BASE_URL}viewer.html`} title="A lighter page that opens a mission file on its own map, for a device that cannot carry the planner">
          Open mission viewer
        </a>
      </div>

      <ul className="people">
        {library.map((entry) => {
          const isOpen = open === entry.id
          return (
            <li key={entry.id} className={`person${entry.id === currentId ? ' is-selected' : ''}`}>
              <button
                type="button"
                className="person__line file"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : entry.id)}
              >
                <RouteThumb sites={entry.mission.sites} />
                <span className="person__who">
                  <span className="person__name">{entry.mission.name || UNNAMED}</span>
                  <span className="person__meta">
                    {entry.source === 'saved' ? 'Saved' : `Received${entry.file ? ` as ${entry.file}` : ''}`}{' '}
                    {when(entry.at)}
                  </span>
                  <span className="person__meta">{words(entry.mission.type)}</span>
                </span>
                <Mark id={isOpen ? 'up' : 'down'} />
              </button>
              {isOpen && (
                <Contents entry={entry} onOpen={(stage) => onOpen(entry, stage)} onDelete={() => onDelete(entry)} />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
