import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Draft, StepId } from '../state'

// A tour that plans a first mission with the user, one action at a time.
// Each step outlines the exact control to use and says what to do with it,
// then moves on by itself once the user has done it. The user makes every
// edit and every tab change; the tour only watches. Back, Next and Skip
// tour keep the user in charge at every step.

// What the tour watches to know a step is done.
export interface Progress {
  fileId: string | null
  draft: Draft
  stage: StepId
  // The New mission dialog is open.
  creating: boolean
  routeStart: boolean
  routeTarget: boolean
}

// One place a step can point. A step lists several, most specific first, and
// the first one on screen is used, with its own words.
interface Spot {
  find: () => Element | null
  text: string
  // Place the card around this instead of the outlined control, so it does
  // not cover the menu the control sits in.
  around?: () => Element | null
}

interface Step {
  title: string
  spots: Spot[]
  // Shown when none of the spots is on screen.
  text?: string
  // True once the user has done what the step asks.
  done?: (now: Progress, before: Progress) => boolean
  // True when the user undid the step before, such as cancelling a dialog.
  undone?: (now: Progress, before: Progress) => boolean
}

const visible = (el: Element | null | undefined): el is Element => {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}
const first = (selector: string) => [...document.querySelectorAll(selector)].find(visible) ?? null
const last = (selector: string) => [...document.querySelectorAll(selector)].filter(visible).at(-1) ?? null
const button = (scope: string, words: string) =>
  [...document.querySelectorAll(`${scope} button`)].find((el) => visible(el) && el.textContent?.trim() === words) ??
  null
const tab = (label: string) => button('.tabs', label)
// The form row whose label reads `words`.
const field = (scope: string, words: string) =>
  [...document.querySelectorAll(`${scope} .field > .label`)]
    .find((el) => visible(el) && el.textContent?.trim() === words)
    ?.closest('.field') ?? null

const TOUR: Step[] = [
  {
    title: 'Plan your first mission',
    spots: [],
    text: 'This tour takes you through a whole mission: a crew, one EVA route and a check of the plan. Each step outlines what to press and moves on once you have done it.',
  },
  {
    title: 'Make a mission',
    spots: [
      { find: () => button('.page__column', 'New mission'), text: 'Press New mission.' },
      { find: () => tab('Home'), text: 'Press Home to see your missions.' },
    ],
    done: (now) => now.creating,
  },
  {
    title: 'Name it',
    spots: [{ find: () => first('dialog[open]'), text: 'Type a name, keep the type and margin, then press Create.' }],
    done: (now, before) => now.fileId !== null && now.fileId !== before.fileId,
    undone: (now, before) => before.creating && !now.creating && now.fileId === before.fileId,
  },
  {
    title: 'Pick two crew members',
    spots: [
      {
        find: () => first('.tile:not(.is-selected)'),
        text: 'Pick two people for the EVA. Press each portrait to add them.',
      },
      { find: () => first('.card__add'), text: 'Press + Add person until the crew has two people.' },
      { find: () => tab('Crew'), text: 'Press Crew.' },
    ],
    done: (now) => now.draft.crew.length >= 2,
  },
  {
    title: 'Open the phases',
    spots: [{ find: () => tab('Phases'), text: 'Press Phases.' }],
    done: (now) => now.stage === 'phases',
  },
  {
    title: 'Check the phases',
    spots: [
      {
        find: () => field('.page__column', 'Length'),
        text: 'The mission type filled in the phases. This is how long the open one lasts. Change it if you like, then press Next.',
      },
      { find: () => first('.page__column .items'), text: 'The mission type filled in these phases. Press one to see how long it lasts, then press Next.' },
    ],
  },
  {
    title: 'Open the map',
    spots: [{ find: () => tab('Sites'), text: 'Press Sites.' }],
    done: (now) => now.stage === 'sites',
  },
  {
    title: 'Fly to a landing site',
    spots: [
      { find: () => first('.stage__loading'), text: 'The map is loading.' },
      {
        find: () => first('.stage__map'),
        text: 'Each white ring marks a landing site. Click one to fly there. You can start with Curiosity in Gale crater.',
      },
    ],
    done: () => first('.readout--tr') !== null,
  },
  {
    title: 'Set where the walk starts',
    spots: [
      { find: () => first('.stage__loading'), text: 'The map is loading.' },
      {
        find: () => button('.pointmenu', 'Start here'),
        around: () => first('.pointmenu'),
        text: 'Press Start here.',
      },
      { find: () => first('.stage__map'), text: 'Zoom in with the scroll wheel until you can see the ground, then right-click where the walk starts.' },
    ],
    done: (now) => now.routeStart,
  },
  {
    title: 'Set where it goes',
    spots: [
      {
        find: () => button('.pointmenu', 'Target here'),
        around: () => first('.pointmenu'),
        text: 'Press Target here.',
      },
      { find: () => first('.stage__map'), text: 'Right-click the place worth reaching. Somewhere a few hundred meters away works well.' },
    ],
    done: (now) => now.routeStart && now.routeTarget,
  },
  {
    title: 'Pick a route',
    spots: [
      {
        find: () => first('.routes'),
        text: 'Each row is one way to get there, drawn dashed on the map. Hover a row to compare, then press the one you want.',
      },
      { find: () => first('.plan__dock'), text: 'The planner is measuring the ground along the route.' },
    ],
    done: () => first('.routes button[aria-pressed="true"]') !== null,
  },
  {
    title: 'Read the verdict',
    spots: [
      {
        find: () => first('.plan__verdict'),
        text: 'Go, Caution or No-go, with the first reason. Red stretches on the map are over the slope limit. Press Next when you have read it.',
      },
    ],
  },
  {
    title: 'Add the EVA',
    spots: [
      {
        find: () => button('.plan__dock', 'Add EVA to mission'),
        text: 'Press Add EVA to mission. It adds a target site and a plan stop with a task as long as this walk.',
      },
    ],
    done: (now, before) => now.draft.tasks.length > before.draft.tasks.length,
  },
  {
    title: 'Send the crew',
    spots: [
      {
        find: () => last('.sites .task [aria-label="Who"] .field__buttons'),
        text: 'Press both names to send them on this EVA.',
      },
      { find: () => last('.sites .nav-button'), text: 'Press the target stop to open its tasks.' },
      { find: () => first('#plan-tab-stops'), text: 'Press Plan on the panel rail.' },
    ],
    done: (now) => now.draft.tasks.some((task) => task.eva && task.crew.length >= 2),
  },
  {
    title: 'Check the mission',
    spots: [{ find: () => tab('Review'), text: 'Press Review.' }],
    done: (now) => now.stage === 'review',
  },
  {
    title: 'Read the review',
    spots: [
      {
        find: () => first('.review'),
        text: 'This checks crew, supplies and EVA hours against the plan. Anything marked with a triangle needs a fix. Press Next when you have read it.',
      },
    ],
  },
  {
    title: 'Save it',
    spots: [
      {
        find: () => first('[aria-label="Save mission file"]'),
        text: 'Press Save to write the mission file to send or keep. Tutorial in the top bar runs this tour again.',
      },
    ],
  },
]

const SEEN_KEY = 'nimbs:planner:tutorial'
// The ring is drawn on the control's own edge, as a picked tile's is.
const PAD = 0
// The space a menu keeps from the control that opened it.
const GAP = 8
const EDGE = 16

// True when the tour was finished or skipped in this browser.
export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'seen'
  } catch {
    return true
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, 'seen')
  } catch {
    // Blocked storage only means the tour may start again next time.
  }
}

type Box = { top: number; left: number; width: number; height: number }

const rect = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height))

// The outline, padded and kept inside the window so no side is cut off.
function outline(box: Box): Box {
  const top = Math.max(box.top - PAD, 2)
  const left = Math.max(box.left - PAD, 2)
  const bottom = Math.min(box.top + box.height + PAD, window.innerHeight - 2)
  const right = Math.min(box.left + box.width + PAD, window.innerWidth - 2)
  return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) }
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top))

// The suggested routes' corner of the map, 30 px in. The card takes that
// spot on the map steps, before there are any routes to show there.
const MAP_INSET = 30

// Where the card goes. It never sits on what it points at: below the target
// is tried first, then above, right and left, then the window's corners,
// and the place that covers least of the target wins. A step pointing at
// the map gets the card in its top left corner.
function place(target: Box | null, card: { width: number; height: number }, onMap: boolean) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), Math.max(EDGE, vw - card.width - EDGE))
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), Math.max(EDGE, vh - card.height - EDGE))
  if (!target) return { left: clampX((vw - card.width) / 2), top: clampY((vh - card.height) / 2) }
  const shown = outline(target)
  if (onMap)
    return { left: clampX(shown.left + MAP_INSET), top: clampY(shown.top + MAP_INSET) }
  const near = GAP
  // Share an edge with the target: its left edge on the left half of the
  // window, its right edge on the right half, so the card stays over the
  // panel the target belongs to.
  const x = clampX(shown.left + shown.width / 2 < vw / 2 ? shown.left : shown.left + shown.width - card.width)
  const candidates = [
    { left: x, top: shown.top + shown.height + near },
    { left: x, top: shown.top - near - card.height },
    { left: shown.left + shown.width + near, top: clampY(shown.top) },
    { left: shown.left - near - card.width, top: clampY(shown.top) },
    { left: vw - card.width - EDGE, top: vh - card.height - EDGE },
    { left: EDGE, top: vh - card.height - EDGE },
    { left: vw - card.width - EDGE, top: EDGE },
    { left: EDGE, top: EDGE },
  ].filter(
    (at) => at.left >= EDGE && at.top >= EDGE && at.left + card.width <= vw - EDGE && at.top + card.height <= vh - EDGE,
  )
  let best = candidates[0] ?? { left: clampX(shown.left), top: clampY(shown.top) }
  let least = Infinity
  for (const at of candidates) {
    const covered = overlap(shown, { ...at, ...card })
    if (covered < least) [best, least] = [at, covered]
    if (covered === 0) break
  }
  return best
}

interface Seen {
  spot: number
  box: Box | null
  around: Box | null
  onMap: boolean
}

export function Tutorial({
  progress,
  onEnd,
}: {
  progress: Progress
  onEnd: () => void
}) {
  const [index, setIndex] = useState(0)
  const [seen, setSeen] = useState<Seen>({ spot: -1, box: null, around: null, onMap: false })
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  // A modal dialog makes the rest of the page inert, so while one is open
  // the card goes inside it.
  const [host, setHost] = useState<Element>(document.body)
  const card = useRef<HTMLDivElement>(null)
  const step = TOUR[index]!
  const isLast = index === TOUR.length - 1

  // The state when the step opened. A step that was already done then waits
  // for Next, so the user still reads it.
  const before = useRef(progress)
  const doneAtOpen = useRef(false)
  const now = useRef(progress)
  now.current = progress
  const go = (to: number) => {
    const next = Math.min(Math.max(to, 0), TOUR.length - 1)
    before.current = now.current
    doneAtOpen.current = TOUR[next]!.done?.(now.current, now.current) ?? false
    setIndex(next)
  }
  const goRef = useRef(go)
  goRef.current = go

  // Every frame: find the control, follow it as the page moves, and check
  // whether the step is done. Some steps are done by what is on screen, like
  // a picked route, so this is a loop rather than an effect on props.
  useEffect(() => {
    let frame = 0
    let scrolled: Element | null = null
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const step = TOUR[index]!
      if (step.undone?.(now.current, before.current)) return goRef.current(index - 1)
      const done = step.done?.(now.current, before.current) ?? false
      if (done && !doneAtOpen.current && index < TOUR.length - 1) return goRef.current(index + 1)
      if (!done) doneAtOpen.current = false

      const dialog = document.querySelector('dialog[open]') ?? document.body
      setHost((old) => (old === dialog ? old : dialog))

      let spot = -1
      let el: Element | null = null
      for (let i = 0; i < step.spots.length && !el; i++) {
        el = step.spots[i]!.find()
        if (el) spot = i
      }
      if (el && el !== scrolled) {
        scrolled = el
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      // A control inside a short panel gets the card against the panel's
      // edge, not its own, so the card never cuts into the panel.
      const panel = el?.closest('.page__column > .card') ?? null
      const aroundEl =
        (spot >= 0 ? step.spots[spot]!.around?.() : null) ??
        (panel && panel.getBoundingClientRect().height < window.innerHeight / 2 ? panel : null) ??
        el?.closest('.plan__dock, .pointmenu') ??
        (el?.matches('.stage__map') ? first('.routes') : null)
      const box = el ? rect(el) : null
      const around = aroundEl ? rect(aroundEl) : null
      const onMap = !aroundEl && (el?.matches('.stage__map, .stage__loading') ?? false)
      setSeen((old) =>
        old.spot === spot && old.onMap === onMap && sameBox(old.box, box) && sameBox(old.around, around)
          ? old
          : { spot, box, around, onMap },
      )
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [index])

  const spot = seen.spot >= 0 ? step.spots[seen.spot] : undefined
  const text = spot?.text ?? step.text ?? step.spots.at(-1)?.text ?? ''

  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const position = () => {
      const next = place(seen.around ?? seen.box, { width: el.offsetWidth, height: el.offsetHeight }, seen.onMap)
      setAt((old) => old?.left === next.left && old.top === next.top ? old : next)
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(el)
    window.addEventListener('resize', position)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
    }
  }, [seen, index, text, host])

  const end = () => {
    markSeen()
    onEnd()
  }

  // Keys act only while the card has focus, so Esc still closes a map menu
  // and arrows still move a slider.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') end()
    else if (e.key === 'ArrowRight' && !isLast) go(index + 1)
    else if (e.key === 'ArrowLeft') go(index - 1)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const ring = seen.box ? outline(seen.box) : null
  return createPortal(
    <>
      {ring ? (
        <div
          className="tutorial__spot"
          style={{ top: ring.top, left: ring.left, width: ring.width, height: ring.height }}
          aria-hidden="true"
        />
      ) : (
        <div className="tutorial__dim" aria-hidden="true" />
      )}
      <div
        ref={card}
        key={index}
        className="tutorial"
        role="dialog"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-text"
        style={at ?? { visibility: 'hidden' }}
        onKeyDown={onKey}
      >
        <div className="tutorial__head">
          <span className="tutorial__count">
            {index + 1} of {TOUR.length}
          </span>
          {!isLast && (
            <button type="button" className="tutorial__skip" onClick={end}>
              Skip tour
            </button>
          )}
        </div>
        <h2 id="tutorial-title" className="card__title">
          {step.title}
        </h2>
        <p id="tutorial-text" className="tutorial__text" aria-live="polite">
          {text}
        </p>
        <div className="actions">
          {index > 0 && (
            <button type="button" className="button button--secondary" onClick={() => go(index - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            className={`button ${step.done ? 'button--secondary' : 'button--primary'}`}
            onClick={() => (isLast ? end() : go(index + 1))}
          >
            {isLast ? 'Done' : index === 0 ? 'Start' : step.done ? 'Skip step' : 'Next'}
          </button>
        </div>
      </div>
    </>,
    host,
  )
}
