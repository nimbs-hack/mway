// The viewer's camera. It orbits a target point on the ground. Positions are
// meters east, north and up from that target, so the numbers stay small
// enough for 32-bit floats on any graphics card.

export type Vec3 = [x: number, y: number, z: number]

export interface View {
  // Where the camera looks, radians clockwise from north.
  heading: number
  // Camera elevation above the horizon as seen from the target, radians.
  // A quarter turn looks straight down.
  pitch: number
  // Camera to target, meters.
  dist: number
  // Canvas size in CSS pixels.
  width: number
  height: number
}

// Half of the 45 degree vertical field of view.
export const HALF_FOV = Math.tan(Math.PI / 8)
// The lowest pitch that keeps every pixel on the ground, not on sky.
export const MIN_PITCH = (25 * Math.PI) / 180

export interface Basis {
  eye: Vec3
  forward: Vec3
  right: Vec3
  up: Vec3
}

export function basis({ heading, pitch, dist }: View): Basis {
  const sh = Math.sin(heading)
  const ch = Math.cos(heading)
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  return {
    eye: [-sh * cp * dist, -ch * cp * dist, sp * dist],
    forward: [sh * cp, ch * cp, -sp],
    right: [ch, -sh, 0],
    up: [sh * sp, ch * sp, cp],
  }
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// Pixels per meter at the target.
export const pixelsPerMeter = (view: View) => view.height / 2 / (view.dist * HALF_FOV)

// Screen position of a point, or null when it is behind the camera.
export function project(b: Basis, view: View, point: Vec3): [x: number, y: number] | null {
  const v: Vec3 = [point[0] - b.eye[0], point[1] - b.eye[1], point[2] - b.eye[2]]
  const depth = dot(v, b.forward)
  if (depth < view.dist * 0.02) return null
  const scale = view.height / 2 / (depth * HALF_FOV)
  return [view.width / 2 + dot(v, b.right) * scale, view.height / 2 - dot(v, b.up) * scale]
}

// Where the ray through a pixel meets the level plane at height z. Null when
// the ray points at the sky or the hit is too far away to be useful.
export function ground(b: Basis, view: View, px: number, py: number, z = 0): [x: number, y: number] | null {
  const nx = ((px - view.width / 2) / (view.height / 2)) * HALF_FOV
  const ny = ((view.height / 2 - py) / (view.height / 2)) * HALF_FOV
  const dz = b.forward[2] + b.right[2] * nx + b.up[2] * ny
  if (dz >= 0) return null
  const steps = (z - b.eye[2]) / dz
  if (steps < 0 || steps > view.dist * 60) return null
  return [
    b.eye[0] + (b.forward[0] + b.right[0] * nx + b.up[0] * ny) * steps,
    b.eye[1] + (b.forward[1] + b.right[1] * nx + b.up[1] * ny) * steps,
  ]
}

// The same projection as project(), as a column-major matrix for WebGL.
export function matrix(b: Basis, view: View, near: number, far: number): Float32Array {
  const a = 1 / (HALF_FOV * (view.width / view.height))
  const c = 1 / HALF_FOV
  const depth = (far + near) / (near - far)
  const shift = (2 * far * near) / (near - far)
  const { eye, forward: f, right: r, up: u } = b
  return new Float32Array([
    a * r[0], c * u[0], -depth * f[0], f[0],
    a * r[1], c * u[1], -depth * f[1], f[1],
    a * r[2], c * u[2], -depth * f[2], f[2],
    -a * dot(r, eye), -c * dot(u, eye), depth * dot(f, eye) + shift, -dot(f, eye),
  ])
}
