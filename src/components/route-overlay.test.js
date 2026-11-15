import { expect, test } from 'bun:test'
import { Cartesian3, Ellipsoid, Event } from 'cesium'
import { addRouteOverlay } from './route-overlay'

test('routes follow refined and exaggerated Mars terrain, stay visible on zoom, and hide beyond the horizon', () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const drawn = []
  let removed = false
  const context = {
    setTransform() {}, clearRect() { drawn.length = 0 }, beginPath() {}, stroke() {},
    moveTo(x, y) { drawn.push(['move', x, y]) },
    lineTo(x, y) { drawn.push(['line', x, y]) },
  }
  const canvas = { width: 0, height: 0, setAttribute() {}, getContext: () => context, remove() { removed = true } }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 2 } })
  let stop
  // Heights refresh at most once a second, so the test moves the clock itself.
  const realNow = performance.now
  let clock = 0
  performance.now = () => clock
  try {
    const ellipsoid = new Ellipsoid(3396190, 3396190, 3396190)
    const postRender = new Event()
    const progress = new Event()
    const moveEnd = new Event()
    let height = 5500
    const camera = { positionWC: Cartesian3.fromDegrees(0, 0, 100000, ellipsoid), positionCartographic: { height: 100000 }, moveEnd }
    const scene = {
      ellipsoid, postRender, verticalExaggeration: 1,
      // The fake projection below puts a point's height on y, and only
      // points inside the canvas get their height refreshed.
      canvas: { clientWidth: 800, clientHeight: 9000 },
      globe: { tileLoadProgressEvent: progress, getHeight: () => height },
      requestRender() {},
      cartesianToCanvasCoordinates(position, result) {
        const location = ellipsoid.cartesianToCartographic(position)
        result.x = location.longitude
        result.y = location.height
        return result
      },
    }
    stop = addRouteOverlay({ scene, camera, container: { appendChild() {} } }, [
      [[0, 0], [0, 0.1]], [[0, 180], [0, 179.9]],
    ], '#fff8f3', '#050709')
    postRender.raiseEvent()
    expect(drawn.map(([command]) => command)).toEqual(['move', 'line'])
    expect(drawn[1][2]).toBeCloseTo(5500)
    expect([canvas.width, canvas.height]).toEqual([1600, 18000])
    camera.positionWC = Cartesian3.fromDegrees(0, 0, 9000, ellipsoid)
    height = 6000
    progress.raiseEvent(0)
    clock += 2000
    postRender.raiseEvent()
    expect(drawn).toHaveLength(2)
    expect(drawn[1][2]).toBeCloseTo(6000)
    scene.verticalExaggeration = 3
    height = 7000
    postRender.raiseEvent()
    expect(drawn[1][2]).toBeCloseTo(7000)
    stop()
    expect(postRender.numberOfListeners).toBe(0)
    expect(progress.numberOfListeners).toBe(0)
    expect(moveEnd.numberOfListeners).toBe(0)
    expect(removed).toBe(true)
  } finally {
    stop?.()
    performance.now = realNow
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else delete globalThis.document
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
  }
})
