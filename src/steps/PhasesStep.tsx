import { useState } from 'react'
import type { Catalog, Phase, PhaseParams } from '../api'
import { num, words } from '../numbers'
import type { Selection } from '../state'
import { Button, NumberField, Select, Slider } from '../components/controls'
import { isOpen, Row } from './parts'
import { StageIcon } from '../components/icons'

// How each phase parameter is shown and edited. `scale` converts the stored
// value to the one on screen (watts to kilowatts, shares to percent).
const PARAMS: Array<{
  key: keyof PhaseParams
  label: string
  unit: string
  scale: number
  max: number
  sliderMax: number
  step: number
}> = [
  { key: 'evaHoursPerWeek', label: 'EVA per person-week', unit: 'h', scale: 1, max: 127.5, sliderMax: 56, step: 0.5 },
  { key: 'waterRecovery', label: 'Water recycled', unit: '%', scale: 100, max: 100, sliderMax: 100, step: 1 },
  { key: 'oxygenRecovery', label: 'Oxygen recycled', unit: '%', scale: 100, max: 100, sliderMax: 100, step: 1 },
  { key: 'hygieneWaterKg', label: 'Hygiene water per person-day', unit: 'kg', scale: 1, max: 655.35, sliderMax: 10, step: 0.01 },
  { key: 'basePowerW', label: 'Vehicle base power', unit: 'kW', scale: 0.001, max: 655.35, sliderMax: 30, step: 0.01 },
  { key: 'crewPowerW', label: 'Power per person', unit: 'kW', scale: 0.001, max: 655.35, sliderMax: 5, step: 0.01 },
]

// Avoids 18.53 showing as 18.530000000000001 after the unit conversion.
const tidy = (value: number): number => Math.round(value * 1e6) / 1e6

export function PhasesStep({
  catalog,
  phases,
  selection,
  onSelect,
  onAdd,
  onUpdate,
  onKind,
  onMove,
  onDuplicate,
  onRemove,
}: {
  catalog: Catalog
  phases: Phase[]
  selection: Selection
  onSelect: (selection: Selection) => void
  onAdd: (kind: string) => void
  onUpdate: (index: number, patch: Partial<Phase>, field: string) => void
  onKind: (index: number, kind: string) => void
  onMove: (from: number, to: number) => void
  onDuplicate: (index: number) => void
  onRemove: (index: number) => void
}) {
  // The phase being dragged and the one it is over, by position.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const dragMark = (i: number) => {
    if (!drag) return ''
    if (drag.from === i) return 'is-dragged'
    if (drag.over !== i) return ''
    return drag.from < i ? 'is-drop-below' : 'is-drop-above'
  }

  return (
    <section className="card">
      <h2 className="card__title">
        <StageIcon id="phases" />
        Phases
      </h2>
      <div className="field">
        <label className="label" htmlFor="add-phase">
          Add a phase after the open one
        </label>
        <select
          id="add-phase"
          className="input"
          value=""
          onChange={(e) => onAdd(e.target.value)}
        >
          <option value="" disabled>
            Choose a kind
          </option>
          {catalog.phaseKinds.map((kind) => (
            <option key={kind.id} value={kind.id} title={kind.summary}>
              {words(kind.id)}
            </option>
          ))}
        </select>
      </div>

      <ol className="items">
        {phases.map((phase, i) => {
          const preset = catalog.phaseKinds.find((entry) => entry.id === phase.kind)!
          return (
            <Row
              key={i}
              index={i + 1}
              name={words(phase.kind)}
              meta={Number.isNaN(phase.days) ? '' : `${num(phase.days)} d`}
              open={isOpen(selection, 'phase', i)}
              onToggle={() => onSelect(isOpen(selection, 'phase', i) ? null : { list: 'phase', index: i })}
              drag={
                phases.length > 1
                  ? {
                      mark: dragMark(i),
                      onStart: () => setDrag({ from: i, over: i }),
                      onEnd: () => setDrag(null),
                      onOver: () => drag && drag.over !== i && setDrag({ ...drag, over: i }),
                      onDrop: () => {
                        if (drag) onMove(drag.from, i)
                        setDrag(null)
                      },
                    }
                  : undefined
              }
            >
              <div className="fields fields--2">
                <Select label="Kind" value={phase.kind} options={catalog.phaseKinds.map((entry) => entry.id)} format={words} onChange={(kind) => onKind(i, kind)} />
                <NumberField label="Length" value={phase.days} min={1} max={65535} unit="d" onChange={(days) => onUpdate(i, { days }, 'days')} />
              </div>
              {PARAMS.map((param) => {
                const changed = phase[param.key] !== preset[param.key]
                const presetShown = tidy(preset[param.key] * param.scale)
                return (
                  <Slider
                    key={param.key}
                    label={param.label}
                    value={tidy(phase[param.key] * param.scale)}
                    onChange={(v) => onUpdate(i, { [param.key]: v / param.scale }, param.key)}
                    max={param.max}
                    sliderMax={param.sliderMax}
                    step={param.step}
                    unit={param.unit}
                    note={
                      changed && (
                        <button
                          type="button"
                          className="preset"
                          onClick={() => onUpdate(i, { [param.key]: preset[param.key] }, '')}
                        >
                          Reset to {presetShown}
                          {param.unit === '%' ? '%' : ` ${param.unit}`}
                        </button>
                      )
                    }
                  />
                )
              })}
              <div className="actions">
                <Button disabled={i === 0} onClick={() => onMove(i, i - 1)}>
                  Earlier
                </Button>
                <Button disabled={i === phases.length - 1} onClick={() => onMove(i, i + 1)}>
                  Later
                </Button>
                <Button onClick={() => onDuplicate(i)}>Duplicate</Button>
                <Button className="button--remove" disabled={phases.length === 1} onClick={() => onRemove(i)}>
                  Remove
                </Button>
              </div>
            </Row>
          )
        })}
      </ol>
    </section>
  )
}
