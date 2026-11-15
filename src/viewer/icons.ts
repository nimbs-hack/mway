// Viewer icon library, drawn like the editor's (src/components/icons.tsx):
// 24 unit view box, 1.6 stroke, round ends. Crew, phases and sites use the
// editor's own drawings. Every control also has a text label or a tip.
const paths = {
  menu: ['M4 6h16M4 12h16M4 18h16'],
  live: ['M12 3v4m0 10v4M3 12h4m10 0h4', 'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0', 'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
  overview: ['M6 3h12v18H6zM9 7h6M9 12h6M9 17h4'],
  sites: ['M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11ZM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  crew: ['M12 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M16 5.5a3 3 0 0 1 0 5M17.5 14.5c2 .8 3.5 2.8 3.5 5.5'],
  phases: ['M3 7h7v4H3zM10 13h6v4h-6zM16 7h5v4h-5zM3 21h18'],
  briefing: ['M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  fit: ['M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'],
  north: ['m12 3 7 17-7-4-7 4Z'],
  tilt: ['m3 14 9-8 9 8-9 7Z'],
  close: ['m6 6 12 12M18 6 6 18'],
  down: ['m6 9 6 6 6-6'],
} as const
export type IconName = keyof typeof paths
export function icon(name: IconName): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key,value] of Object.entries({viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':'1.6', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false', class:'icon'})) node.setAttribute(key,value)
  for (const d of paths[name]) {
    const path = document.createElementNS(node.namespaceURI,'path')
    path.setAttribute('d',d)
    node.append(path)
  }
  return node
}
