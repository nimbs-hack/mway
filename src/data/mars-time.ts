// Mars time and the Sun's position, from the Mars24 algorithm: Allison and
// McEwen, Planet. Space Sci. 48 (2000) 215, as published by NASA GISS at
// https://www.giss.nasa.gov/tools/mars24/help/algorithm.html.
// Times are UTC milliseconds. Latitude is planetocentric, longitude east,
// in degrees. Solar times are hours, 0 to 24.

const RAD = Math.PI / 180
const DAY = 86_400_000
// TT minus UTC: 32.184 s plus 37 leap seconds, unchanged since 2017.
const TT_OFFSET = 69.184

// A Mars solar day in Earth seconds.
export const SOL = 88_775.244

const mod = (value: number, by: number) => ((value % by) + by) % by

// Days since J2000 in terrestrial time.
function sinceJ2000(utc: number) {
  const jdUt = utc / DAY + 2440587.5
  return jdUt + TT_OFFSET / 86400 - 2451545.0
}

// Planetary perturbations: amplitude in degrees, period in Julian years, phase in degrees.
const PERTURBATIONS: [number, number, number][] = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
]

export type SunState = {
  // Areocentric solar longitude: the Mars season, degrees.
  ls: number
  // Subsolar latitude, degrees.
  declination: number
  // Equation of time, degrees. True solar time minus mean, times 15.
  eot: number
  // Mean solar time at longitude 0, hours.
  mst: number
}

export function sunState(utc: number): SunState {
  const dt = sinceJ2000(utc)
  const m = (19.3871 + 0.52402073 * dt) * RAD
  const fictitious = 270.3871 + 0.524038496 * dt
  const pbs = PERTURBATIONS.reduce((sum, [a, tau, phi]) => sum + a * Math.cos(((0.985626 * dt) / tau + phi) * RAD), 0)
  const center =
    (10.691 + 3.0e-7 * dt) * Math.sin(m) +
    0.623 * Math.sin(2 * m) +
    0.05 * Math.sin(3 * m) +
    0.005 * Math.sin(4 * m) +
    0.0005 * Math.sin(5 * m) +
    pbs
  const ls = mod(fictitious + center, 360)
  const l = ls * RAD
  const eot = 2.861 * Math.sin(2 * l) - 0.071 * Math.sin(4 * l) + 0.002 * Math.sin(6 * l) - center
  const declination = Math.asin(0.42565 * Math.sin(l)) / RAD + 0.25 * Math.sin(l)
  const msd = (dt - 4.5) / 1.0274912517 + 44796.0 - 0.0009626
  return { ls, declination, eot, mst: mod(24 * msd, 24) }
}

// Mars sol date: whole sols since 29 December 1873, the Mars24 count.
export function marsSolDate(utc: number) {
  return (sinceJ2000(utc) - 4.5) / 1.0274912517 + 44796.0 - 0.0009626
}

// Local true solar time at an east longitude: 12 is the Sun due north or south.
export function localSolarTime(utc: number, lon: number, state = sunState(utc)) {
  return mod(state.mst + lon / 15 + state.eot / 15, 24)
}

// Sun elevation above the horizon in degrees. Ignores refraction and terrain.
export function sunElevation(utc: number, lat: number, lon: number) {
  const state = sunState(utc)
  const hourAngle = (localSolarTime(utc, lon, state) - 12) * 15 * RAD
  const phi = lat * RAD
  const delta = state.declination * RAD
  const sin = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle)
  return Math.asin(Math.max(-1, Math.min(1, sin))) / RAD
}

// "14:05" for a solar time in hours.
export function formatSolarTime(hours: number) {
  const minutes = Math.round(mod(hours, 24) * 60) % 1440
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
