// Precompress text assets once at build time. Imagery remains byte-for-byte
// unchanged; the API serves gzip only when the browser accepts it.
const root = new URL('../dist/', import.meta.url).pathname
for await (const path of new Bun.Glob('**/*.{js,css,json,svg}').scan(root)) {
  const file = Bun.file(`${root}/${path}`)
  const bytes = await file.arrayBuffer()
  const gzip = Bun.gzipSync(bytes, { level: 9 })
  if (gzip.byteLength < bytes.byteLength) await Bun.write(`${root}/${path}.gz`, gzip)
}
