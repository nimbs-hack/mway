import rasters from './science-rasters.json'
import { OBSERVATIONS } from './science-observations'
import type { ScienceCategory, ScienceGroup, ScienceLayer, ScienceRaster } from './science-types'

// Footing: can I walk here. Science: what is here. Environment: what will it
// do to me. Night infrared goes under footing because surfaces that stay warm
// at night tend to be rock and cold ones loose fines.
// sampled: false keeps a layer out of the profile lanes and point readout.
// MOLA color relief is hillshaded, so sunlit slopes turn white and read as
// the top of the legend. Measured terrain elevation covers it instead.
const RASTER_ROLES: Record<string, { group: ScienceGroup; short: string; sampled: boolean }> = {
  'mola-color': { group: 'footing', short: 'Relief', sampled: false },
  'mola-roughness': { group: 'footing', short: 'Roughness', sampled: true },
  'themis-night': { group: 'footing', short: 'Night IR', sampled: true },
  'themis-day': { group: 'science', short: 'Day IR', sampled: true },
  'tes-albedo': { group: 'science', short: 'Albedo', sampled: true },
  // Categorical colors cannot be sampled as values on a numeric ramp.
  geology: { group: 'science', short: 'Geology', sampled: false },
}

const OBSERVATION_SHORT: Record<string, string> = {
  thermal: 'Temp',
  radiation: 'Dose',
  atmospheric: 'Pressure',
  chemical: 'Methane',
  geophysical: 'Quake',
}

const categories: ScienceCategory[] = ['optical', 'thermal', 'spectral', 'topographic', 'geophysical', 'atmospheric', 'radiation', 'chemical', 'geologic']

function rasterLayer(source: typeof rasters[number]): ScienceRaster {
  const category = categories.find((category) => category === source.category)
  if (!category) throw new Error(`Unknown science category: ${source.category}`)
  const role = RASTER_ROLES[source.id]
  if (!role) throw new Error(`Science raster has no group: ${source.id}`)
  return { ...source, ...role, category, kind: 'raster' }
}

export const SCIENCE_LAYERS: ScienceLayer[] = [
  {
    id: 'optical',
    category: 'optical',
    group: 'science',
    short: 'Imagery',
    kind: 'base',
    name: 'Surface imagery',
    description: 'CTX detail over the Viking global color mosaic, with 3D terrain.',
    source: 'MRO / CTX · Viking',
    sourceUrl: 'https://murray-lab.caltech.edu/CTX/',
    credit: 'NASA / JPL / USGS / MSSS / The Murray Lab / Esri',
    resolution: 'CTX about 5 m/pixel; Viking 232 m/pixel',
    coverage: 'CTX between 88°S and 88°N; Viking global',
    epoch: 'Multi-date orbital mosaic',
    limitation: 'Brightness varies between images. Image detail does not establish safe footing. Terrain resolution varies by location.',
    legend: { low: 'Darker surface', high: 'Brighter surface', colors: ['#171717', '#eeeeee'] },
  },
  ...rasters.map(rasterLayer),
  ...OBSERVATIONS.map((source) => ({
    ...source,
    group: 'environment' as const,
    short: OBSERVATION_SHORT[source.category] ?? source.category,
    kind: 'observation' as const,
  })),
]

export const SCIENCE_RASTERS = SCIENCE_LAYERS.filter((layer): layer is ScienceRaster => layer.kind === 'raster')
export const SAMPLED_RASTERS = SCIENCE_RASTERS.filter((layer) => layer.sampled)
