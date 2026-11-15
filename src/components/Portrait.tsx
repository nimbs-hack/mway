import { portraitUrl } from './portrait-assets'
export { hasPortrait, portraitUrl } from './portrait-assets'

// The photo of a crew member: the one added on the crew page, or the file
// that ships with the app, or their first two letters when there is neither.
export function Portrait({ name, photo }: { name: string; photo?: string }) {
  const url = portraitUrl(name, photo)
  return url ? (
    <img className="portrait" src={url} alt={`Portrait of ${name}`} />
  ) : (
    <span className="portrait portrait--none" title="No portrait on file" aria-hidden="true">
      {name.trim().slice(0, 2) || '?'}
    </span>
  )
}
