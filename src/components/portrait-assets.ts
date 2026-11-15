// Portraits use lowercase crew names as filenames, such as jessica meir.svg.
// Vite lists src/assets/crew at build time; missing portraits make no request.
const FILES = import.meta.glob<string>('../assets/crew/*.{jpg,jpeg,png,webp,avif,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
})

const BY_NAME = new Map(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, path.lastIndexOf('.')).toLowerCase(), url]),
)

// True when a photo for this crew member ships with the app.
export const hasPortrait = (name: string): boolean => BY_NAME.has(name.trim().toLowerCase())

// Map labels and crew tiles resolve uploaded and bundled photos the same way.
export const portraitUrl = (name: string, photo?: string): string | undefined => photo ?? BY_NAME.get(name.trim().toLowerCase())

