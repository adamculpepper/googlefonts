// Network and disk-cache plumbing for the data build. Build-only: this is the
// one layer allowed to touch the clock, the filesystem and the network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIRECTORY = dirname(dirname(fileURLToPath(import.meta.url)))

export const CACHE_DIRECTORY = join(SCRIPTS_DIRECTORY, '.cache')
export const FONT_CACHE_DIRECTORY = join(CACHE_DIRECTORY, 'font')

// Google serves a woff2 to anything that looks like a browser and a raw TTF to
// anything that does not. The raw TTF is what makes this build possible without
// a brotli decoder, so the User-Agent is load-bearing, not decoration.
export const BUILD_USER_AGENT = 'googlefonts-build'

export const CONCURRENCY_LIMIT = 8

const RETRY_DELAYS_MS = [250, 1000, 4000]

export function cachePath(...segments) {
  return join(CACHE_DIRECTORY, ...segments)
}

export function ensureCacheDirectories() {
  mkdirSync(CACHE_DIRECTORY, { recursive: true })
  mkdirSync(FONT_CACHE_DIRECTORY, { recursive: true })
}

export function readCachedJson(relativePath) {
  const path = cachePath(relativePath)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // A half-written cache from an interrupted run is not worth failing over;
    // treating it as absent costs one cold rebuild.
    return null
  }
}

export function writeCachedJson(relativePath, value) {
  ensureCacheDirectories()
  writeFileSync(cachePath(relativePath), `${JSON.stringify(value)}\n`, 'utf8')
}

export function readCachedBytes(relativePath) {
  const path = cachePath(relativePath)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

export function writeCachedBytes(relativePath, bytes) {
  ensureCacheDirectories()
  writeFileSync(cachePath(relativePath), bytes)
}

export function fontCacheName(familyName, weight, italic) {
  const slug = familyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `font/${slug}@${weight}${italic ? 'i' : ''}.ttf`
}

function delay(milliseconds) {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds) })
}

// Retries a transport failure, a 5xx and a 429. Everything else in the 4xx
// range is a settled answer: a bare request for a weight a family does not have
// returns 400, and hammering it three more times only wastes the budget.
export async function fetchWithRetry(url, { expect = 'text', headers = {} } = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await delay(RETRY_DELAYS_MS[attempt - 1])
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': BUILD_USER_AGENT, ...headers },
      })
      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`${url} answered ${response.status}`)
        continue
      }
      if (expect === 'bytes') {
        const bytes = new Uint8Array(await response.arrayBuffer())
        return { ok: response.ok, status: response.status, bytes }
      }
      return { ok: response.ok, status: response.status, text: await response.text() }
    } catch (error) {
      lastError = error
    }
  }
  return { ok: false, status: 0, error: lastError, text: '', bytes: new Uint8Array(0) }
}

// The list endpoint answers with plain JSON; the per-family endpoint prefixes
// the XSSI guard. Stripping defensively on both means the day Google adds the
// guard to the list endpoint costs nothing.
export function stripXssiGuard(text) {
  if (!text.startsWith(")]}'")) return text
  const newline = text.indexOf('\n')
  return newline < 0 ? text.slice(4) : text.slice(newline + 1)
}

// Runs `worker` over `items` with at most `limit` in flight, preserving order
// in the returned array. `onSettled` fires as each one lands, for progress.
export async function mapWithPool(items, limit, worker, onSettled) {
  const results = new Array(items.length)
  let nextIndex = 0
  let settled = 0

  async function runLane() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
      settled += 1
      if (onSettled) onSettled(settled, items.length, items[index], results[index])
    }
  }

  const lanes = []
  for (let lane = 0; lane < Math.min(limit, items.length); lane += 1) lanes.push(runLane())
  await Promise.all(lanes)
  return results
}
