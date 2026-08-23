// The font manager: owns every css2 request and every FontFace this app
// creates. This file deliberately breaks the src/lib/ purity rule (it touches
// fetch, document.fonts and timers) so that everything AROUND it can stay
// pure; it is the one stateful room in the house, exposed as a factory so the
// Playwright harness can instantiate it with a stubbed fetch.
//
// Architecture notes that future edits must not "fix":
//
// - Faces are fetched with fetch() and registered programmatically, never via
//   <link> injection. CSS-connected faces cannot be removed one at a time
//   (document.fonts.delete is a no-op on them), and stylesheet insertion
//   forces a document-wide style recalc. The programmatic path gives real
//   HTTP status codes, per-family eviction, and AbortController cancelation.
//
// - Every face is registered under a GENERATION ALIAS (gf_<slug>_<charsetHash>),
//   never its real family name. When the user retypes, the new subset is a
//   different font entirely, so the swap is atomic per card, nothing collides
//   in font matching, and the old generation can be deleted at any moment.
//
// - unicodeRange is deliberately OMITTED from constructed faces. Copying the
//   response range would make missing characters fall through to the next
//   font in the stack, silently hiding a coverage gap. Omitting it makes a
//   missing character render as this font's own .notdef box, which is the
//   honest signal for a specimen tool and what the coverage probe measures.
//
// - A family absent from a multi-family response was SILENTLY DROPPED by
//   Google (verified behavior: bad specs return 200 without that family, not
//   400). Comparing requested names against parsed names is the only
//   detector; response.ok proves nothing per family.
//
// - Swap, then evict. A family's previous generation is only removed once its
//   new generation is ready (or the family has left the load window), so a
//   card never loses its font before gaining the next one.

import {
  charsetHash,
  familySpec,
  fontAlias,
  fontKey,
  normalizeCharset,
  parseFaces,
  planChunks,
  resolveWeight,
  buildCss2Url,
} from './fontUrl.js'
import { probeCoverage } from './fontCoverage.js'

const RETRY_DELAY_MS = 400

// One frozen idle object shared by every key: getStatus must return a stable
// reference for unknown keys or useSyncExternalStore re-renders forever.
const IDLE_STATUS = Object.freeze({
  state: 'idle',
  alias: null,
  text: '',
  weight: 400,
  exactWeight: true,
  italic: false,
  italicAvailable: true,
  coverage: 'unknown',
  missingChars: [],
  error: null,
})

const scheduleIdle =
  typeof requestIdleCallback === 'function'
    ? (callback) => requestIdleCallback(callback, { timeout: 1000 })
    : (callback) => setTimeout(callback, 200)

export function createFontManager({
  fetchImpl = (...args) => fetch(...args),
  fontSet = typeof document !== 'undefined' ? document.fonts : null,
  maxLiveFaces = 240,
  maxLiveBytes = 3 * 1024 * 1024,
  maxInFlight = 4,
  chunkSize = 24,
  retryLimit = 1,
} = {}) {
  // key -> frozen status object, replaced only on a real transition.
  const statuses = new Map()
  // key -> Set of subscriber callbacks.
  const listeners = new Map()
  // key -> { faces: FontFace[], bytes, generation, touch } for everything live.
  const liveFaces = new Map()
  // key -> retry count for transient network failures.
  const retryCounts = new Map()
  const inFlightChunks = new Set()
  const chunkQueue = []
  let touchCounter = 0
  let currentHash = ''
  let currentKeys = new Set()
  let destroyed = false
  const stats = { requests: 0, failures: 0, evictions: 0, bytes: 0 }

  function emit(key) {
    const callbacks = listeners.get(key)
    if (!callbacks) return
    for (const callback of callbacks) callback()
  }

  function setStatus(key, patch) {
    const previous = statuses.get(key) || IDLE_STATUS
    const next = Object.freeze({ ...previous, ...patch })
    statuses.set(key, next)
    emit(key)
  }

  function getStatus(key) {
    return statuses.get(key) || IDLE_STATUS
  }

  function subscribe(key, callback) {
    let callbacks = listeners.get(key)
    if (!callbacks) {
      callbacks = new Set()
      listeners.set(key, callbacks)
    }
    callbacks.add(callback)
    return () => {
      callbacks.delete(callback)
      if (callbacks.size === 0) listeners.delete(key)
    }
  }

  // ---- eviction ----------------------------------------------------------

  function liveBytes() {
    let total = 0
    for (const entry of liveFaces.values()) total += entry.bytes
    return total
  }

  // The budget counts real FontFace objects, not family entries: an entry
  // carries one face normally but two when italics ride along, and the
  // ceiling exists to bound browser font memory, which scales with faces.
  function liveFaceCount() {
    let total = 0
    for (const entry of liveFaces.values()) total += entry.faces.length
    return total
  }

  function removeKey(key) {
    const entry = liveFaces.get(key)
    if (!entry) return
    for (const face of entry.faces) {
      // A false return means the face became CSS-connected somehow, which
      // would break the whole eviction story; surface it loudly in dev.
      const removed = fontSet ? fontSet.delete(face) : true
      if (!removed && import.meta.env?.DEV) {
        console.warn(`fontLoader: document.fonts.delete refused ${key}`)
      }
    }
    liveFaces.delete(key)
    statuses.delete(key)
    stats.evictions += 1
  }

  // LRU with two ceilings (face count and estimated bytes). Stale-generation
  // entries go first, oldest touch first; the current load window is immune.
  // Runs after every family load, not only on idle: the measured peak with
  // idle-only eviction was 293 faces against a 240 ceiling, because a whole
  // chunk could land before the idle callback fired.
  function evictToBudget() {
    if (liveFaceCount() <= maxLiveFaces && liveBytes() <= maxLiveBytes) return
    const candidates = [...liveFaces.entries()]
      .filter(([key]) => !currentKeys.has(key))
      .sort((a, b) => {
        const aStale = a[1].generation !== currentHash
        const bStale = b[1].generation !== currentHash
        if (aStale !== bStale) return aStale ? -1 : 1
        return a[1].touch - b[1].touch
      })
    for (const [key] of candidates) {
      if (liveFaceCount() <= maxLiveFaces && liveBytes() <= maxLiveBytes) break
      removeKey(key)
    }
  }

  // Old generations of families whose new generation is READY can go at any
  // size: they will never be shown again.
  function clearReplacedGenerations() {
    for (const [key, entry] of liveFaces.entries()) {
      if (entry.generation === currentHash) continue
      const replacementKey = entry.replacedBy
      if (replacementKey && getStatus(replacementKey).state === 'ready') removeKey(key)
    }
  }

  function clearGeneration(hash) {
    let cleared = 0
    for (const [key, entry] of [...liveFaces.entries()]) {
      if (entry.generation === hash) {
        removeKey(key)
        cleared += 1
      }
    }
    return cleared
  }

  // ---- request lifecycle -------------------------------------------------

  // A superseded chunk's families were already marked 'loading'. Those keys
  // must return to idle or request() will skip them forever: coming BACK to
  // the same text/weight combination would find 'loading' statuses nothing
  // will ever resolve, and the grid would freeze on the previous word.
  function releaseChunkStatuses(chunk) {
    for (const family of chunk.families) {
      if (statuses.get(family.key)?.state === 'loading') {
        statuses.delete(family.key)
        emit(family.key)
      }
    }
  }

  function abortStaleChunks() {
    for (const chunk of inFlightChunks) {
      if (chunk.hash !== currentHash) chunk.controller.abort()
    }
    for (let i = chunkQueue.length - 1; i >= 0; i -= 1) {
      if (chunkQueue[i].hash !== currentHash) {
        releaseChunkStatuses(chunkQueue[i])
        chunkQueue.splice(i, 1)
      }
    }
  }

  function dispatchNext() {
    while (inFlightChunks.size < maxInFlight && chunkQueue.length > 0) {
      const chunk = chunkQueue.shift()
      inFlightChunks.add(chunk)
      runChunk(chunk).finally(() => {
        inFlightChunks.delete(chunk)
        dispatchNext()
        scheduleIdle(() => {
          clearReplacedGenerations()
          evictToBudget()
        })
      })
    }
  }

  async function fetchChunkCss(chunk, attempt) {
    const url = buildCss2Url(chunk.specs, chunk.codepoints)
    stats.requests += 1
    const response = await fetchImpl(url, { signal: chunk.controller.signal })
    if (!response.ok) {
      if (attempt < retryLimit) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        return fetchChunkCss(chunk, attempt + 1)
      }
      const error = new Error(`css2 responded ${response.status}`)
      error.httpStatus = response.status
      throw error
    }
    const contentLength = Number(response.headers?.get?.('content-length')) || 0
    const cssText = await response.text()
    return { cssText, contentLength }
  }

  async function loadFamilyFaces(chunk, family, faceDescriptors, bytesEstimate) {
    const faces = []
    for (const descriptor of faceDescriptors) {
      // descriptor.src is the response's full src value, already shaped like
      // url(...) format('woff2'), which is exactly what FontFace accepts.
      const face = new FontFace(family.alias, descriptor.src, {
        weight: descriptor.weight,
        style: descriptor.style || 'normal',
        display: 'block',
        // No unicodeRange, on purpose. See the header comment.
      })
      if (fontSet) fontSet.add(face)
      faces.push(face)
    }
    await Promise.all(faces.map((face) => face.load()))
    // A clean load forgives past failures; without this, one transient error
    // followed by success would still count against the retry ceiling later.
    retryCounts.delete(family.key)
    liveFaces.set(family.key, {
      faces,
      bytes: bytesEstimate,
      generation: chunk.hash,
      touch: (touchCounter += 1),
      replacedBy: null,
    })
    // Mark any older generation of this family as replaced so the idle pass
    // can clear it now that the swap target exists.
    for (const entry of liveFaces.values()) {
      if (entry !== liveFaces.get(family.key) && entry.familyName === family.name) {
        entry.replacedBy = family.key
      }
    }
    liveFaces.get(family.key).familyName = family.name

    setStatus(family.key, {
      state: 'ready',
      alias: family.alias,
      text: chunk.renderedText,
      weight: family.resolved.cssWeight,
      exactWeight: family.resolved.exact,
      italic: family.resolved.italic,
      italicAvailable: family.resolved.italicAvailable,
      coverage: 'unknown',
      missingChars: [],
      error: null,
    })
    // Eviction right here, not only on idle: see evictToBudget.
    evictToBudget()

    // The coverage probe measures canvas text metrics per character; run
    // synchronously it was the biggest slice of a 371ms long task when a
    // jump-scroll landed a whole chunk at once. Deferred, the card shows the
    // specimen immediately and flips to unsupported a beat later in the rare
    // case the catalog masks let a non-covering font through.
    if (chunk.renderedText && fontSet) {
      scheduleIdle(() => {
        if (!liveFaces.has(family.key)) return
        const probed = probeCoverage(family.alias, chunk.renderedText)
        if (probed.coverage === 'unknown') return
        setStatus(family.key, {
          state: probed.coverage === 'none' ? 'unsupported' : 'ready',
          coverage: probed.coverage,
          missingChars: probed.missingChars,
        })
      })
    }
  }

  async function runChunk(chunk) {
    try {
      const { cssText, contentLength } = await fetchChunkCss(chunk, 0)
      if (chunk.controller.signal.aborted) {
        releaseChunkStatuses(chunk)
        return
      }
      const faceMap = parseFaces(cssText)
      const bytesPerFamily = chunk.families.length
        ? Math.round((contentLength || cssText.length * 4) / chunk.families.length)
        : 0
      stats.bytes += contentLength

      for (const family of chunk.families) {
        const descriptors = faceMap.get(family.name)
        if (!descriptors || descriptors.length === 0) {
          // Silent drop: Google returned 200 without this family. Retrying
          // would just drop it again, so report it as-is; the card explains
          // the snapped weight that was refused.
          stats.failures += 1
          setStatus(family.key, {
            state: 'error',
            error: 'dropped',
            weight: family.resolved.cssWeight,
            exactWeight: family.resolved.exact,
            text: chunk.renderedText,
          })
          continue
        }
        try {
          await loadFamilyFaces(chunk, family, descriptors, bytesPerFamily)
        } catch {
          stats.failures += 1
          setStatus(family.key, { state: 'error', error: 'network', text: chunk.renderedText })
        }
      }
    } catch (error) {
      if (chunk.controller.signal.aborted) {
        releaseChunkStatuses(chunk)
        return
      }
      // One split-in-half retry isolates a poison family instead of blanking
      // the whole chunk; single-family chunks have nothing left to split.
      if (!chunk.isSplit && chunk.families.length > 1) {
        const middle = Math.ceil(chunk.families.length / 2)
        for (const half of [chunk.families.slice(0, middle), chunk.families.slice(middle)]) {
          enqueueChunk(chunk, half, true)
        }
        return
      }
      stats.failures += 1
      const errorKind = error?.httpStatus ? 'http' : 'network'
      for (const family of chunk.families) {
        setStatus(family.key, { state: 'error', error: errorKind, text: chunk.renderedText })
      }
    }
  }

  function enqueueChunk(parent, families, isSplit = false) {
    chunkQueue.push({
      hash: parent.hash,
      codepoints: parent.codepoints,
      renderedText: parent.renderedText,
      families,
      specs: families.map((family) => family.spec).sort(),
      controller: new AbortController(),
      isSplit,
    })
    dispatchNext()
  }

  // The one call the grid makes. `families` is the load window in priority
  // order (center of viewport outward): [{ name, weights, italics, axes }].
  // Idempotent and cheap to call repeatedly; it diffs against live state.
  function request({ families, text, weight, italic }) {
    if (destroyed) return
    const codepoints = normalizeCharset(text)
    const hash = charsetHash(codepoints)
    const renderedText = text
    currentHash = hash
    abortStaleChunks()

    const candidates = []
    const windowKeys = new Set()
    for (const family of families) {
      const resolved = resolveWeight(family, weight, italic)
      const key = fontKey({
        name: family.name,
        weightSpec: resolved.weightSpec,
        italic: resolved.italic,
        charsetHash: hash,
      })
      windowKeys.add(key)
      const status = getStatus(key)
      if (status.state === 'ready' || status.state === 'unsupported') {
        const entry = liveFaces.get(key)
        if (entry) entry.touch = touchCounter += 1
        continue
      }
      if (status.state === 'loading') continue
      if (status.state === 'error') {
        const attempts = retryCounts.get(key) || 0
        if (status.error === 'dropped' || attempts >= retryLimit) continue
        retryCounts.set(key, attempts + 1)
      }
      candidates.push({
        name: family.name,
        resolved,
        key,
        alias: fontAlias(family.name, hash),
        spec: familySpec(family.name, resolved),
      })
    }
    currentKeys = windowKeys

    if (candidates.length === 0) return
    for (const candidate of candidates) {
      setStatus(candidate.key, {
        state: 'loading',
        alias: candidate.alias,
        weight: candidate.resolved.cssWeight,
        exactWeight: candidate.resolved.exact,
        text: renderedText,
        error: null,
      })
    }
    const parent = { hash, codepoints, renderedText }
    for (const chunk of planChunks(candidates, { chunkSize })) {
      enqueueChunk(parent, chunk.families)
    }
  }

  // Boot-time canary: distinguishes an ad-blocker (fetch TypeError while the
  // browser says it is online) from being offline. The two banners read
  // differently and only one of them should keep retrying.
  async function probeConnectivity() {
    try {
      const response = await fetchImpl(
        'https://fonts.googleapis.com/css2?family=Roboto:wght@400&text=A&display=block',
      )
      return response.ok ? 'ok' : 'blocked'
    } catch {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
      return 'blocked'
    }
  }

  function destroy() {
    destroyed = true
    for (const chunk of inFlightChunks) chunk.controller.abort()
    chunkQueue.length = 0
    for (const key of [...liveFaces.keys()]) removeKey(key)
    listeners.clear()
    statuses.clear()
  }

  // Forgive every failed family. Called when connectivity comes back: a
  // transient network drop must not brick its in-flight families for the
  // rest of the session ('error' keys past the retry ceiling are never
  // re-candidated by request()).
  function resetRetries() {
    retryCounts.clear()
    for (const [key, status] of [...statuses.entries()]) {
      if (status.state === 'error' && status.error !== 'dropped') {
        statuses.delete(key)
        emit(key)
      }
    }
  }

  return {
    request,
    subscribe,
    getStatus,
    probeConnectivity,
    resetRetries,
    clearGeneration,
    destroy,
    stats: () => ({
      ...stats,
      live: liveFaces.size,
      liveBytes: liveBytes(),
      inFlight: inFlightChunks.size,
      queued: chunkQueue.length,
      fontSetSize: fontSet ? fontSet.size : 0,
    }),
  }
}
