import { useState } from 'react'
import type { Catalog } from '../api'
import { words } from '../numbers'
import { DEFAULT_TYPE, UNNAMED } from '../state'
import { Button, Select, Slider, TextField } from './controls'

// What a new mission file starts with. Shown over the page, like the dialog
// an editor shows before it makes a file. Esc and Cancel make nothing.
export function NewMission({
  catalog,
  onCreate,
  onCancel,
}: {
  catalog: Catalog
  onCreate: (name: string, type: string, marginPercent: number) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState(DEFAULT_TYPE)
  const [margin, setMargin] = useState(catalog.defaultMarginPercent)
  const inRange = margin >= catalog.minMarginPercent && margin <= catalog.maxMarginPercent

  return (
    <dialog
      className="dialog"
      aria-labelledby="new-mission-title"
      ref={(node) => {
        if (node && !node.open) node.showModal()
      }}
      onClose={onCancel}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (inRange) onCreate(name.trim(), type, margin)
        }}
      >
        <h2 id="new-mission-title" className="card__title">
          New mission
        </h2>
        <TextField label="Name" value={name} maxLength={31} placeholder={UNNAMED} onChange={setName} />
        <Select
          label="Type"
          value={type}
          options={catalog.missionTypes.map((entry) => entry.id)}
          onChange={setType}
          format={words}
        />
        <Slider
          label="Margin on supplies"
          value={margin}
          onChange={setMargin}
          min={catalog.minMarginPercent}
          max={catalog.maxMarginPercent}
          unit="%"
        />
        <div className="actions">
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!inRange}
            title={
              inRange ? undefined : `Margin goes from ${catalog.minMarginPercent} to ${catalog.maxMarginPercent} %`
            }
          >
            Create
          </Button>
        </div>
      </form>
    </dialog>
  )
}
