import type { ScienceObservation } from './science-types'

type HistoricalObservation = Omit<ScienceObservation, 'kind' | 'category' | 'group' | 'short'> & {
  category: 'thermal' | 'radiation' | 'atmospheric' | 'chemical' | 'geophysical'
}

// Site IDs associate records with missions, not exact sample or quake locations.
// Empty legend colors are intentional: these records have no spatial color scale.
export const OBSERVATIONS: HistoricalObservation[] = [
  {
    id: 'perseverance-meda-sols-43-44',
    category: 'thermal',
    name: 'Jezero temperature range',
    description: 'Perseverance MEDA reported the high and low across sols 43 and 44.',
    source: 'NASA / JPL / Perseverance MEDA',
    sourceUrl: 'https://www.jpl.nasa.gov/news/nasas-first-weather-report-from-jezero-crater-on-mars/',
    credit: 'NASA / JPL-Caltech / CAB / MEDA team',
    resolution: 'Reported extremes across two sols',
    coverage: 'Perseverance in Jezero crater',
    epoch: 'April 3 to 4, 2021; sols 43 to 44',
    limitation: 'Historical weather report, not present conditions. The article does not identify the temperature sensor or sampling height. No global temperature field is available.',
    siteIds: ['perseverance'],
    measurements: [
      { label: 'Reported high', value: 251.15, unit: 'K' },
      { label: 'Reported low', value: 190.15, unit: 'K' },
    ],
    legend: { low: 'Historical extremes', high: 'Jezero only', colors: [] },
  },
  {
    id: 'curiosity-rad-2012-2013',
    category: 'radiation',
    name: 'Gale radiation reference',
    description: 'Curiosity RAD measured this historical mean dose equivalent at the surface.',
    source: 'NASA / Curiosity RAD',
    sourceUrl: 'https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/',
    credit: 'NASA / JPL-Caltech / SwRI / RAD team',
    resolution: 'Rover measurements averaged over the reported period',
    coverage: 'Curiosity at Gale crater; no spatial radiation layer available',
    epoch: 'August 2012 to June 2013',
    limitation: 'Historical rover average, not an EVA dose estimate. No coverage away from Curiosity; shielding and solar conditions vary.',
    siteIds: ['curiosity'],
    measurements: [
      { label: 'Mean dose equivalent', value: 0.00067, unit: 'Sv/day' },
    ],
    legend: { low: 'Historical average', high: 'Gale only', colors: [] },
  },
  {
    id: 'perseverance-meda-2021-02-19',
    category: 'atmospheric',
    name: 'Jezero first pressure reading',
    description: 'Perseverance MEDA reported this pressure during its first weather session.',
    source: 'NASA / JPL / Perseverance MEDA',
    sourceUrl: 'https://www.jpl.nasa.gov/news/nasas-first-weather-report-from-jezero-crater-on-mars/',
    credit: 'NASA / JPL-Caltech / CAB / MEDA team',
    resolution: 'One reported reading from the first 30-minute session',
    coverage: 'Perseverance landing area in Jezero crater',
    epoch: 'February 19, 2021, as dated in the mission report',
    limitation: 'Historical local reading. The report gives no sample timestamp or pressure uncertainty; this is not a daily mean or present weather.',
    siteIds: ['perseverance'],
    measurements: [
      { label: 'Surface pressure', value: 718, unit: 'Pa' },
    ],
    legend: { low: 'Historical reading', high: 'Jezero only', colors: [] },
  },
  {
    id: 'curiosity-sam-methane-2019-06-19',
    category: 'chemical',
    name: 'Gale methane detection',
    description: 'Curiosity SAM detected a transient increase in methane in sampled air.',
    source: 'NASA / JPL / Curiosity SAM-TLS',
    sourceUrl: 'https://www.jpl.nasa.gov/news/curiositys-mars-methane-mystery-continues/',
    credit: 'NASA / JPL-Caltech / SAM team; observation date confirmed by ESA',
    resolution: 'One reported atmospheric sample result, rounded by the mission report',
    coverage: 'Air sampled by Curiosity in Gale crater; methane source location unknown',
    epoch: 'June 19, 2019',
    limitation: 'Approximate published concentration. Follow-up fell below 1 ppbv. This does not identify a biological source or map soil chemistry.',
    siteIds: ['curiosity'],
    measurements: [
      { label: 'Methane mole fraction, approximate', value: 21e-9, unit: 'mol/mol' },
    ],
    legend: { low: 'Historical sample', high: 'Gale only', colors: [] },
  },
  {
    id: 'insight-seis-s1222a',
    category: 'geophysical',
    name: 'S1222a ground motion',
    description: 'InSight SEIS recorded ground velocity during the S1222a marsquake.',
    source: 'InSight SEIS team / Kawamura et al., 2023, Table 1',
    sourceUrl: 'https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2022GL101543',
    credit: 'Kawamura et al. / NASA / CNES / IPGP / ETH Zurich / InSight SEIS team',
    resolution: 'Published peak velocity components for one seismic event',
    coverage: 'SEIS station at InSight, Elysium Planitia; not the quake epicenter',
    epoch: 'May 4, 2022; event origin 23:23:07 UTC, uncertainty 4.8 s; sol 1222',
    limitation: 'Peak components at one receiver, not simultaneous vector components or a hazard map. Event origin time is not the arrival time at SEIS.',
    siteIds: ['insight'],
    measurements: [
      { label: 'Peak vertical velocity', value: 1.3e-5, unit: 'm/s' },
      { label: 'Peak north velocity', value: 2.8e-5, unit: 'm/s' },
      { label: 'Peak east velocity', value: 2.8e-5, unit: 'm/s' },
    ],
    legend: { low: 'Historical event', high: 'InSight receiver', colors: [] },
  },
]
