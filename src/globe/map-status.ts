type MapSource = 'Viking imagery' | 'CTX imagery' | 'Terrain' | '3D viewer'

type MapStatus = {
  loadingTiles: boolean
  terrainReady: boolean
  failures: MapSource[]
}

type MapStatusEvent =
  | { type: 'reset' }
  | { type: 'progress'; queued: number }
  | { type: 'terrain-ready' }
  | { type: 'failure'; source: MapSource }

export const INITIAL_MAP_STATUS: MapStatus = { loadingTiles: true, terrainReady: false, failures: [] }

// An empty tile queue does not prove terrain loaded or repair an earlier failure.
// Keep failures visible until the user starts a fresh loading attempt.
export function mapStatusReducer(state: MapStatus, event: MapStatusEvent): MapStatus {
  switch (event.type) {
    case 'reset': return INITIAL_MAP_STATUS
    case 'progress': {
      const loadingTiles = event.queued > 0
      return state.loadingTiles === loadingTiles ? state : { ...state, loadingTiles }
    }
    case 'terrain-ready': return { ...state, terrainReady: true }
    case 'failure': return state.failures.includes(event.source)
      ? state
      : { ...state, failures: [...state.failures, event.source] }
  }
}

// The status bar's tile state. A failure stays shown over later loading,
// until a retry resets it.
export function mapStatusState(status: MapStatus): 'loading' | 'error' | 'ready' {
  if (status.failures.length) return 'error'
  if (!status.terrainReady || status.loadingTiles) return 'loading'
  return 'ready'
}
