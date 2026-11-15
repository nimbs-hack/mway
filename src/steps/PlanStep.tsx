import { useState } from 'react'
import type { Catalog, MissionPlan, Task } from '../api'
import { planStops, taskStop, withoutRepeats } from '../data/stops'
import { num, words } from '../numbers'
import type { Draft } from '../state'
import { Button, Select } from '../components/controls'
import { FactRow, Row } from './parts'
import { TaskEditor } from './TaskEditor'

// The plan: which sites the EVA visits, in what order, and the work at each
// stop. A stop is a site from the Sites tab. A site can come back later, as
// in A, B, A, C, A, but not twice in a row. The route on the map runs through
// the stops in this order.
export function PlanStep({
  catalog,
  draft,
  plan,
  onAdd,
  onMove,
  onRemove,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
}: {
  catalog: Catalog
  draft: Draft
  plan: MissionPlan | null
  onAdd: (site: number) => void
  onMove: (index: number, to: number) => void
  onRemove: (index: number) => void
  onAddTask: (stop: number) => void
  onUpdateTask: (index: number, patch: Partial<Task>, field: string) => void
  onRemoveTask: (index: number) => void
}) {
  // Without a plan of its own, the mission visits its sites in list order,
  // and that is what the list shows. Adding a task there makes it the plan.
  const own = Boolean(draft.route?.length)
  const stops = planStops(draft)
  const names = draft.sites.map((site) => site.name || 'Unnamed')
  const crewNames = draft.crew.map((person) => person.name || 'Unnamed')
  const phaseNames = draft.phases.map((phase, i) => `${i + 1} ${words(phase.kind)}`)
  const last = own ? stops.at(-1) : undefined
  // The site the next stop will be. It starts on one that can follow the last.
  const [chosen, setChosen] = useState<number | null>(null)
  const pick = chosen !== null && chosen < names.length && chosen !== last ? chosen : names.findIndex((_, i) => i !== last)
  const [open, setOpen] = useState(-1)
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)

  // True when moving a stop would not put a site right after itself.
  const canMove = (index: number, to: number) => {
    if (!own || to < 0 || to >= stops.length) return false
    const moved = [...stops]
    moved.splice(to, 0, ...moved.splice(index, 1))
    return withoutRepeats(moved).length === moved.length
  }
  const role = (i: number) => (stops.length < 2 ? '' : i === 0 ? 'Start' : i === stops.length - 1 ? 'End' : `Stop ${i}`)
  const dragMark = (i: number) => {
    if (!drag) return ''
    if (drag.from === i) return 'is-dragged'
    if (drag.over !== i) return ''
    return drag.from < i ? 'is-drop-below' : 'is-drop-above'
  }
  // Tasks the plan has no visit for, because their site is not in it.
  const outside = draft.tasks.filter((task) => taskStop(task, stops) < 0).length

  if (draft.sites.length === 0) return <p className="note">No sites yet. Add them on the Sites tab, then plan the order here.</p>

  return (
    <>
      <div className="plan-add">
        <Select label="Next stop" value={String(pick)} options={names.map((_, i) => String(i))} format={(index) => names[Number(index)] ?? ''} onChange={(index) => setChosen(Number(index))} />
        <Button disabled={pick < 0 || pick === last} title={pick === last ? 'The plan is at this site already' : undefined} onClick={() => onAdd(pick)}>
          Add stop
        </Button>
      </div>
      {!own && draft.sites.length > 1 && (
        <p className="note">No plan yet, so the route visits the sites in list order, as below. Add a stop to start your own.</p>
      )}
      {stops.length === 1 && <p className="note">Add a second stop and the route runs to it.</p>}

      <ol className="items">
        {stops.map((site, i) => {
          const tasks = draft.tasks.map((task, index) => ({ task, index })).filter(({ task }) => taskStop(task, stops) === i)
          const hours = tasks.reduce((sum, { task }) => sum + task.hours, 0)
          const work = tasks.length === 0 ? '' : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}, ${num(hours, 1)} h`
          return (
            <Row
              key={i}
              index={i + 1}
              name={names[site] ?? 'Unknown site'}
              meta={[role(i), work].filter(Boolean).join(', ')}
              open={open === i}
              onToggle={() => setOpen(open === i ? -1 : i)}
              drag={
                own && stops.length > 1
                  ? {
                      mark: dragMark(i),
                      onStart: () => setDrag({ from: i, over: i }),
                      onEnd: () => setDrag(null),
                      onOver: () => drag && drag.over !== i && setDrag({ ...drag, over: i }),
                      onDrop: () => {
                        if (drag && canMove(drag.from, i)) onMove(drag.from, i)
                        setDrag(null)
                      },
                    }
                  : undefined
              }
            >
              <ul className="tasks">
                {tasks.map(({ task, index }, n) => (
                  <TaskEditor
                    key={index}
                    catalog={catalog}
                    task={task}
                    n={n + 1}
                    crewNames={crewNames}
                    phaseNames={phaseNames}
                    onUpdate={(patch, field) => onUpdateTask(index, patch, field)}
                    onRemove={() => onRemoveTask(index)}
                  />
                ))}
              </ul>
              <div className="actions">
                <Button onClick={() => onAddTask(i)}>Add task</Button>
                {own && (
                  <>
                    <Button disabled={!canMove(i, i - 1)} onClick={() => onMove(i, i - 1)}>
                      Earlier
                    </Button>
                    <Button disabled={!canMove(i, i + 1)} onClick={() => onMove(i, i + 1)}>
                      Later
                    </Button>
                    <Button className="button--remove" onClick={() => onRemove(i)}>
                      Remove stop{tasks.length ? ` and its ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}` : ''}
                    </Button>
                  </>
                )}
              </div>
            </Row>
          )
        })}
      </ol>
      {outside > 0 && (
        <p className="note">
          {outside} {outside === 1 ? 'task is' : 'tasks are'} at a site the plan does not visit. Add the site as a stop to see {outside === 1 ? 'it' : 'them'} here.
        </p>
      )}

      {plan && draft.tasks.length > 0 && (
        <section>
          <h2 className="planner__title">EVA task hours against EVA hours available</h2>
          <dl className="facts">
            {plan.crew.map((member, i) => (
              <FactRow key={i} label={member.name}>
                {num(member.taskHours.eva, 1)} of {num(member.total.evaHours, 1)} h
              </FactRow>
            ))}
          </dl>
        </section>
      )}
    </>
  )
}
