import type { ReactNode } from 'react'
import type { StepId } from '../state'

// One line icon per stage, drawn like the ones on the plan panel's rail.
const STAGE: Record<StepId, ReactNode> = {
  home: <path d="M4 11.5 12 4l8 7.5M6 10v10h12V10M10 20v-6h4v6" />,
  crew: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M16 5.5a3 3 0 0 1 0 5M17.5 14.5c2 .8 3.5 2.8 3.5 5.5" />
    </>
  ),
  phases: <path d="M3 7h7v4H3zM10 13h6v4h-6zM16 7h5v4h-5zM3 21h18" />,
  sites: <path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  review: <path d="M9 4h6v3H9zM9 5.5H5V21h14V5.5h-4M8.5 14l2.5 2.5 4.5-5" />,
}

export function StageIcon({ id }: { id: StepId }) {
  return (
    <svg className="plan__icon" viewBox="0 0 24 24" aria-hidden="true">
      {STAGE[id]}
    </svg>
  )
}

// Small marks for buttons that have no words.
const MARK = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
}

export function Mark({ id }: { id: keyof typeof MARK }) {
  return (
    <svg className="plan__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={MARK[id]} />
    </svg>
  )
}
