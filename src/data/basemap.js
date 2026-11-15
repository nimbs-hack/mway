// Viking Orbiter color mosaic (MDIM 2.1, 232 m/px), served by NASA/JPL Mars
// Trek as WMTS tiles in an equirectangular grid: two 256 px tiles across at
// zoom 0.
const TREK =
  'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm'

export const MAX_NATIVE_ZOOM = 7

// Trek answers in about a second per tile, so zoom levels up to this one ship
// with the app in public/tiles. `bun run tiles` downloads them.
export const LOCAL_MAX_ZOOM = 3

// Straight from Trek. Only `bun run tiles` uses it.
export const remoteTileUrl = (z, y, x) => `${TREK}/${z}/${y}/${x}.jpg`

// The app asks the Go server, which keeps every tile it fetches on disk and
// fetches the tiles around each one ahead of time (apps/api/internal/tiles/viking.go).
export const proxyTileUrl = (z, y, x) => `/api/imagery/viking/${z}/${y}/${x}.jpg`

export const localTilePath = (z, y, x) => `tiles/viking/${z}/${y}/${x}.jpg`
