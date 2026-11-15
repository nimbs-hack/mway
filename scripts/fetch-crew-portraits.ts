// Restore the NASA portraits listed in the credits. Each SVG embeds the
// unchanged NASA JPEG and frames its face with a square viewBox.
import sources from '../src/assets/crew/sources.json'

await Promise.all(sources.map(async ({ file, download, width, height, crop }) => {
  const response = await fetch(download)
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
    throw new Error(`Could not download ${file}: HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer()).toString('base64')
  const [x, y, size] = crop
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="${x} ${y} ${size} ${size}"><image width="${width}" height="${height}" href="data:image/jpeg;base64,${bytes}"/></svg>\n`
  await Bun.write(new URL(`../src/assets/crew/${file}`, import.meta.url), svg)
  console.log(file)
}))
