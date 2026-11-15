// Draws the ground. WebGL 1 where the device has it: one small mesh and one
// picture per tile, no lighting, since the imagery carries its own shadows.
// Without WebGL the same tiles are drawn flat, seen from straight above.

import { CELLS, type Patch, type RenderTile } from './tiles'

export interface Frame {
  // Meters from the camera target to clip space.
  matrix: Float32Array
  // Drawn height is terrain height times lift[0], plus lift[1].
  lift: [scale: number, offset: number]
  // Pixels per meter at the target.
  scale: number
  // A tile's south-west corner and size, meters from the target.
  place(tile: RenderTile): [x: number, y: number, width: number, height: number]
}

export interface Renderer {
  // True when the ground is drawn flat because the device has no WebGL.
  flat: boolean
  resize(width: number, height: number, ratio: number): void
  // Patches are drawn in order, each over the ones before it.
  draw(patches: Patch[], frame: Frame): void
  // Frees what was kept for a patch or an image that is gone.
  drop(patch: Patch): void
  release(image: HTMLImageElement): void
}

type Color = [r: number, g: number, b: number]

const VERTEX = `
attribute vec2 corner;
attribute float height;
uniform mat4 matrix;
uniform vec4 rect;
uniform vec3 crop;
uniform vec2 lift;
varying vec2 at;
void main() {
  at = crop.xy + vec2(corner.x, 1.0 - corner.y) * crop.z;
  gl_Position = matrix * vec4(rect.xy + corner * rect.zw, height * lift.x + lift.y, 1.0);
}`

const FRAGMENT = `
precision mediump float;
uniform sampler2D image;
varying vec2 at;
void main() {
  gl_FragColor = texture2D(image, at);
}`

const powerOfTwo = (n: number) => (n & (n - 1)) === 0

// Null when the device cannot do it. `redraw` is called after the browser
// gives back a graphics context it had taken away.
export function createGlRenderer(canvas: HTMLCanvasElement, background: Color, blank: Color, redraw: () => void): Renderer | null {
  const context = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' })
  if (!context) return null
  const gl: WebGLRenderingContext = context
  const textures = new Map<HTMLImageElement, WebGLTexture>()
  const buffers = new Map<RenderTile, WebGLBuffer>()
  let uniform: Record<'matrix' | 'rect' | 'crop' | 'lift', WebGLUniformLocation | null>
  let heightAt = 0
  let blankTexture: WebGLTexture | null = null
  let lost = false
  const count = CELLS * CELLS * 6

  function setup(): boolean {
    const program = gl.createProgram()
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
    gl.useProgram(program)
    uniform = {
      matrix: gl.getUniformLocation(program, 'matrix'),
      rect: gl.getUniformLocation(program, 'rect'),
      crop: gl.getUniformLocation(program, 'crop'),
      lift: gl.getUniformLocation(program, 'lift'),
    }

    // Every tile is the same grid. Only its heights and its picture differ.
    const side = CELLS + 1
    const corners = new Float32Array(side * side * 2)
    const indices = new Uint16Array(count)
    for (let j = 0, n = 0; j < side; j++) {
      for (let i = 0; i < side; i++, n += 2) {
        corners[n] = i / CELLS
        corners[n + 1] = j / CELLS
      }
    }
    for (let j = 0, n = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++, n += 6) {
        const a = j * side + i
        indices.set([a, a + 1, a + side, a + 1, a + side + 1, a + side], n)
      }
    }
    const cornerAt = gl.getAttribLocation(program, 'corner')
    heightAt = gl.getAttribLocation(program, 'height')
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(cornerAt)
    gl.vertexAttribPointer(cornerAt, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(heightAt)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

    blankTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, blankTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(blank.map((c) => c * 255)))
    gl.enable(gl.DEPTH_TEST)
    gl.clearColor(...background, 1)
    return true
  }
  if (!setup()) return null

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    lost = true
  })
  canvas.addEventListener('webglcontextrestored', () => {
    textures.clear()
    buffers.clear()
    lost = !setup()
    redraw()
  })

  function texture(image: HTMLImageElement): WebGLTexture | null {
    let made = textures.get(image)
    if (made) return made
    made = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, made)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // WebGL 1 builds the smaller copies only for power-of-two pictures.
    // They stop distant ground from shimmering as the camera moves.
    const mipmaps = powerOfTwo(image.naturalWidth) && powerOfTwo(image.naturalHeight)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
    textures.set(image, made)
    return made
  }

  return {
    flat: false,
    resize(width, height, ratio) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
    },
    draw(patches, frame) {
      if (lost) return
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.uniformMatrix4fv(uniform.matrix, false, frame.matrix)
      gl.uniform2f(uniform.lift, ...frame.lift)
      patches.forEach((patch, n) => {
        // A finer patch always shows over a coarser one, whatever their heights.
        if (n > 0) gl.clear(gl.DEPTH_BUFFER_BIT)
        for (const tile of patch.tiles) {
          if (tile.waiting) continue
          let heights = buffers.get(tile)
          if (!heights) {
            heights = gl.createBuffer()
            gl.bindBuffer(gl.ARRAY_BUFFER, heights)
            gl.bufferData(gl.ARRAY_BUFFER, tile.heights, gl.STATIC_DRAW)
            buffers.set(tile, heights)
          } else {
            gl.bindBuffer(gl.ARRAY_BUFFER, heights)
          }
          gl.vertexAttribPointer(heightAt, 1, gl.FLOAT, false, 0, 0)
          gl.bindTexture(gl.TEXTURE_2D, tile.image ? texture(tile.image) : blankTexture)
          gl.uniform4f(uniform.rect, ...frame.place(tile))
          gl.uniform3f(uniform.crop, ...tile.crop)
          gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0)
        }
      })
    },
    drop(patch) {
      for (const tile of patch.tiles) {
        gl.deleteBuffer(buffers.get(tile) ?? null)
        buffers.delete(tile)
      }
    },
    release(image) {
      gl.deleteTexture(textures.get(image) ?? null)
      textures.delete(image)
    },
  }
}

const css = (color: Color) => `rgb(${color.map((c) => Math.round(c * 255)).join(' ')})`

export function createFlatRenderer(canvas: HTMLCanvasElement, background: Color, blank: Color): Renderer {
  const context = canvas.getContext('2d', { alpha: false })!
  let size = { width: 0, height: 0, ratio: 1 }
  return {
    flat: true,
    resize(width, height, ratio) {
      size = { width, height, ratio }
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
    },
    draw(patches, frame) {
      context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0)
      context.fillStyle = css(background)
      context.fillRect(0, 0, size.width, size.height)
      context.fillStyle = css(blank)
      for (const patch of patches) {
        for (const tile of patch.tiles) {
          if (tile.waiting) continue
          const [x, y, width, height] = frame.place(tile)
          const left = size.width / 2 + x * frame.scale
          const top = size.height / 2 - (y + height) * frame.scale
          // Half a pixel of overlap hides the seams between tiles.
          const w = width * frame.scale + 0.5
          const h = height * frame.scale + 0.5
          const { image, crop } = tile
          if (!image) context.fillRect(left, top, w, h)
          else {
            const side = crop[2] * image.naturalWidth
            context.drawImage(image, crop[0] * image.naturalWidth, crop[1] * image.naturalHeight, side, crop[2] * image.naturalHeight, left, top, w, h)
          }
        }
      }
    },
    drop() {},
    release() {},
  }
}
