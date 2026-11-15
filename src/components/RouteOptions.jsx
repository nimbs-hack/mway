import { formatDuration } from '../data/plan'
import { slopeLevel } from '../data/route-profile'
import { formatDistance, formatSlope } from './RouteProfile'
import './route-options.css'

/**
 * Suggested routes from start through the user's stops to the target,
 * pinned to the top left of the map. Hovering a row brightens its dashed
 * line on the map. Picking one adds its turn points to the plan between the
 * stops. Times are one way.
 *
 * A suggestion's slope comes from the search grid. Once a route is picked it
 * is the plan, and `measured` holds the plan's distance and steepest slope
 * on the full terrain. The picked row shows those, so it never disagrees
 * with the profile and the verdict.
 *
 * `groundPending` is true while HiRISE tiles are still being read for rocks
 * and ripples. Routes shown before then are from terrain alone and can move.
 */
export default function RouteOptions({ status, searchFailed, thermalPending, groundPending, options, chosen, measured, hover, limit, note, needs, onHover, onChoose, onRaise, onRetry }) {
  if (status === 'loading') return <p className="routes routes--note" role="status">Finding routes…</p>
  if (status === 'error') {
    return (
      <p className="routes routes--note" role="status">
        {searchFailed ? 'Route search failed.' : 'No terrain for routes.'} <button type="button" onClick={onRetry}>Retry</button>
      </p>
    )
  }
  if (status === 'blocked') {
    const raise = needs === null ? null : Math.ceil(needs)
    return (
      <p className="routes routes--note" role="status">
        No route under {limit}°.{raise !== null && <> Needs {raise}°. <button type="button" onClick={() => onRaise(raise)}>Use {raise}°</button></>}
      </p>
    )
  }
  if (!options.length) return null
  // When every strategy found the same path, one row and the reason.
  const shown = note ? options.slice(0, 1) : options
  return (
    <ul className="routes" aria-label="Suggested routes" onPointerLeave={() => onHover(null)}>
      {shown.map((option) => {
        const picked = option.id === chosen
        const distance = picked && measured ? measured.distance : option.distance
        const maxSlope = picked && measured ? measured.maxSlope : option.maxSlope
        return (
        <li key={option.id}>
          <button
            type="button"
            aria-pressed={picked}
            title={`${option.note}. Times are one way. ${picked ? 'Slope measured along the plan.' : 'Slope estimated on the search grid. Pick the route to measure it on full terrain.'}${option.rough ? ` ${formatDistance(option.rough)} over rocks or ripples on the search grid.` : ''}`}
            onPointerEnter={() => onHover(option.id)}
            onFocus={() => onHover(option.id)}
            onBlur={() => onHover(null)}
            onClick={() => onChoose(option)}
            style={{ '--route': `var(--color-route-${option.id})` }}
          >
            <span className="routes__swatch" aria-hidden="true" />
            <span className="routes__name">{note ? 'All four' : option.name}</span>
            {option.sameAs ? (
              <span className="routes__same">Same as {option.sameAs}</span>
            ) : (
              <>
                <span>{formatDistance(distance)}</span>
                <span>{formatDuration(option.time)}</span>
                <span className={`is-${slopeLevel(maxSlope, limit)}`}>{formatSlope(maxSlope)}</span>
              </>
            )}
          </button>
        </li>
        )
      })}
      {/* The two solid lines on the map are not strategies, so they are named here. */}
      <li className="routes__key">
        <span><i className="routes__solid" aria-hidden="true" />Plan</span>
        <span><i className="routes__solid routes__solid--hazard" aria-hidden="true" />Over {limit}°</span>
      </li>
      {thermalPending && <li className="routes__why" role="status">Loading night IR for Thermal and Detour…</li>}
      {groundPending && <li className="routes__why" role="status">Reading HiRISE for rocks and ripples. Routes may move…</li>}
      {note && <li className="routes__why">{note}</li>}
    </ul>
  )
}
