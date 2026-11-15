import { FRAGMENT, VERTEX } from './shader'

// Draws the generated ground and the helmet around it. One full-screen
// triangle: the fragment shader does the rest.

export type View = {
  // Degrees. Yaw is the heading, clockwise from north. Pitch is up.
  yaw: number
  pitch: number
  roll: number
  // Eye, meters: east and north of the footing, and height above the ground.
  eye: [east: number, up: number, north: number]
  // Middle of the helmet opening, in half screen heights from the middle of the view.
  helmet: [x: number, y: number]
  // 0 to 1, breath on the visor.
  breath: number
  // Seconds.
  time: number
}

// Half the vertical field of view is 31°. With the lens bulge this shows
// about 104° across a 16:9 frame, close to what a helmet camera sees.
export const TAN_HALF = Math.tan((31 * Math.PI) / 180)
const BARREL = 0.06
// Sun at azimuth 285°, 24° up: a late afternoon with long shadows.
const SUN_AZIMUTH = 285
const SUN_ELEVATION = 24

const rad = Math.PI / 180

// Right, up and forward of a camera, as the columns of a matrix. x east,
// y up, z north.
export function cameraBasis(yaw: number, pitch: number, roll: number): number[] {
  const [sy, cy] = [Math.sin(yaw * rad), Math.cos(yaw * rad)]
  const [sp, cp] = [Math.sin(pitch * rad), Math.cos(pitch * rad)]
  const forward = [sy * cp, sp, cy * cp]
  const right = [cy, 0, -sy]
  const up = [-sy * sp, cp, -cy * sp]
  const [sr, cr] = [Math.sin(roll * rad), Math.cos(roll * rad)]
  return [
    ...right.map((value, i) => value * cr + up[i] * sr),
    ...up.map((value, i) => value * cr - right[i] * sr),
    ...forward,
  ]
}

export type Scene = {
  render: (view: View) => void
  // Backing size in pixels.
  resize: (width: number, height: number) => void
  dispose: () => void
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader did not compile: ${log}`)
  }
  return shader
}

// Null when the browser has no WebGL 2 or the shader does not build there.
export function createScene(canvas: HTMLCanvasElement): Scene | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
  if (!gl) return null
  let program: WebGLProgram
  try {
    program = gl.createProgram()!
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Shader did not link: ${gl.getProgramInfoLog(program)}`)
  } catch (error) {
    console.error(error)
    return null
  }
  gl.useProgram(program)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const at = (name: string) => gl.getUniformLocation(program, name)
  const uniforms = {
    res: at('uRes'), time: at('uTime'), eye: at('uEye'), cam: at('uCam'), tanHalf: at('uTanHalf'),
    barrel: at('uBarrel'), sun: at('uSun'), helmet: at('uHelmet'), breath: at('uBreath'),
  }
  gl.uniform1f(uniforms.tanHalf, TAN_HALF)
  gl.uniform1f(uniforms.barrel, BARREL)
  gl.uniform3f(
    uniforms.sun,
    Math.sin(SUN_AZIMUTH * rad) * Math.cos(SUN_ELEVATION * rad),
    Math.sin(SUN_ELEVATION * rad),
    Math.cos(SUN_AZIMUTH * rad) * Math.cos(SUN_ELEVATION * rad),
  )

  return {
    render(view) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uniforms.res, canvas.width, canvas.height)
      gl.uniform1f(uniforms.time, view.time)
      gl.uniform3f(uniforms.eye, ...view.eye)
      gl.uniformMatrix3fv(uniforms.cam, false, cameraBasis(view.yaw, view.pitch, view.roll))
      gl.uniform2f(uniforms.helmet, ...view.helmet)
      gl.uniform1f(uniforms.breath, view.breath)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    resize(width, height) {
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
    },
    dispose() {
      gl.deleteProgram(program)
      gl.deleteVertexArray(vao)
    },
  }
}
