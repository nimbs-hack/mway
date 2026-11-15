import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { siteTileUrls } from './map-cache'

const source = await readFile(new URL('../../public/map-cache.js', import.meta.url), 'utf8')
const tile = 'https://marshub.s3.amazonaws.com/mars_v14/4/2/3.terrain'

function worker(fetch, { denied = false, put } = {}) {
  const entries = new Map()
  const handlers = {}
  const cache = {
    match: async (key) => entries.get(key.url)?.clone(),
    put: async (key, response) => { await put?.(); entries.set(key.url, response.clone()) },
    keys: async () => [...entries.keys()].map((url) => new Request(url)),
    delete: async (key) => entries.delete(key.url),
  }
  runInNewContext(source, {
    URL, Request, Promise, Map,
    fetch,
    caches: { open: async () => { if (denied) throw Error('denied'); return cache } },
    self: { location: { origin: 'https://mars.test' }, addEventListener: (name, handler) => { handlers[name] = handler } },
  })
  return (url, accept = 'application/octet-stream') => {
    let result
    handlers.fetch({
      request: new Request(url, { headers: { accept } }),
      respondWith: (promise) => { result = promise },
      waitUntil: () => {},
    })
    return result
  }
}

describe('persistent map cache', () => {
  test('coalesces concurrent requests and serves later requests without a fetch', async () => {
    let calls = 0
    const request = worker(async () => { calls++; return new Response('mesh') })
    const responses = await Promise.all([request(tile), request(tile)])
    expect(await Promise.all(responses.map((response) => response.text()))).toEqual(['mesh', 'mesh'])
    expect(await (await request(tile)).text()).toBe('mesh')
    expect(calls).toBe(1)
    await request(tile, 'application/vnd.quantized-mesh;extensions=octvertexnormals')
    expect(calls).toBe(2)
  })

  test('does not cache failures, HTML fallbacks, or metadata', async () => {
    let calls = 0
    const request = worker(async () => {
      calls++
      return calls === 1 ? new Response('unavailable', { status: 503 }) :
        new Response('<html>', { headers: { 'content-type': 'text/html' } })
    })
    await request(tile)
    await request(tile)
    await request(tile)
    expect(calls).toBe(3)
    expect(request('https://marshub.s3.amazonaws.com/mars_v14/layer.json')).toBeUndefined()
  })

  test('still loads tiles when browser storage is denied', async () => {
    const request = worker(async () => new Response('mesh'), { denied: true })
    expect(await (await request(tile)).text()).toBe('mesh')
  })

  test('caches CTX through our proxy without intercepting other origins', async () => {
    let calls = 0
    const request = worker(async () => { calls++; return new Response('tile') })
    const path = '/api/imagery/ctx-v01/12/1612/3340.png'
    await request(`https://mars.test${path}`)
    await request(`https://mars.test${path}`)
    expect(calls).toBe(1)
    expect(request(`https://unrelated.test${path}`)).toBeUndefined()
  })

  test('science overlays and pixel sampling share persisted images', async () => {
    let calls = 0
    const request = worker(async () => { calls++; return new Response('science') })
    const path = '/api/science/themis-night/9/205/731.png'
    expect(await (await request(`https://mars.test${path}`, 'image/*')).text()).toBe('science')
    expect(await (await request(`https://mars.test${path}`, '*/*')).text()).toBe('science')
    expect(calls).toBe(1)
    expect(request(`https://unrelated.test${path}`)).toBeUndefined()
    expect(request('https://mars.test/api/science/unknown/9/205/731.png')).toBeUndefined()
  })

  test('delivers tiles before disk writes finish and shares image Accept variants', async () => {
    let release
    const blocked = new Promise((resolve) => { release = resolve })
    let calls = 0
    const request = worker(async () => { calls++; return new Response('tile') }, { put: () => blocked })
    const url = 'https://mars.test/api/imagery/ctx-v01/12/1612/3340.png'
    try {
      const response = await Promise.race([
        request(url, '*/*'),
        new Promise((_, reject) => setTimeout(() => reject(Error('Cache blocked rendering')), 100)),
      ])
      expect(await response.text()).toBe('tile')
      expect(await (await request(url, 'image/avif,image/webp,*/*')).text()).toBe('tile')
      expect(calls).toBe(1)
    } finally {
      release()
    }
  })
})

test('site prefetch stays within the geographic grid at poles and the dateline', () => {
  expect(siteTileUrls(0, 90)).toEqual([])
  expect(siteTileUrls(0, -90)).toEqual([])
  for (const [lon, lat] of [[180, 88], [-180, -88], [137.4, -4.6]]) {
    const urls = siteTileUrls(lon, lat)
    expect(urls.length).toBe(45)
    for (const url of urls) {
      const [z, y, x] = url.split('?')[0].match(/(\d+)\/(\d+)\/(\d+)\.png$/).slice(1).map(Number)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(2 ** (z + 1))
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(2 ** z)
    }
  }
})
