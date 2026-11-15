import type { ReactNode } from 'react'
import type { Selection } from '../state'

// What a row needs to be dragged to another place in its list.
export interface RowDrag {
  // This row's part in the drag under way: the one dragged, or the one the
  // dragged row would land above or below.
  mark: '' | 'is-dragged' | 'is-drop-above' | 'is-drop-below'
  onStart: () => void
  onEnd: () => void
  onOver: () => void
  onDrop: () => void
}

// One line of a list, drawn as a nav button. Opens its
// editor underneath when it is the selection; a check mark supplements the
// selected colour. With `drag` it gets a grip to drag it by. `media` is a
// small picture in front of the name.
export function Row({
  index,
  name,
  meta,
  open,
  onToggle,
  drag,
  media,
  children,
}: {
  index?: number
  name: string
  meta: string
  open: boolean
  onToggle: () => void
  drag?: RowDrag
  media?: ReactNode
  children: ReactNode
}) {
  const line = (
    <button type="button" className="nav-button" aria-pressed={open} aria-expanded={open} onClick={onToggle}>
      {index !== undefined && <span className="nav-button__meta">{String(index).padStart(2, '0')}</span>}
      {media}
      <span className="nav-button__label">{name}</span>
      <span className="nav-button__meta">{meta}</span>
      <span className="nav-button__arrow" aria-hidden="true">
        {open ? '✓' : '→'}
      </span>
    </button>
  )
  return (
    <li
      className={`item${open ? ' is-open' : ''}${drag?.mark ? ` ${drag.mark}` : ''}`}
      onDragOver={drag?.onOver}
      onDrop={drag?.onDrop}
    >
      {drag ? (
        <div className="item__line">
          {/* Hidden from assistive technology: the Earlier and Later buttons do the same by keyboard. */}
          <span
            className="item__grip"
            draggable
            title="Drag to reorder"
            aria-hidden="true"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              // Firefox starts a drag only when it carries data.
              e.dataTransfer.setData('text/plain', name)
              e.dataTransfer.setDragImage(e.currentTarget.parentElement!, 0, 0)
              drag.onStart()
            }}
            onDragEnd={drag.onEnd}
          >
            <svg viewBox="0 0 10 16" aria-hidden="true">
              <path d="M2 3h.01M8 3h.01M2 8h.01M8 8h.01M2 13h.01M8 13h.01" />
            </svg>
          </span>
          {line}
        </div>
      ) : (
        line
      )}
      {open && <div className="item__body">{children}</div>}
    </li>
  )
}

export const isOpen = (selection: Selection, list: NonNullable<Selection>['list'], index: number) =>
  selection?.list === list && selection.index === index

export function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}
