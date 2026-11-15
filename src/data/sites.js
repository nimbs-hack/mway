import curiosityTraverse from './traverses/curiosity.json'
import perseveranceTraverse from './traverses/perseverance.json'

// NASA landing sites. Coordinates are planetocentric latitude and east
// longitude in the -180..180 range the tiles use. `ended` is the year contact
// was lost, or null while the mission is running. Traverses come from the
// public rover location feeds on mars.nasa.gov.
export const SITES = [
  { id: 'perseverance', name: 'Perseverance', lat: 18.4446, lon: 77.4509, landed: 2021, ended: null, traverse: perseveranceTraverse },
  { id: 'curiosity', name: 'Curiosity', lat: -4.5895, lon: 137.4417, landed: 2012, ended: null, traverse: curiosityTraverse },
  { id: 'insight', name: 'InSight', lat: 4.5024, lon: 135.6234, landed: 2018, ended: 2022 },
  { id: 'phoenix', name: 'Phoenix', lat: 68.2188, lon: -125.7492, landed: 2008, ended: 2008 },
  { id: 'opportunity', name: 'Opportunity', lat: -1.9462, lon: -5.5266, landed: 2004, ended: 2018 },
  { id: 'spirit', name: 'Spirit', lat: -14.5684, lon: 175.4726, landed: 2004, ended: 2010 },
  { id: 'pathfinder', name: 'Pathfinder', lat: 19.13, lon: -33.22, landed: 1997, ended: 1997 },
  { id: 'viking2', name: 'Viking 2', lat: 47.64, lon: 134.29, landed: 1976, ended: 1980 },
  { id: 'viking1', name: 'Viking 1', lat: 22.27, lon: -47.95, landed: 1976, ended: 1982 },
]
