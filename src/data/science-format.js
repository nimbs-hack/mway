const numberFormat = new Intl.NumberFormat('en', { maximumSignificantDigits: 3 })

// Convert only the displayed value. Stored measurements keep their SI units.
export function formatMeasurement({ value, unit }) {
  if (!Number.isFinite(value)) return 'Not reported'
  if (unit === 'K') return `${numberFormat.format(value)} K · ${numberFormat.format(value - 273.15)} °C`
  if (unit === 'Sv/day' || unit === 'Gy/day') return `${numberFormat.format(value * 1000)} m${unit}`
  if (unit === 'mol/mol') return `${numberFormat.format(value * 1e9)} ppbv`
  if (unit === 'm/s' && Math.abs(value) < 0.001) return `${numberFormat.format(value * 1e6)} µm/s`
  if (unit === 'Pa' && Math.abs(value) >= 100) return `${numberFormat.format(value / 100)} hPa`
  if (unit === 'm' && Math.abs(value) >= 1000) return `${numberFormat.format(value / 1000)} km`
  return `${numberFormat.format(value)} ${unit}`.trim()
}
