// Builds DOM nodes without a framework. The viewer's page is a few hundred
// nodes, rebuilt whole when the mission changes.

export type Child = Node | string | number | false | null | undefined | Child[]

type Props = Record<string, string | number | boolean | null | undefined | ((event: never) => void)>

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(props ?? {})) {
    if (typeof value === 'function') node.addEventListener(name.slice(2), value as EventListener)
    else if (value === true) node.setAttribute(name, '')
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(name, String(value))
  }
  const add = (child: Child) => {
    if (Array.isArray(child)) child.forEach(add)
    else if (child !== false && child !== null && child !== undefined) node.append(child instanceof Node ? child : String(child))
  }
  add(children)
  return node
}
