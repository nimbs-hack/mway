const KJ_PER_KCAL = 4.184
const MJ_PER_KWH = 3.6

export const num = (value: number, digits = 0): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const kcal = (megajoules: number): number => (megajoules * 1000) / KJ_PER_KCAL
export const kwh = (megajoules: number): number => megajoules / MJ_PER_KWH

export const range = (r: { min: number; max: number }): string => `${num(r.min)}-${num(r.max)}`

// Meters under a kilometer, kilometers above, as the map panels show distance.
export const meters = (value: number): string => (value >= 1000 ? `${num(value / 1000, 2)} km` : `${num(value)} m`)

// "flight-engineer" reads better on screen as "flight engineer".
// An id as words in sentence case: "mission-specialist" becomes "Mission specialist".
export const words = (id: string): string => {
  const spaced = id.replaceAll('-', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
