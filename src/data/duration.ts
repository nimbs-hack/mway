export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const m = minutes % 60
  return `${Math.floor(minutes / 60)} h${m ? ` ${String(m).padStart(2, '0')} min` : ''}`
}
