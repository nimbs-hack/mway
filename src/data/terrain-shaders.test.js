import { expect, spyOn, test } from 'bun:test'
import { Pass, ShaderProgram } from 'cesium'
import { deferTerrainShaders } from './terrain-shaders'

function driver(parallel = true) {
  const queries = []
  const deleted = []
  const programs = []
  let complete = false
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, LINK_STATUS: 3,
    ACTIVE_ATTRIBUTES: 4, ACTIVE_UNIFORMS: 5,
    getExtension: () => parallel ? { COMPLETION_STATUS_KHR: 6 } : null,
    createShader: (type) => ({ type }),
    shaderSource() {}, compileShader() {}, attachShader() {}, bindAttribLocation() {}, linkProgram() {},
    createProgram() { const program = {}; programs.push(program); return program },
    getProgramParameter(program, parameter) {
      queries.push(parameter)
      if (parameter === 6) return complete
      if (parameter === gl.LINK_STATUS) {
        if (parallel && !complete) throw new Error('Blocking link-status query')
        return true
      }
      return 0
    },
    deleteShader(shader) { deleted.push(shader) },
    deleteProgram(program) { if (program) deleted.push(program) },
    useProgram() {},
  }
  const shader = new ShaderProgram({
    gl,
    vertexShaderText: 'void main() { gl_Position = vec4(0.0); }',
    fragmentShaderText: 'void main() { gl_FragColor = vec4(1.0); }',
  })
  return { shader, gl, queries, programs, deleted, complete: () => { complete = true } }
}

test('terrain shaders poll without blocking and bind the same program when ready', () => {
  const gpu = driver()
  expect(gpu.shader._isReady()).toBe(false)
  expect(gpu.shader._isReady()).toBe(false)
  expect(gpu.queries).toEqual([6, 6])
  expect(gpu.programs).toHaveLength(1)
  gpu.complete()
  expect(gpu.shader._isReady()).toBe(true)
  gpu.shader._bind()
  expect(gpu.shader._program).toBe(gpu.programs[0])
  expect(gpu.programs).toHaveLength(1)
  const queryCount = gpu.queries.length
  expect(gpu.shader._isReady()).toBe(true)
  expect(gpu.queries).toHaveLength(queryCount)
  gpu.shader.finalDestroy()
  expect(gpu.deleted).toHaveLength(3)
})

test('browsers without parallel compilation retain synchronous linking', () => {
  const gpu = driver(false)
  expect(gpu.shader._isReady()).toBe(true)
  expect(gpu.programs).toHaveLength(0)
  gpu.shader._bind()
  expect(gpu.shader._program).toBe(gpu.programs[0])
  gpu.shader.finalDestroy()
})

test('closing the map releases programs and shaders still compiling', () => {
  const gpu = driver()
  gpu.shader._isReady()
  gpu.shader.finalDestroy()
  expect(gpu.deleted).toHaveLength(3)
  expect(gpu.deleted).toContain(gpu.programs[0])
  expect(gpu.queries).toEqual([6])
})

test('a completed shader that failed to link reports its error and releases resources', () => {
  const gpu = driver()
  const query = gpu.gl.getProgramParameter
  gpu.gl.getProgramParameter = (program, parameter) => parameter === gpu.gl.LINK_STATUS ? false : query(program, parameter)
  gpu.gl.getShaderParameter = () => false
  gpu.gl.getShaderInfoLog = () => 'Invalid terrain shader'
  const log = spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(gpu.shader._isReady()).toBe(false)
    gpu.complete()
    expect(gpu.shader._isReady()).toBe(true)
    expect(() => gpu.shader._bind()).toThrow('Invalid terrain shader')
    expect(gpu.deleted).toHaveLength(3)
    gpu.shader.finalDestroy()
    expect(gpu.deleted).toHaveLength(3)
  } finally {
    log.mockRestore()
  }
})

test('pending terrain requests another frame, resumes drawing, and keeps picking synchronous', () => {
  const gpu = driver()
  const calls = []
  let requested = 0
  const draw = function (...args) { calls.push({ owner: this, args }) }
  const scene = {
    context: { draw },
    frameState: { passes: { render: true } },
    requestRender() { requested++ },
  }
  const stop = deferTerrainShaders(scene)
  const command = { pass: Pass.GLOBE, shaderProgram: gpu.shader }
  scene.context.draw(command)
  expect(requested).toBe(1)
  expect(calls).toHaveLength(0)
  scene.frameState.passes.render = false
  scene.context.draw(command)
  expect(calls).toHaveLength(1)
  scene.frameState.passes.render = true
  scene.context.draw({ ...command, pass: Pass.OPAQUE })
  expect(calls).toHaveLength(2)
  gpu.complete()
  scene.context.draw(command)
  expect(calls).toHaveLength(3)
  expect(calls[2].owner).toBe(scene.context)
  stop()
  expect(scene.context.draw).toBe(draw)
  gpu.shader.finalDestroy()
})
