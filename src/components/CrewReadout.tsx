import { useLayoutEffect, useRef, useState } from 'react'
import type { Viewer } from 'cesium'
import { overlaps } from './map-label-layout'
import './crew-readout.css'

// Presentation fixtures only. These do not feed route assessments or HUD snapshots.
const SUITS = [
  { oxygen: 78, battery: 86, pressurePa: 29600 },
  { oxygen: 64, battery: 73, pressurePa: 29500 },
  { oxygen: 91, battery: 94, pressurePa: 29700 },
  { oxygen: 82, battery: 88, pressurePa: 29600 },
]

export default function CrewReadout({ name, trigger, viewer, onClose }: {
  name: string
  trigger: HTMLButtonElement
  viewer: Viewer
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const seed = Array.from(name).reduce((sum, character) => sum + character.codePointAt(0)!, 0)
  const suit = SUITS[seed % SUITS.length]

  useLayoutEffect(() => {
    if (place) panel.current?.focus({ preventScroll: true })
  }, [place])

  useLayoutEffect(() => {
    const element = panel.current
    const stage = element?.parentElement
    if (!element || !stage || viewer.isDestroyed()) return
    const box = stage.getBoundingClientRect()
    const anchor = trigger.getBoundingClientRect()
    const gap = 8
    const maxLeft = Math.max(gap, box.width - element.offsetWidth - gap)
    const maxTop = Math.max(gap, box.height - element.offsetHeight - gap)
    const obstacles = Array.from(stage.querySelectorAll('.nav, .routes, .profile, .readout, .switcher, .pointmenu, .tools')).map((node) => {
      const rect = node.getBoundingClientRect()
      return { x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height }
    }).filter((rect) => rect.width && rect.height)
    const x = Math.max(gap, Math.min(anchor.left - box.left, maxLeft))
    const y = Math.max(gap, Math.min(anchor.bottom - box.top + gap, maxTop))
    // Try near the portrait first, then the edges of neighboring map controls.
    const xs = [x, gap, maxLeft, ...obstacles.flatMap((rect) => [rect.x - element.offsetWidth - gap, rect.x + rect.width + gap])]
    const ys = [y, anchor.top - box.top - element.offsetHeight - gap, gap, maxTop,
      ...obstacles.flatMap((rect) => [rect.y - element.offsetHeight - gap, rect.y + rect.height + gap])]
    const candidates = xs.flatMap((left) => ys.map((top) => ({ left, top })))
      .filter(({ left, top }) => left >= gap && left <= maxLeft && top >= gap && top <= maxTop)
      .sort((a, b) => Math.hypot(a.left - x, a.top - y) - Math.hypot(b.left - x, b.top - y))
    setPlace(candidates.find(({ left, top }) => !obstacles.some((rect) => overlaps(rect, {
      x: left, y: top, width: element.offsetWidth, height: element.offsetHeight,
    }))) ?? { left: x, top: y })
    trigger.setAttribute('aria-expanded', 'true')
    trigger.classList.add('is-selected')
    viewer.scene.requestRender()

    const dismiss = (restoreFocus = false) => {
      if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true })
      onClose()
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      dismiss(true)
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target) && !trigger.contains(event.target)) dismiss()
    }
    const focusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !element.contains(event.target) && !trigger.contains(event.target)) dismiss()
    }
    const removeMove = viewer.camera.moveStart.addEventListener(() => dismiss())
    const resize = new ResizeObserver(() => {
      const next = stage.getBoundingClientRect()
      if (next.width !== box.width || next.height !== box.height) dismiss()
    })
    resize.observe(stage)
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)
    return () => {
      trigger.setAttribute('aria-expanded', 'false')
      trigger.classList.remove('is-selected')
      removeMove()
      resize.disconnect()
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', focusOutside)
      if (!viewer.isDestroyed()) viewer.scene.requestRender()
    }
  }, [trigger, viewer, onClose])

  return <div ref={panel} className="crew-readout" role="dialog" aria-label={`${name}, simulated suit readings`} tabIndex={-1}
    style={place ?? { visibility: 'hidden' }}>
    <header>
      <div><h2>{name}</h2><p>Suit, simulated</p></div>
      <button type="button" aria-label="Close suit readings" data-tip="Close suit readings" onClick={() => {
        trigger.focus({ preventScroll: true })
        onClose()
      }}>×</button>
    </header>
    <dl>
      <div><dt>Oxygen left</dt><dd>{suit.oxygen}<span> %</span></dd></div>
      <div><dt>Leak</dt><dd>None detected</dd></div>
      <div><dt>Suit pressure</dt><dd>{(suit.pressurePa / 1000).toFixed(1)}<span> kPa</span></dd></div>
      <div><dt>Battery</dt><dd>{suit.battery}<span> %</span></dd></div>
    </dl>
  </div>
}
