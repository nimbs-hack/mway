// CTX V01: planetocentric latitude, east longitude [-180, 180], Mars sphere.
// The 512 px geographic grid reaches about 5 m/px at level 12. Higher
// advertised service levels cannot add detail to the source imagery.
export const CTX_MAX_LEVEL = 12
export const CTX_METERS_PER_PIXEL = 5
export const CTX_TILE_SIZE = 512
export const CTX_LATITUDE_LIMIT = 88
export const CTX_API_PATH = '/api/imagery/ctx-v01'
export const CTX_UPSTREAM = 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile'
export const CTX_BACKUP_UPSTREAM = 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile'
// Bypass responses cached before repair of the upstream level-10 pyramid.
export const ctxTileUrl = (z, y, x, source = 'v01') => `${CTX_API_PATH}/${z}/${y}/${x}.png?cache=4&source=${source}`
