// Uploaded photos stay in this browser and are shared by both map pages.
export const PHOTOS_KEY = 'nimbs:planner:photos'
export type Photos = Record<string, string>
export const photoKey = (name: string): string => name.trim().toLowerCase()

export function loadPhotos(): Photos {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PHOTOS_KEY) ?? 'null')
    if (typeof saved !== 'object' || saved === null) return {}
    return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}
