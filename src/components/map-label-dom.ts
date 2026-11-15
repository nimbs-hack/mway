import { leaderPath, type PlacedLabel } from './map-label-layout'
const SVG = 'http://www.w3.org/2000/svg'

type Leader = { group: SVGGElement; paths: SVGPathElement[] }

export function leader(svg: SVGSVGElement): Leader {
  const group = document.createElementNS(SVG, 'g') as SVGGElement
  const paths = ['map-label__casing', 'map-label__leader'].map((name) => {
    const path = document.createElementNS(SVG, 'path') as SVGPathElement
    path.setAttribute('class', name)
    group.appendChild(path)
    return path
  })
  svg.appendChild(group)
  return { group, paths }
}

export function drawLeader(line: Leader, label: PlacedLabel) {
  const [start, elbow, end] = leaderPath(label, label.box, label.side)
  const d = `M${start.x},${start.y} L${elbow.x},${elbow.y} L${end.x},${end.y}`
  line.paths.forEach((path) => path.setAttribute('d', d))
  line.group.removeAttribute('display')
}

// Hovering or focusing a row lifts its leader above the others so it can be traced.
export function linkHover(button: HTMLButtonElement, line: Leader, svg: SVGSVGElement) {
  const on = () => { line.group.classList.add('is-active'); svg.appendChild(line.group) }
  const off = () => line.group.classList.remove('is-active')
  button.addEventListener('pointerenter', on)
  button.addEventListener('focus', on)
  button.addEventListener('pointerleave', off)
  button.addEventListener('blur', off)
}

// Both map renderers use the same portrait fallback and crew ground marker.
export function crewPortrait(name: string, url?: string): HTMLElement {
  const initials = document.createElement('span')
  initials.className = 'map-label__portrait map-label__initials'
  initials.textContent = name.trim().slice(0, 2)
  initials.setAttribute('aria-hidden', 'true')
  if (!url) return initials
  const photo = document.createElement('img')
  photo.className = 'map-label__portrait'
  photo.src = url
  photo.alt = ''
  photo.onerror = () => photo.replaceWith(initials)
  return photo
}

export function crewPin(svg: SVGSVGElement): SVGPathElement {
  const pin = document.createElementNS(SVG, 'path')
  pin.setAttribute('class', 'map-label__crew-pin')
  pin.setAttribute('d', 'M0 -6.5 6.5 0 0 6.5 -6.5 0Z')
  svg.appendChild(pin)
  return pin
}
