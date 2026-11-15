import { expect, test } from 'bun:test'
import { createCrewSimulation } from './crew-simulation'
import { distance, offset, type LatLon } from './geo'

const anchor: LatLon = [-4.6, 137.4]
const crew = [{ name: 'STIVEN' }, { name: 'RAY' }, { name: 'VEGA' }, { name: 'SOL' }, { name: '' }]

test('all crew appear, with most at the start and two slightly off the route', () => {
  const path: LatLon[] = [anchor, offset(anchor, 1000, 0)]
  const tracks = createCrewSimulation(crew, path, anchor)
  expect(tracks.map((track) => track.name)).toEqual(['STIVEN', 'RAY', 'VEGA', 'SOL', 'Crew member 5'])
  expect(new Set(tracks.map((track) => track.id)).size).toBe(crew.length)
  for (const seconds of [0, 10, 1000]) {
    for (const track of tracks.slice(2)) expect(distance(anchor, track.positionAt(seconds))).toBeLessThan(30)
    for (const [index, track] of tracks.slice(0, 2).entries()) {
      const position = track.positionAt(seconds)
      expect(distance(anchor, position)).toBeGreaterThan(250)
      expect(distance(anchor, position)).toBeLessThan(600)
      const onLine: LatLon = [position[0], anchor[1]]
      expect(distance(onLine, position)).toBeCloseTo(12 + index * 6, 2)
      expect(distance(position, track.positionAt(seconds + 0.1))).toBeLessThan(0.15)
    }
  }
})

test('small crews keep someone at the start, and an empty crew adds nobody', () => {
  const path: LatLon[] = [anchor, offset(anchor, 1000, 0)]
  for (const size of [1, 2, 3]) {
    const tracks = createCrewSimulation(crew.slice(0, size), path, anchor)
    const atStart = tracks.filter((track) => distance(anchor, track.positionAt(0)) < 30)
    expect(atStart.length).toBe(size - Math.floor(size / 2))
  }
  expect(createCrewSimulation([], path, anchor)).toEqual([])
})

test('a missing or collapsed route keeps moving crew near the site', () => {
  for (const route of [null, [], [anchor], [anchor, anchor]]) {
    const tracks = createCrewSimulation(crew, route, anchor)
    for (const track of tracks) {
      expect(distance(anchor, track.positionAt(0))).toBeLessThan(30)
      expect(distance(track.positionAt(0), track.positionAt(1))).toBeGreaterThan(0.1)
    }
  }
})

test('route bends keep scouts near their route leg', () => {
  const bend = offset(anchor, 0, 100)
  const path: LatLon[] = [anchor, bend, offset(bend, 100, 0)]
  const tracks = createCrewSimulation(crew, path, anchor)
  const first = tracks[0].positionAt(0)
  expect(distance([anchor[0], first[1]], first)).toBeCloseTo(12, 1)
  const second = tracks[1].positionAt(0)
  expect(distance(bend, second)).toBeLessThan(30)
  expect(distance(second, tracks[1].positionAt(0.1))).toBeLessThan(0.3)
})

test('polar anchors and routes across the date line keep valid coordinates', () => {
  for (const point of [anchor, [90, 180], [-90, -180]] satisfies LatLon[]) {
    for (const track of createCrewSimulation(crew, [point, point], point)) {
      for (const seconds of [0, 10, 10000, NaN]) {
        const [lat, lon] = track.positionAt(seconds)
        expect(Number.isFinite(lat + lon)).toBe(true)
        expect(Math.abs(lat)).toBeLessThanOrEqual(90)
        expect(Math.abs(lon)).toBeLessThanOrEqual(180)
      }
    }
  }
  const track = createCrewSimulation(crew, [[0, 179.99], [0, -179.99]], anchor)[0]
  expect(Math.abs(track.positionAt(0)[1])).toBeGreaterThan(179.98)
  expect(distance(track.positionAt(0), track.positionAt(0.1))).toBeLessThan(0.15)
})
