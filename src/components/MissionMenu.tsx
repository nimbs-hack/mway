import { useEffect, useRef, useState } from 'react'
import type { Catalog } from '../api'
import { words } from '../numbers'
import { type Draft, UNNAMED } from '../state'
import { Select, Slider } from './controls'
import { Mark } from './icons'

// The open mission in the top bar: its name, typed in place, and a button
// that opens its type and margin underneath. The panel closes on Esc or a
// press anywhere else, as the data credits do.
export function MissionMenu({
  catalog,
  draft,
  flag,
  onName,
  onType,
  onMargin,
  onSettle,
}: {
  catalog: Catalog
  draft: Draft
  // Set when the planner refuses one of these three values.
  flag: boolean
  onName: (name: string) => void
  onType: (type: string) => void
  onMargin: (percent: number) => void
  // Focus has left the menu, so what was typed can snap to what the file stores.
  onSettle: () => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent | KeyboardEvent) => {
      if ('key' in event ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div
      className="mission-menu"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onSettle()
      }}
    >
      <input
        id="mission-name"
        aria-label="Mission name"
        className="input mission-menu__name"
        value={draft.name}
        maxLength={31}
        placeholder={UNNAMED}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onName(e.target.value)}
      />
      <button
        type="button"
        className="topbar__action topbar__action--icon"
        aria-expanded={open}
        aria-controls="mission-settings"
        aria-label="Mission type and margin"
        data-tip="Mission type and margin"
        data-tip-side="bottom"
        onClick={() => setOpen(!open)}
      >
        <Mark id={open ? 'up' : 'down'} />
      </button>
      {flag && <span className="tab__flag">Fix</span>}
      {open && (
        <div id="mission-settings" className="mission-menu__panel">
          <Select
            label="Type"
            value={draft.type}
            options={catalog.missionTypes.map((entry) => entry.id)}
            onChange={onType}
            format={words}
          />
          <Slider
            label="Margin on supplies"
            value={draft.marginPercent}
            onChange={onMargin}
            min={catalog.minMarginPercent}
            max={catalog.maxMarginPercent}
            unit="%"
          />
        </div>
      )}
    </div>
  )
}
