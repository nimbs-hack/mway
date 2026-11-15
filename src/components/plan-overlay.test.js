import { expect, test } from 'bun:test'
import { Cartesian3, Ellipsoid, Event } from 'cesium'
import { addPlanOverlay } from './plan-overlay'

const colors = { text: '#fff', bg: '#111', surface: '#222', dim: '#aaa', hazard: '#f00', accent: '#f0f', ok: '#0f0' }

function withOverlay(check) {
  const previous = ['document', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  const canvases = []
  const context = () => ({
    path: [], strokes: [], dash: [],
    setTransform() {}, save() {}, restore() {}, fillRect() {}, strokeRect() {}, fillText() {},
    clearRect() { this.strokes = [] },
    beginPath() { this.path = [] },
    moveTo(x, y) { this.path.push(['move', x, y]) },
    lineTo(x, y) { this.path.push(['line', x, y]) },
    setLineDash(dash) { this.dash = [...dash] },
    stroke() { this.strokes.push({ color: this.strokeStyle, dash: [...this.dash], path: [...this.path] }) },
    drawImage(canvas) { this.strokes.push(...canvas.context.strokes) },
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement() {
      const canvas = { width: 0, height: 0, context: context(), removed: false, setAttribute() {}, getContext() { return this.context }, remove() { this.removed = true } }
      canvases.push(canvas)
      return canvas
    },
  } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 2 } })
  const ellipsoid = new Ellipsoid(3396190, 3396190, 3396190)
  const camera = {
    positionWC: Cartesian3.fromDegrees(0, 0, 100000, ellipsoid),
    directionWC: new Cartesian3(-1, 0, 0), frustum: { near: 1 },
  }
  const scene = {
    camera, ellipsoid, verticalExaggeration: 1, postRender: new Event(),
    canvas: { clientWidth: 1000, clientHeight: 800 },
    globe: { tileLoadProgressEvent: new Event(), getHeight: () => 8201 * scene.verticalExaggeration },
    requestRender() {},
    cartesianToCanvasCoordinates(position, result) {
      const location = ellipsoid.cartesianToCartographic(position)
      result.x = 500 + location.longitude * 10000
      result.y = 400 - location.latitude * 10000 + location.height / 1000
      return result
    },
  }
  const overlay = addPlanOverlay({ scene, camera, container: { appendChild() {} } }, colors)
  const draw = () => {
    scene.postRender.raiseEvent()
    return canvases[0].context.strokes
  }
  try {
    check({ overlay, scene, draw, canvases })
  } finally {
    overlay.destroy()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
  expect(scene.postRender.numberOfListeners).toBe(0)
  expect(scene.globe.tileLoadProgressEvent.numberOfListeners).toBe(0)
  expect(canvases[0].removed).toBe(true)
}

const paths = [
  [[0, -0.1], [0.1, 0], [0, 0.1]],
  [[0, -0.1], [-0.1, 0], [0, 0.1]],
  [[0, -0.1], [0.05, -0.03], [-0.05, 0.03], [0, 0.1]],
]

test('switching routes keeps every bend while assessment loads and leaves alternatives visible', () => {
  withOverlay(({ overlay, draw }) => {
    const vertices = [
      { point: paths[0][0], kind: 'start', label: 'A' },
      { point: paths[0].at(-1), kind: 'target', label: 'B' },
    ]
    for (let i = 0; i < 12; i++) {
      const selected = i % paths.length
      overlay.setAlternatives(paths.flatMap((points, index) => index === selected ? [] : [{ id: String(index), points, color: `candidate-${index}`, focus: false }]))
      const route = paths[selected].map((point) => ({ point, level: 'unknown' }))
      overlay.set(vertices, route, true)
      const pending = draw()
      const line = pending.find((stroke) => stroke.color === colors.accent)
      expect(line.path).toHaveLength(route.length)
      expect(line.path.map(([command]) => command)).toEqual(['move', ...route.slice(1).map(() => 'line')])
      expect(line.dash).toEqual([6, 5])
      expect(pending.filter((stroke) => stroke.color.startsWith('candidate-') && stroke.path.length)).toHaveLength(2)
      overlay.set(vertices, route)
      const assessed = draw().find((stroke) => stroke.color === colors.accent)
      expect(assessed.path).toEqual(line.path)
      expect(assessed.dash).toEqual([])
    }
  })
})

test('a Review route draws without handles and follows elevation scale changes', () => {
  withOverlay(({ overlay, scene, draw, canvases }) => {
    const route = paths[2].map((point) => ({ point, level: 'unknown' }))
    overlay.set([], route)
    const line = draw().find((stroke) => stroke.color === colors.accent)
    expect(line.path).toHaveLength(route.length)
    expect(line.dash).toEqual([])
    expect([canvases[0].width, canvases[0].height]).toEqual([2000, 1600])
    scene.verticalExaggeration = 3
    const raised = draw().find((stroke) => stroke.color === colors.accent)
    expect(raised.path).toHaveLength(route.length)
    for (let i = 0; i < route.length; i++) expect(raised.path[i][2] - line.path[i][2]).toBeCloseTo(16.402)
    overlay.set([], route, true)
    expect(draw().find((stroke) => stroke.color === colors.accent).dash).toEqual([6, 5])
  })
})
