import { useCallback, useEffect, useRef, useState } from 'react'
import { BoundingSphere, Cartesian2, Cartesian3, Cartographic, EllipsoidalOccluder, HeadingPitchRange, type Viewer } from 'cesium'
import type { LatLon } from '../data/geo'
import { DATUM_OFFSET } from '../data/terrain.js'
import { symbolImage } from '../data/markers'
import { clusterAnchors, placeMapLabels, type LabelAnchor, type Offset, type Rect } from './map-label-layout'
import './map-labels.css'
import CrewReadout from './CrewReadout'
import { crewPin, crewPortrait, drawLeader, leader, linkHover } from './map-label-dom'

export type MapLabel = {
  id: string
  point: LatLon
  text: string
  kind?: 'crew'
  portrait?: string
  positionAt?: (seconds: number) => LatLon
  symbol?: string
  selected?: boolean
  onSelect?: (screen: { x: number; y: number }) => void
  onContext?: (screen: { x: number; y: number }) => void
}

// Points closer than this on the ground cannot be split by zooming, so a
// click on their cluster lists them instead.
const COLOCATED_METERS = 30
const SVG = 'http://www.w3.org/2000/svg'

function countText(rows: { item: MapLabel }[]) {
  const crew = rows.filter((row) => row.item.kind === 'crew').length
  const symbols = rows.filter((row) => row.item.symbol).length
  const sites = rows.length - symbols - crew
  return [crew && `${crew} crew`, sites && `${sites} ${sites === 1 ? 'site' : 'sites'}`, symbols && `${symbols} ${symbols === 1 ? 'symbol' : 'symbols'}`]
    .filter(Boolean).join(' · ')
}

// Both maps use the same projected labels. Cesium keeps the ground pins;
// HTML rows make the names readable, clickable and keyboard accessible.
export default function MapLabels({ viewer, items }: { viewer: Viewer | null; items: MapLabel[] }) {
  const root = useRef<HTMLDivElement>(null)
  const [crew, setCrew] = useState<{ item: MapLabel; trigger: HTMLButtonElement } | null>(null)
  const closeCrew = useCallback(() => setCrew(null), [])
  useEffect(() => {
    const element = root.current
    if (!element || !viewer || viewer.isDestroyed()) return
    const stage = element.parentElement!
    const svg = document.createElementNS(SVG, 'svg') as SVGSVGElement
    svg.setAttribute('aria-hidden', 'true')
    element.appendChild(svg)
    const tokens = getComputedStyle(document.documentElement)
    const text = tokens.getPropertyValue('--color-text').trim()
    const background = tokens.getPropertyValue('--color-bg').trim()
    const rows = items.map((item) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `map-label${item.selected ? ' is-selected' : ''}`
      button.title = item.text
      button.setAttribute('aria-label', item.text)
      if (item.selected !== undefined) button.setAttribute('aria-pressed', String(item.selected))
      if (item.kind === 'crew') {
        button.setAttribute('aria-haspopup', 'dialog')
        button.setAttribute('aria-expanded', 'false')
        button.appendChild(crewPortrait(item.text, item.portrait))
      }
      if (item.symbol) {
        const icon = document.createElement('img')
        icon.src = symbolImage(item.symbol, text, background)
        icon.alt = ''
        button.appendChild(icon)
      }
      const name = document.createElement('span')
      name.textContent = item.text
      button.appendChild(name)
      element.appendChild(button)
      const line = leader(svg)
      // A person is a diamond, so they are never taken for a site or a route
      // point, which are round.
      const pin = item.kind === 'crew' ? crewPin(svg) : null
      linkHover(button, line, svg)
      const location = Cartographic.fromDegrees(item.point[1], item.point[0], DATUM_OFFSET)
      const row = { item, button, line, pin, location, terrainHeight: DATUM_OFFSET, width: Math.min(320, button.scrollWidth + 8), position: new Cartesian3(), screen: { x: 0, y: 0 } }
      button.onclick = () => {
        if (item.kind === 'crew') setCrew({ item, trigger: button })
        else item.onSelect?.(row.screen)
      }
      button.oncontextmenu = (event) => {
        if (!item.onContext) return
        event.preventDefault()
        item.onContext(row.screen)
      }
      return row
    })
    const byId = new Map(rows.map((row) => [row.item.id, row]))

    // Cluster rows are made on demand and kept by their member list, so a
    // cluster that survives a camera move keeps its element and focus.
    type Cluster = { button: HTMLButtonElement; line: ReturnType<typeof leader>; ring: SVGCircleElement }
    const clusters = new Map<string, Cluster>()
    const expanded = new Set<string>()
    // Last frame's result, so labels and clusters hold still between frames.
    let offsets = new Map<string, Offset>()
    let memberOf = new Map<string, string>()
    const openCluster = (members: string[]) => {
      const points = members.map((id) => byId.get(id)!.position)
      const sphere = BoundingSphere.fromPoints(points)
      if (sphere.radius < COLOCATED_METERS) {
        for (const id of members) expanded.add(id)
        viewer.scene.requestRender()
        return
      }
      viewer.camera.flyToBoundingSphere(sphere, {
        offset: new HeadingPitchRange(viewer.camera.heading, viewer.camera.pitch, Math.max(sphere.radius * 3, 600)),
      })
    }
    const cluster = (anchor: LabelAnchor): Cluster => {
      const existing = clusters.get(anchor.id)
      if (existing) return existing
      const members = anchor.members!.map((id) => byId.get(id)!)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'map-label map-label--cluster'
      const summary = countText(members)
      button.title = `${summary}. Click to zoom in.\n${members.map((row) => row.item.text).join('\n')}`
      button.setAttribute('aria-label', `Zoom to ${summary}`)
      const count = document.createElement('span')
      count.textContent = summary
      const plus = document.createElement('b')
      plus.textContent = '+'
      button.append(count, plus)
      element.appendChild(button)
      const line = leader(svg)
      const ring = document.createElementNS(SVG, 'circle') as SVGCircleElement
      ring.setAttribute('class', 'map-label__ring')
      line.group.prepend(ring)
      linkHover(button, line, svg)
      button.onclick = () => openCluster(anchor.members!)
      const made = { button, line, ring }
      clusters.set(anchor.id, made)
      return made
    }
    // Width only depends on the summary text, so measure each summary once.
    const widths = new Map<string, number>()
    const clusterWidth = (group: LabelAnchor[]) => {
      const summary = countText(group.map((a) => byId.get(a.id)!))
      let width = widths.get(summary)
      if (width === undefined) {
        const probe = document.createElement('button')
        probe.className = 'map-label map-label--cluster'
        const label = document.createElement('span')
        label.textContent = summary
        const plus = document.createElement('b')
        plus.textContent = '+'
        probe.append(label, plus)
        element.appendChild(probe)
        width = Math.min(320, probe.scrollWidth + 8)
        probe.remove()
        widths.set(summary, width)
      }
      return width
    }

    const occluder = new EllipsoidalOccluder(viewer.scene.ellipsoid, viewer.camera.positionWC)
    const projected = new Cartesian2()
    let heightsDirty = true
    let lastHeights = -Infinity
    let exaggeration = viewer.scene.verticalExaggeration
    const dirty = () => { heightsDirty = true; viewer.scene.requestRender() }
    const removeTiles = viewer.scene.globe.tileLoadProgressEvent.addEventListener(dirty)
    const removeMove = viewer.camera.moveEnd.addEventListener(dirty)
    // A listed spot folds back into its cluster on the next camera move.
    const removeMoveStart = viewer.camera.moveStart.addEventListener(() => expanded.clear())
    const resize = new ResizeObserver(dirty)
    resize.observe(stage)
    const draw = () => {
      const now = performance.now()
      const width = stage.clientWidth
      const height = stage.clientHeight
      if (!width || !height) return
      const stageBox = stage.getBoundingClientRect()
      const obstacles: Rect[] = []
      for (const node of stage.querySelectorAll('.nav, .routes, .profile, .readout, .switcher, .pointmenu, .tools, .crew-readout')) {
        const box = node.getBoundingClientRect()
        if (box.width && box.height) obstacles.push({ x: box.left - stageBox.left, y: box.top - stageBox.top, width: box.width, height: box.height })
      }
      occluder.cameraPosition = viewer.camera.positionWC
      const refresh = heightsDirty || now - lastHeights > 1000 || exaggeration !== viewer.scene.verticalExaggeration
      exaggeration = viewer.scene.verticalExaggeration
      if (refresh) { lastHeights = now; heightsDirty = false }
      const anchors: LabelAnchor[] = []
      for (const row of rows) {
        row.pin?.setAttribute('display', 'none')
        if (row.item.positionAt) {
          const [lat, lon] = row.item.positionAt(now / 1000)
          row.location.latitude = lat * Math.PI / 180
          row.location.longitude = lon * Math.PI / 180
        }
        // getHeight already includes the scene's elevation exaggeration,
        // and the datum is the exaggeration's fixed point.
        if (refresh || row.item.positionAt) row.terrainHeight = viewer.scene.globe.getHeight(row.location) ?? DATUM_OFFSET
        row.location.height = row.terrainHeight
        viewer.scene.ellipsoid.cartographicToCartesian(row.location, row.position)
        const at = occluder.isPointVisible(row.position) && viewer.scene.cartesianToCanvasCoordinates(row.position, projected)
        if (!at || at.x < 0 || at.y < 0 || at.x > width || at.y > height) continue
        row.screen = { x: at.x, y: at.y }
        if (row.pin) {
          row.pin.setAttribute('transform', `translate(${at.x} ${at.y})`)
          row.pin.removeAttribute('display')
        }
        anchors.push({ id: row.item.id, x: at.x, y: at.y, width: row.width, selected: row.item.selected })
      }
      // Crew keep their pictures and names when they gather at the start.
      const unclustered = new Set([...expanded, ...rows.filter((row) => row.item.kind === 'crew').map((row) => row.item.id)])
      const grouped = clusterAnchors(anchors, clusterWidth, unclustered, memberOf)
      const placed = placeMapLabels(grouped, width, height, obstacles, offsets)
      offsets = new Map(placed.map((label) => [label.id, label.offset]))
      memberOf = new Map(grouped.flatMap((a) => (a.members ?? []).map((id) => [id, a.id] as const)))
      const positions = new Map(placed.map((label) => [label.id, label]))
      for (const row of rows) {
        const label = positions.get(row.item.id)
        row.button.hidden = !label
        if (label) drawLeader(row.line, label)
        else row.line.group.setAttribute('display', 'none')
      }
      const live = new Set<string>()
      for (const label of placed) {
        if (!label.members) continue
        live.add(label.id)
        const made = cluster(label)
        made.button.hidden = false
        made.button.style.transform = `translate(${label.box.x}px, ${label.box.y}px)`
        made.button.style.width = `${label.box.width}px`
        made.ring.setAttribute('cx', String(label.x))
        made.ring.setAttribute('cy', String(label.y))
        made.ring.setAttribute('r', String(label.radius ?? 0))
        drawLeader(made.line, label)
      }
      for (const [id, made] of clusters) {
        if (live.has(id)) continue
        made.button.remove()
        made.line.group.remove()
        clusters.delete(id)
      }
      for (const label of placed) {
        if (label.members) continue
        const row = byId.get(label.id)!
        row.button.style.transform = `translate(${label.box.x}px, ${label.box.y}px)`
        row.button.style.width = `${label.box.width}px`
      }
    }
    const removeRender = viewer.scene.postRender.addEventListener(draw)
    // Update ground positions without rebuilding rows or losing keyboard focus.
    // The crew walk about a metre a second, so once a second is enough: each
    // update redraws the whole globe, which costs integrated graphics.
    const timer = items.some((item) => item.positionAt) ? window.setInterval(() => {
      if (!document.hidden) viewer.scene.requestRender()
    }, 1000) : undefined
    viewer.scene.requestRender()
    return () => {
      window.clearInterval(timer)
      resize.disconnect()
      removeTiles()
      removeMove()
      removeMoveStart()
      removeRender()
      setCrew(null)
      element.replaceChildren()
    }
  }, [viewer, items])
  return <>
    <div className="map-labels" ref={root} aria-label="Map locations" />
    {crew && viewer && <CrewReadout key={crew.item.id} name={crew.item.text} trigger={crew.trigger} viewer={viewer} onClose={closeCrew} />}
  </>
}
