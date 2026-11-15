import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, preview } from 'vite'
import { mapTileProxy } from './api-server.js'

for (const mode of ['dev', 'preview']) {
  test(`${mode} proxies to Go and stops its API when closed`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'mars-vite-test-'))
    let server
    try {
      await mkdir(join(root, 'dist'))
      await writeFile(join(root, 'dist/index.html'), '<html>Mars</html>')
      const config = {
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [mapTileProxy()],
        server: { host: '127.0.0.1', port: 0 },
        preview: { host: '127.0.0.1', port: 0 },
        optimizeDeps: { noDiscovery: true, include: [] },
      }
      server = mode === 'dev' ? await createServer(config) : await preview(config)
      if (mode === 'dev') await server.listen()
      const port = server.httpServer.address().port
      const response = await fetch(`http://127.0.0.1:${port}/api/imagery/ctx-v01/13/0/0.png`)
      expect(response.status).toBe(400)
      expect(await response.text()).toBe('Invalid CTX tile coordinates')
      const missing = await fetch(`http://127.0.0.1:${port}/api/unknown`)
      expect(missing.status).toBe(404)
      const apiURL = server.config[mode === 'dev' ? 'server' : 'preview'].proxy['/api'].target
      if (mode === 'dev') {
        const restart = server.restart.bind(server)
        const restarted = new Promise((resolve, reject) => {
          server.restart = (...args) => restart(...args).then(resolve, reject)
        })
        server.watcher.emit('all', 'change', fileURLToPath(new URL('../apps/api/cmd/server/main.go', import.meta.url)))
        await restarted
        expect(server.config.server.proxy['/api'].target).not.toBe(apiURL)
        await expect(fetch(`${apiURL}/api/unknown`)).rejects.toThrow()
        const science = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/api/science/mola-color/99/0/0.png`)
        expect(science.status).toBe(400)
        expect(await science.text()).toBe('Invalid science tile coordinates\n')
      }
      const currentAPIURL = server.config[mode === 'dev' ? 'server' : 'preview'].proxy['/api'].target
      await server.close()
      server = undefined
      await expect(fetch(`${apiURL}/api/unknown`)).rejects.toThrow()
      await expect(fetch(`${currentAPIURL}/api/unknown`)).rejects.toThrow()
    } finally {
      await server?.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
}
