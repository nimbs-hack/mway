import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Tip = { text: string; side: string; x: number; y: number }

const GAP = 8

// Names for buttons that have only an icon. A button carries `data-tip`
// and, when the label should not sit to its left, `data-tip-side="bottom"`.
// The label shows at once on hover or keyboard focus, where a native title
// waits a second, and hides on a press, on Esc and when the pointer leaves.
// It is a visual aid only: each button names itself with aria-label.
export function Tips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const show = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null
      const text = target?.getAttribute('data-tip')
      if (!target || !text) return setTip(null)
      const box = target.getBoundingClientRect()
      const side = target.getAttribute('data-tip-side') ?? 'left'
      setTip(
        side === 'bottom'
          ? { text, side, x: box.left + box.width / 2, y: box.bottom + GAP }
          : { text, side, x: box.left - GAP, y: box.top + box.height / 2 },
      )
    }
    const hide = () => setTip(null)
    // A press also moves focus. Only focus that came from the keyboard shows
    // the label, or it would cover the menu the press just opened.
    const onFocus = (event: Event) => {
      if (event.target instanceof Element && event.target.matches(':focus-visible')) show(event)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && hide()
    document.addEventListener('pointerover', show)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerover', show)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // A label near the window's edge slides back inside it.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.marginLeft = ''
    const { left, right } = el.getBoundingClientRect()
    const shift = Math.max(GAP - left, 0) + Math.min(window.innerWidth - GAP - right, 0)
    if (shift) el.style.marginLeft = `${shift}px`
  }, [tip])

  if (!tip) return null
  return (
    <div ref={box} className={`tip tip--${tip.side}`} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      {tip.text}
    </div>
  )
}
