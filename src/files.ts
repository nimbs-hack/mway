import { type Astronaut, type Mission, PlannerError, decodeFile, requestPlan } from './api'

// Reads a packed mission file or a mission JSON. A packed file starts with a
// packet header; JSON starts with a brace. The planner does the checking.
export async function readMissionFile(file: File, roster: Astronaut[]): Promise<Mission> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text = new TextDecoder()
  if (!text.decode(bytes.subarray(0, 64)).trimStart().startsWith('{')) return decodeFile(bytes)
  let json: unknown
  try {
    json = JSON.parse(text.decode(bytes))
  } catch {
    throw new PlannerError('the file is not valid JSON', 'invalid')
  }
  return (await requestPlan(json, roster)).mission
}

// The side of a stored crew photo, in pixels. Twice a crew tile, for dense screens.
const PHOTO_SIZE = 448

// A photo file as a square JPEG, cut from its middle and small enough to
// keep dozens in the browser. Refuses a file the browser cannot read as an image.
export async function squarePhoto(file: File): Promise<string> {
  const image = await createImageBitmap(file).catch(() => null)
  if (!image) throw new Error(`${file.name} is not an image this browser can read`)
  const side = Math.min(image.width, image.height)
  const size = Math.min(PHOTO_SIZE, side)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas
    .getContext('2d')!
    .drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size)
  image.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}

export function download(name: string, content: Uint8Array | string, type: string): void {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export const fileStem = (mission: Mission): string =>
  mission.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mission'
