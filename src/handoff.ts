// A mission handed from the viewer to the editor. The viewer does no editing
// of its own: its Edit button leaves the mission here and opens the editor,
// which takes it on start. Only a type is imported, so the viewer can use
// this without React or the map library.

import type { Mission } from './api'

const KEY = 'nimbs:planner:incoming'

export interface HandOff {
  mission: Mission
  fileName: string
}

// False when the browser would not keep it.
export function handOff(item: HandOff): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(item))
    return true
  } catch {
    return false
  }
}

// The mission waiting for the editor, or null. Reading leaves it in place:
// in development React starts the editor twice and drops the first start, so
// the editor clears it with clearHandOff once it is showing the mission.
export function incomingMission(): HandOff | null {
  try {
    const raw = localStorage.getItem(KEY)
    const item = raw === null ? null : (JSON.parse(raw) as Partial<HandOff> | null)
    if (typeof item?.fileName !== 'string' || typeof item.mission !== 'object' || item.mission === null) return null
    return { fileName: item.fileName, mission: item.mission }
  } catch {
    return null
  }
}

export function clearHandOff(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing was kept, so there is nothing to clear.
  }
}
