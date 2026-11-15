import type { Catalog, Task } from '../api'
import { words } from '../numbers'
import { Button, NumberField, Segmented, Select, TextField } from '../components/controls'

const WHERE = ['eva', 'inside'] as const
// The mission file counts the people on a task after the first in four bits.
const MOST_ON_A_TASK = 16

// One task: what it is, how long, in which phase, inside or outside, who
// does it and a note. `n` is its number at its stop.
export function TaskEditor({
  catalog,
  task,
  n,
  crewNames,
  phaseNames,
  onUpdate,
  onRemove,
}: {
  catalog: Catalog
  task: Task
  n: number
  crewNames: string[]
  phaseNames: string[]
  onUpdate: (patch: Partial<Task>, field: string) => void
  onRemove: () => void
}) {
  const set = <K extends keyof Task>(key: K, value: Task[K]) => onUpdate({ [key]: value } as Partial<Task>, key)
  return (
    <li className="task">
      <span className="label">Task {n}</span>
      <div className="fields fields--2">
        <Select label="Kind" value={task.kind} options={catalog.taskKinds} format={words} onChange={(v) => set('kind', v)} />
        <NumberField label="Length" value={task.hours} min={0.5} max={127.5} step={0.5} unit="h" onChange={(v) => set('hours', v)} />
      </div>
      <div className="fields fields--2">
        <Select label="Phase" value={phaseNames[task.phase]!} options={phaseNames} onChange={(name) => set('phase', phaseNames.indexOf(name))} />
        <Segmented
          label="Where"
          value={task.eva ? 'eva' : 'inside'}
          options={WHERE}
          format={(option) => (option === 'eva' ? 'EVA' : 'Inside')}
          onChange={(v) => set('eva', v === 'eva')}
        />
      </div>
      {/* Everyone pressed is on the task, and each works its whole length. */}
      <div className="field" role="group" aria-label="Who">
        <span className="label" title="Each person works the task's whole length">
          {task.crew.length === 0 ? 'Who: nobody yet' : 'Who'}
        </span>
        <div className="field__buttons">
          {crewNames.map((name, member) => {
            const on = task.crew.includes(member)
            const full = !on && task.crew.length >= MOST_ON_A_TASK
            return (
              <Button
                key={member}
                aria-pressed={on}
                disabled={full}
                title={full ? `A task takes up to ${MOST_ON_A_TASK} people` : undefined}
                onClick={() => set('crew', on ? task.crew.filter((other) => other !== member) : [...task.crew, member].sort((a, b) => a - b))}
              >
                {name}
              </Button>
            )
          })}
        </div>
      </div>
      <TextField label="Note" value={task.note} maxLength={31} onChange={(v) => set('note', v)} />
      <Button className="button--remove" onClick={onRemove}>
        Remove task {n}
      </Button>
    </li>
  )
}
