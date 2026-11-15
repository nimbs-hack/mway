export type ScienceCategory = 'optical' | 'thermal' | 'spectral' | 'topographic' | 'geophysical' | 'atmospheric' | 'radiation' | 'chemical' | 'geologic'

// Layers are grouped by the question an astronaut asks, not by instrument.
export type ScienceGroup = 'footing' | 'science' | 'environment'

export type ScienceMetadata = {
  id: string
  category: ScienceCategory
  group: ScienceGroup
  // Readout label, uppercase on screen. Keep it under 12 characters.
  short: string
  name: string
  description: string
  source: string
  sourceUrl: string
  credit: string
  resolution: string
  coverage: string
  epoch: string
  limitation: string
  // `categorical` maps color units, not amounts, so they get no ramp.
  legend: { low: string; high: string; colors: string[]; categorical?: boolean }
}

export type ScienceRaster = ScienceMetadata & {
  kind: 'raster'
  // False when pixel colors can't stand for a legend position.
  sampled: boolean
  url: string
  maxLevel: number
  tileSize: number
}

export type ScienceObservation = ScienceMetadata & {
  kind: 'observation'
  siteIds: string[]
  measurements: { label: string; value: number; unit: string }[]
}

export type ScienceLayer = ScienceRaster | ScienceObservation | (ScienceMetadata & { kind: 'base' })
export type ScienceStatus = 'idle' | 'loading' | 'ready' | 'error'
