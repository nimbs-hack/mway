// Planning assumptions, not suit certifications. Lunar traverse studies plan
// walking routes under 20°. No Mars suit limit is published, so we use the
// same value and flag 15° as the start of caution.
export const SLOPE_CAUTION = 15
export const SLOPE_LIMIT = 20

// Caution starts 5° under the limit, as SLOPE_CAUTION does under SLOPE_LIMIT.
export function slopeLevel(slope: number | null, limit = SLOPE_LIMIT) {
  if (slope === null) return 'unknown'
  if (slope > limit) return 'hazard'
  if (slope >= limit - (SLOPE_LIMIT - SLOPE_CAUTION)) return 'caution'
  return 'ok'
}
