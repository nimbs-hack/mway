import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Pose } from './look'
import { TAN_HALF } from './scene'
import { elapsedText, headingText, suitReadings, tickLabel } from './suit-sim'

// What the helmet view adds to the HUD so the display moves with the head: a
// compass tape, and suit readings. Both are SIMULATED. The heading is that
// of the generated view, and the suit readings come from suit-sim.ts. The
// values change every frame, so they are written straight to the page
// instead of going through React.

const TAPE_WIDTH = 420
const TAPE_HEIGHT = 30
const TAPE_REACH = 30 // degrees drawn either side of the heading

export type DrawInstruments = (pose: Pose, viewHeight: number) => void

// Ticks sit where their bearing is in the view, so the tape turns with the
// ground: a tick stays over the same rock as the head moves.
function tape(yaw: number, viewHeight: number) {
  const focal = viewHeight / 2 / TAN_HALF
  let minor = ''
  let major = ''
  let labels = ''
  for (let degree = Math.ceil(yaw - TAPE_REACH); degree <= yaw + TAPE_REACH; degree++) {
    const x = TAPE_WIDTH / 2 + Math.tan(((degree - yaw) * Math.PI) / 180) * focal
    if (x < 1 || x > TAPE_WIDTH - 1) continue
    const at = x.toFixed(1)
    if (degree % 5 !== 0) minor += `M${at} 0V4`
    else {
      major += `M${at} 0V9`
      if (degree % 10 === 0 && x > 16 && x < TAPE_WIDTH - 16) labels += `<text x="${at}" y="25" text-anchor="middle">${tickLabel(degree)}</text>`
    }
  }
  return `<path class="helmet__tick-casing" d="${minor}${major}"/><path class="helmet__tick" d="${minor}"/><path class="helmet__tick helmet__tick--major" d="${major}"/>${labels}`
}

export function Instruments({ draw }: { draw: RefObject<DrawInstruments | null> }) {
  const heading = useRef<HTMLElement>(null)
  const ticks = useRef<SVGGElement>(null)
  const elapsed = useRef<HTMLTableCellElement>(null)
  const heart = useRef<HTMLTableCellElement>(null)
  const pressure = useRef<HTMLTableCellElement>(null)
  const carbonDioxide = useRef<HTMLTableCellElement>(null)

  useEffect(() => {
    // Only touch the page when a text changes: most frames change none.
    const write = (element: HTMLElement | null, text: string) => {
      if (element && element.textContent !== text) element.textContent = text
    }
    draw.current = (pose, viewHeight) => {
      write(heading.current, `${headingText(pose.yaw)}°`)
      if (ticks.current) ticks.current.innerHTML = tape(pose.yaw, viewHeight)
      const suit = suitReadings(pose.time)
      write(elapsed.current, elapsedText(suit.elapsed))
      write(heart.current, `${Math.round(suit.heart)} bpm`)
      write(pressure.current, `${(suit.pressure / 1000).toFixed(2)} kPa`)
      write(carbonDioxide.current, `${(suit.carbonDioxide / 1000).toFixed(2)} kPa`)
    }
    return () => { draw.current = null }
  }, [draw])

  return (
    <>
      <div className="helmet__compass" aria-label="Heading of the simulated view">
        <b ref={heading} />
        <svg width={TAPE_WIDTH} height={TAPE_HEIGHT} aria-hidden="true">
          <g ref={ticks} />
          <path className="helmet__tick-casing" d={`M${TAPE_WIDTH / 2 - 6} 0H${TAPE_WIDTH / 2 + 6}L${TAPE_WIDTH / 2} 9Z`} />
          <path className="helmet__needle" d={`M${TAPE_WIDTH / 2 - 6} 0H${TAPE_WIDTH / 2 + 6}L${TAPE_WIDTH / 2} 9Z`} />
        </svg>
      </div>
      <table className="helmet__suit">
        <caption>Suit, simulated</caption>
        <tbody>
          <tr><th scope="row">EVA elapsed</th><td ref={elapsed} /></tr>
          <tr><th scope="row">Heart rate</th><td ref={heart} /></tr>
          <tr><th scope="row">Suit pressure</th><td ref={pressure} /></tr>
          <tr><th scope="row">Carbon dioxide</th><td ref={carbonDioxide} /></tr>
        </tbody>
      </table>
    </>
  )
}
