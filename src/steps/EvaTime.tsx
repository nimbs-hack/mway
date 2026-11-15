import { loadHud } from '../data/hud-snapshot'
import { formatSolarTime, localSolarTime } from '../data/mars-time'
import { formatWhen } from '../data/space-weather'

const clock = (utc: number) => formatWhen(new Date(utc).toISOString()).replace(' UTC', '')

// When the EVA starts and when the crew is back: the start the Sites page
// uses, picked on its calendar or worked out there, plus the route's time
// out, at the target and back. Read from the route the Sites page saved for
// the HUD, so both pages show the same times.
export function EvaTime({ missionId }: { missionId: string }) {
  const hud = loadHud(missionId)
  const route = hud?.route
  if (!route || route.when === null) {
    return (
      <section>
        <h2 className="planner__title">EVA start and return</h2>
        <p className="note">Plan a route on the Sites page to get its start and return.</p>
      </section>
    )
  }
  const lon = route.samples[0]!.point[1]
  const figure = (label: string, utc: number) => (
    <div className="figure">
      <span className="readout__label">{label}, UTC</span>
      <span className="readout__value">{clock(utc)}</span>
      <span className="readout__sub">{formatSolarTime(localSolarTime(utc, lon))} local solar time</span>
    </div>
  )
  return (
    <section aria-label="EVA start and return">
      <h2 className="planner__title">EVA start and return</h2>
      {hud.status !== 'ready' && <p className="note">As last assessed. The route has changed since on the Sites page.</p>}
      <div className="review__grid">
        {figure('Start', route.when)}
        {figure('Back by', route.when + route.total * 1000)}
      </div>
    </section>
  )
}
