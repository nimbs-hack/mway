// Mars maps conventionally use east longitude from 0 to 360.
export function formatLatLon(lat, lon) {
  const east = ((lon % 360) + 360) % 360
  const hemisphere = lat >= 0 ? 'N' : 'S'
  return `${Math.abs(lat).toFixed(3)}°${hemisphere}  ${east.toFixed(3)}°E`
}

// Elevation relative to the MOLA areoid, which is Mars' "sea level".
export function formatElevation(meters) {
  const rounded = Math.round(meters)
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toLocaleString('en-US')} m`
}

// Camera height above the surface reference.
export function formatAltitude(meters) {
  return meters >= 10_000 ? `${Math.round(meters / 1000).toLocaleString('en-US')} km` : `${Math.round(meters)} m`
}
