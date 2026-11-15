import type { Site } from '../api'
import { CTX_MAX_LEVEL, ctxTileUrl } from '../data/ctx.js'

// The picture's size on screen, and the room kept between a site and its edge.
const WIDTH = 160
const HEIGHT = 96
const MARGIN = 20
// CTX tiles are 512 px. Drawn at half that, they stay sharp on dense screens.
const TILE = 256
// Degrees per screen pixel at a level of the CTX grid, which is two tiles
// across and one down at level 0.
const degreesPerPixel = (level: number): number => 180 / (TILE * 2 ** level)

// A mission's sites joined in list order over CTX imagery, as small as a
// list row. Sites and tiles share one convention: planetocentric latitude,
// east longitude from -180 to 180. The lines are straight, not the routed
// path, which the mission file does not hold.
export function RouteThumb({ sites }: { sites: Site[] }) {
  const placed = sites.filter((site) => !Number.isNaN(site.lat + site.lon))
  if (placed.length === 0) return <span className="thumb thumb--none">No sites</span>

  const lats = placed.map((site) => site.lat)
  const lons = placed.map((site) => site.lon)
  const [south, north] = [Math.min(...lats), Math.max(...lats)]
  const [west, east] = [Math.min(...lons), Math.max(...lons)]
  const fits = (level: number) =>
    Math.max((east - west) / (WIDTH - 2 * MARGIN), (north - south) / (HEIGHT - 2 * MARGIN)) <= degreesPerPixel(level)
  // The deepest level that still shows every site.
  let level = CTX_MAX_LEVEL
  while (level > 0 && !fits(level)) level--

  const scale = degreesPerPixel(level)
  const left = ((west + east) / 2 + 180) / scale - WIDTH / 2
  const top = (90 - (south + north) / 2) / scale - HEIGHT / 2
  const points = placed.map((site): [number, number] => [(site.lon + 180) / scale - left, (90 - site.lat) / scale - top])

  const across = 2 ** (level + 1)
  const tiles: Array<{ x: number; y: number }> = []
  for (let y = Math.max(0, Math.floor(top / TILE)); y <= Math.min(2 ** level - 1, Math.floor((top + HEIGHT) / TILE)); y++)
    for (let x = Math.floor(left / TILE); x <= Math.floor((left + WIDTH) / TILE); x++) tiles.push({ x, y })

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const last = points.length - 1
  return (
    <span
      className="thumb"
      role="img"
      aria-label={`Map of ${placed.length} ${placed.length === 1 ? 'site' : 'sites'}`}
      title="Straight lines between the sites, in list order. Imagery: CTX"
    >
      {tiles.map(({ x, y }) => (
        <img
          key={`${x} ${y}`}
          // A column past either edge of the map is the one on the other side.
          src={ctxTileUrl(level, y, ((x % across) + across) % across)}
          alt=""
          loading="lazy"
          draggable={false}
          width={TILE}
          height={TILE}
          style={{ left: x * TILE - left, top: y * TILE - top }}
          // Without its imagery the route is still drawn, on the dark ground.
          onError={(e) => {
            e.currentTarget.hidden = true
          }}
        />
      ))}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
        {last > 0 && (
          <>
            <polyline className="thumb__halo" points={line} />
            <polyline className="thumb__line" points={line} />
          </>
        )}
        {points.map(([x, y], i) => (
          <rect
            key={i}
            className={i === 0 ? 'thumb__start' : i === last ? 'thumb__target' : 'thumb__point'}
            x={x - 3.5}
            y={y - 3.5}
            width={7}
            height={7}
          />
        ))}
      </svg>
    </span>
  )
}
