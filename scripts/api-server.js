import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))

// Build once per session so signals reach the server itself, not a go-run wrapper.
export async function startAPI() {
  const temp = await mkdtemp(join(tmpdir(), 'mars-api-'))
  const binary = join(temp, 'mars-api')
  try {
    await promisify(execFile)('go', ['build', '-o', binary, './cmd/server'], { cwd: join(root, 'apps/api') })
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
  const child = spawn(binary, [
    '-addr', '127.0.0.1:0',
    '-cache-dir', join(root, 'data/cache'),
    '-static-dir', join(root, 'dist'),
  ], { stdio: ['ignore', 'pipe', 'inherit'] })
  const onExit = () => { child.kill('SIGTERM') }
  process.once('exit', onExit)
  let stopPromise
  function stop() {
    stopPromise ??= (async () => {
      process.off('exit', onExit)
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
          child.kill('SIGTERM')
        })
      }
      await rm(temp, { recursive: true, force: true })
    })()
    return stopPromise
  }
  try {
    const address = await new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => finish(new Error('Go API did not start within 10 seconds')), 10_000)
      const onError = (error) => finish(error)
      const onClose = (code) => finish(new Error(`Go API exited before listening, code ${code}`))
      const onData = (chunk) => {
        output += chunk.toString()
        if (!output.includes('\n')) return
        try {
          const { address } = JSON.parse(output.slice(0, output.indexOf('\n')))
          if (typeof address !== 'string') throw new Error('Go API returned no listen address')
          finish(null, address)
        } catch (error) { finish(error) }
      }
      function finish(error, address) {
        clearTimeout(timer)
        child.off('error', onError)
        child.off('exit', onClose)
        child.stdout.off('data', onData)
        if (error) reject(error)
        else resolve(address)
      }
      child.once('error', onError)
      child.once('exit', onClose)
      child.stdout.on('data', onData)
    })
    return { url: `http://${address}`, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

// Vite forwards API requests to a private Go process in dev and preview.
export function mapTileProxy() {
  let stop
  async function configure(server, options) {
    const api = await startAPI()
    options.proxy['/api'].target = api.url
    return api.stop
  }
  return {
    name: 'go-map-tile-proxy',
    config: () => ({
      server: { proxy: { '/api': { target: 'http://127.0.0.1:1' } } },
      preview: { proxy: { '/api': { target: 'http://127.0.0.1:1' } } },
    }),
    configureServer: async (server) => {
      const stopAPI = await configure(server, server.config.server)
      const apiRoot = join(root, 'apps/api')
      let restartTimer
      const onChange = (event, file) => {
        if (!['add', 'change', 'unlink'].includes(event)) return
        if (!file.startsWith(`${apiRoot}/`)) return
        if (!file.endsWith('.go') && file !== join(apiRoot, 'go.mod') && file !== join(apiRoot, 'go.sum')) return
        clearTimeout(restartTimer)
        restartTimer = setTimeout(() => {
          server.restart().catch((error) => server.config.logger.error(`Go API restart failed: ${error.message}`))
        }, 100)
      }
      server.watcher.add(apiRoot)
      server.watcher.on('all', onChange)
      server.httpServer?.once('close', () => {
        clearTimeout(restartTimer)
        server.watcher.off('all', onChange)
        void stopAPI()
      })
    },
    configurePreviewServer: async (server) => { stop = await configure(server, server.config.preview) },
    closeBundle: () => stop?.(),
    closePreviewServer: () => stop?.(),
  }
}
