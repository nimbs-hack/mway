import type { Site } from '../api'
import { distance } from '../data/geo'

// Straight-line distance over the Mars sphere from each site to the one
// before it in the list, in meters, with the same formula the map's ruler
// and route panel use. The first site, and any site without a valid
// position or with none before it, gets null.
export function siteLegs(sites: Site[]): Array<number | null> {
  const valid = (site: Site | undefined): site is Site => site !== undefined && !Number.isNaN(site.lat + site.lon)
  return sites.map((site, i) => {
    const before = sites[i - 1]
    return valid(site) && valid(before) ? distance([before.lat, before.lon], [site.lat, site.lon]) : null
  })
}

export const totalLegs = (legs: Array<number | null>): number => legs.reduce<number>((sum, leg) => sum + (leg ?? 0), 0)
