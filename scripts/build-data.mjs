// Builds public/data/fonts.json, the font catalog the site ships with.
//
//   npm run data:refresh
//
// The whole build runs on Node's standard library. No API key is needed for any
// endpoint it touches, and the only reason it can measure real ink without a
// font-rendering dependency is that Google serves a raw TTF to a non-browser
// User-Agent. That behaviour is undocumented, so every assumption it rests on is
// asserted rather than trusted, and the verify script runs at the end.
//
// Refreshing is incremental. A family whose lastModified and size are unchanged
// since the last run, measured by the same algorithm versions, costs zero
// requests, so a no-op refresh is a single fetch of the list endpoint.

import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { createCatalogBuilder, SCHEMA_VERSION, FLAG_NOTO, FLAG_BRAND, FLAG_VARIABLE, FLAG_HAS_LATIN, FLAG_COLRV0, FLAG_COLRV1, FLAG_OTSVG, FLAG_BLACKNESS_COMPARABLE, NO_BLACKNESS } from '../src/lib/catalog.js'
import { PROBE, PROBE_VERSION, buildMask, parseRanges } from '../src/lib/coverage.js'
import { BLACKNESS_ALGO_VERSION, INK_HIGH, INK_LOW, LATIN_SAMPLE_TEXT, MINIMUM_SAMPLE_GLYPHS, measureInk, normalizeBlackness } from '../src/lib/font/blackness.js'
import { isSfnt } from '../src/lib/font/sfnt.js'
import { cssFamilyParam, resolveLadder, servableWeights, weightLadder } from '../src/lib/weights.js'
import {
  CONCURRENCY_LIMIT,
  ensureCacheDirectories,
  fetchWithRetry,
  fontCacheName,
  mapWithPool,
  readCachedBytes,
  readCachedJson,
  stripXssiGuard,
  writeCachedBytes,
  writeCachedJson,
} from './lib/net.mjs'

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CATALOG_OUTPUT_PATH = join(PROJECT_ROOT, 'public', 'data', 'fonts.json')
const CATALOG_META_OUTPUT_PATH = join(PROJECT_ROOT, 'src', 'data', 'catalog-meta.js')

const LIST_ENDPOINT = 'https://fonts.google.com/metadata/fonts'
const FAMILY_ENDPOINT = 'https://fonts.google.com/metadata/fonts/'
const CSS2_ENDPOINT = 'https://fonts.googleapis.com/css2'

const CACHE_INDEX_NAME = 'index.json'

// Nabla, the heaviest colour font in the catalog, subsets to 1.18MB. Four
// megabytes leaves room for something stranger without letting a pathological
// response eat the run.
const MAXIMUM_FONT_BYTES = 4 * 1024 * 1024

const RAW_BUDGET_BYTES = 400 * 1024
const GZIP_BUDGET_BYTES = 120 * 1024

// Twelve letters is the same order of sample as HAMBURGEFONTSIV, enough for the
// ink ratio to average over a script's real letterforms.
const NON_LATIN_SAMPLE_LENGTH = 12

const HISTOGRAM_BUCKETS = 20

const GSTATIC_FONT_URL = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/

// Subsets that say nothing about a family's own script: Google's name-rendering
// slice, and the Latin ranges a non-Latin family carries for stray ASCII.
const NON_SCRIPT_SUBSETS = new Set(['menu', 'latin', 'latin-ext'])

function toDateInteger(isoDate) {
  if (typeof isoDate !== 'string') return 0
  const digits = isoDate.replace(/-/g, '')
  const value = Number.parseInt(digits, 10)
  return Number.isInteger(value) ? value : 0
}

function today() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`
}

function isLetterCodepoint(codepoint) {
  return /\p{L}/u.test(String.fromCodePoint(codepoint))
}

async function fetchFamilyList() {
  const response = await fetchWithRetry(LIST_ENDPOINT)
  if (!response.ok) throw new Error(`the family list endpoint answered ${response.status}`)
  const payload = JSON.parse(stripXssiGuard(response.text))
  const families = payload.familyMetadataList
  if (!Array.isArray(families) || families.length === 0) {
    throw new Error('the family list endpoint returned no families')
  }
  return families
}

async function fetchCoverage(familyName) {
  const response = await fetchWithRetry(FAMILY_ENDPOINT + encodeURIComponent(familyName))
  if (!response.ok) return null
  try {
    return JSON.parse(stripXssiGuard(response.text)).coverage || null
  } catch {
    return null
  }
}

// A family's coverage is the union of every subset it ships, which is exactly
// the set of codepoints it can draw.
function unionCoverage(coverage) {
  const codepoints = new Set()
  if (!coverage) return codepoints
  for (const ranges of Object.values(coverage)) {
    for (const codepoint of parseRanges(ranges)) codepoints.add(codepoint)
  }
  return codepoints
}

// Latin families are all measured on the same word so their scores compare.
// A non-Latin family is measured on its own script instead, which produces an
// honest number for that family and a meaningless one across families, so the
// comparable flag is cleared and the UI can say so.
function chooseSample(family, coverage) {
  if ((family.subsets || []).includes('latin')) {
    return { text: LATIN_SAMPLE_TEXT, comparable: true }
  }
  if (!coverage) return { text: LATIN_SAMPLE_TEXT, comparable: false }

  const subsetNames = Object.keys(coverage)
  // primaryScript is a mix of script names and ISO 15924 codes ("Thai", but
  // also "Khmr", "Taml", "Laoo"), and it is empty for most families, so a name
  // match is tried first and the non-Latin subsets carry the rest.
  const script = (family.primaryScript || '').toLowerCase()
  const named = script ? subsetNames.filter((name) => name.toLowerCase() === script) : []
  const scriptSubsets = named.length > 0
    ? named
    : subsetNames.filter((name) => !NON_SCRIPT_SUBSETS.has(name))
  const source = scriptSubsets.length > 0 ? scriptSubsets : subsetNames.filter((name) => name !== 'menu')

  const codepoints = new Set()
  for (const name of source) {
    for (const codepoint of parseRanges(coverage[name])) codepoints.add(codepoint)
  }
  const letters = [...codepoints]
    .sort((left, right) => left - right)
    .filter(isLetterCodepoint)
    .slice(0, NON_LATIN_SAMPLE_LENGTH)

  if (letters.length < MINIMUM_SAMPLE_GLYPHS) return { text: LATIN_SAMPLE_TEXT, comparable: false }
  return { text: letters.map((codepoint) => String.fromCodePoint(codepoint)).join(''), comparable: false }
}

// Walks the weight ladder heaviest first and returns the first rung css2 will
// actually serve, with the gstatic URL it handed back.
async function findServableRung(family, sampleText) {
  let servedUrl = null
  let probes = 0
  const rung = await resolveLadder(weightLadder(family), async (candidate) => {
    probes += 1
    const url = `${CSS2_ENDPOINT}?family=${cssFamilyParam(family.family, candidate.weight, candidate.italic)}&text=${encodeURIComponent(sampleText)}`
    const response = await fetchWithRetry(url)
    // A weight the family does not have answers 400. A weight it declares but
    // cannot serve answers 200 with an empty body, which is the trap Roboto
    // Flex falls into. Both are misses, neither is an error.
    if (!response.ok) return false
    const match = GSTATIC_FONT_URL.exec(response.text)
    if (!match) return false
    servedUrl = match[1]
    return true
  })
  return { rung, servedUrl, probes }
}

async function downloadFont(fontUrl) {
  const response = await fetchWithRetry(fontUrl, { expect: 'bytes' })
  if (!response.ok) return { bytes: null, reason: `gstatic answered ${response.status}` }
  if (response.bytes.length > MAXIMUM_FONT_BYTES) {
    return { bytes: null, reason: `${formatBytes(response.bytes.length)} is over the ${formatBytes(MAXIMUM_FONT_BYTES)} cap` }
  }
  // The gstatic /l/font URL has served an HTML error page before, and an HTML
  // page fed to the glyph reader produces plausible nonsense instead of a
  // failure. Nothing gets measured that is not a real font file.
  if (!isSfnt(response.bytes)) {
    return { bytes: null, reason: `body is not a font (first bytes ${[...response.bytes.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('')})` }
  }
  return { bytes: response.bytes, reason: null }
}

async function measureFamily(family, cachedEntry, needs) {
  const result = {
    lastModified: family.lastModified,
    size: family.size,
    probeVersion: PROBE_VERSION,
    blacknessVersion: BLACKNESS_ALGO_VERSION,
    mask: cachedEntry?.mask ?? null,
    ratio: cachedEntry?.ratio ?? null,
    blackness: cachedEntry?.blackness ?? NO_BLACKNESS,
    comparable: cachedEntry?.comparable ?? false,
    weight: cachedEntry?.weight ?? null,
    italic: cachedEntry?.italic ?? false,
    requests: 0,
    problem: null,
  }

  let coverage = null
  if (needs.coverage || needs.blackness) {
    coverage = await fetchCoverage(family.family)
    result.requests += 1
  }

  if (needs.coverage) {
    const codepoints = unionCoverage(coverage)
    // Families that ship only Google's menu subset publish no coverage object
    // at all, so there is nothing to answer with and the catalog says so.
    result.mask = codepoints.size > 0 ? buildMask(codepoints, PROBE) : null
  }

  if (!needs.blackness) return result

  const sample = chooseSample(family, coverage)
  let fontBytes = null

  // An algorithm bump on an unchanged font should re-measure, not re-download.
  if (needs.reuseCachedFont && cachedEntry?.weight != null) {
    fontBytes = readCachedBytes(fontCacheName(family.family, cachedEntry.weight, cachedEntry.italic))
    if (fontBytes) {
      result.weight = cachedEntry.weight
      result.italic = cachedEntry.italic
    }
  }

  if (!fontBytes) {
    const served = await findServableRung(family, sample.text)
    result.requests += served.probes
    if (!served.rung) {
      const ladder = weightLadder(family).map((rung) => `${rung.weight}${rung.italic ? 'i' : ''}`).join('/')
      result.problem = { kind: 'ladder', detail: `no weight on the ladder produced a font (tried ${ladder})` }
      result.ratio = null
      result.blackness = NO_BLACKNESS
      result.comparable = false
      return result
    }
    const download = await downloadFont(served.servedUrl)
    result.requests += 1
    if (!download.bytes) {
      result.problem = { kind: 'font', detail: download.reason }
      result.ratio = null
      result.blackness = NO_BLACKNESS
      result.comparable = false
      return result
    }
    fontBytes = download.bytes
    result.weight = served.rung.weight
    result.italic = served.rung.italic
    writeCachedBytes(fontCacheName(family.family, result.weight, result.italic), fontBytes)
  }

  const ratio = measureInk(fontBytes, sample.text)
  if (ratio === null) {
    result.problem = { kind: 'glyphs', detail: `fewer than ${MINIMUM_SAMPLE_GLYPHS} sample glyphs resolved` }
    result.ratio = null
    result.blackness = NO_BLACKNESS
    result.comparable = false
    return result
  }

  result.ratio = ratio
  result.blackness = normalizeBlackness(ratio)
  result.comparable = sample.comparable
  return result
}

function computeFlags(family, measurement) {
  const colorCapabilities = family.colorCapabilities || []
  let flags = 0
  if (family.isNoto) flags |= FLAG_NOTO
  if (family.isBrandFont) flags |= FLAG_BRAND
  if ((family.axes || []).length > 0) flags |= FLAG_VARIABLE
  if ((family.subsets || []).includes('latin')) flags |= FLAG_HAS_LATIN
  if (colorCapabilities.includes('COLRV0')) flags |= FLAG_COLRV0
  if (colorCapabilities.includes('COLRV1')) flags |= FLAG_COLRV1
  if (colorCapabilities.includes('OTSVG')) flags |= FLAG_OTSVG
  if (measurement.blackness !== NO_BLACKNESS && measurement.comparable) flags |= FLAG_BLACKNESS_COMPARABLE
  return flags
}

function printHistogram(ratios) {
  console.log('\nRaw ink ratios')
  console.log('--------------')
  if (ratios.length === 0) {
    console.log('  no families measured')
    return
  }
  const buckets = new Array(HISTOGRAM_BUCKETS).fill(0)
  for (const ratio of ratios) {
    const bucket = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(ratio * HISTOGRAM_BUCKETS))
    buckets[bucket] += 1
  }
  const widest = Math.max(...buckets)
  for (let bucket = 0; bucket < HISTOGRAM_BUCKETS; bucket += 1) {
    const low = (bucket / HISTOGRAM_BUCKETS).toFixed(2)
    const high = ((bucket + 1) / HISTOGRAM_BUCKETS).toFixed(2)
    const bar = '#'.repeat(Math.round((buckets[bucket] / widest) * 50))
    console.log(`  ${low}-${high}  ${String(buckets[bucket]).padStart(5)}  ${bar}`)
  }
  const sorted = [...ratios].sort((left, right) => left - right)
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
  console.log(`  min ${sorted[0].toFixed(3)}  p01 ${percentile(0.01).toFixed(3)}  p50 ${percentile(0.5).toFixed(3)}  p99 ${percentile(0.99).toFixed(3)}  max ${sorted[sorted.length - 1].toFixed(3)}`)
  // Printed so the frozen anchors can be sanity-checked against the real
  // population once: they should sit just outside the measured spread, not
  // inside it, or the ends of the 0-100 scale get clipped flat.
  console.log(`  normalization anchors in use: LOW ${INK_LOW} HIGH ${INK_HIGH}`)
  const belowLow = ratios.filter((ratio) => ratio < INK_LOW).length
  const aboveHigh = ratios.filter((ratio) => ratio > INK_HIGH).length
  console.log(`  clipped at the ends: ${belowLow} below LOW, ${aboveHigh} above HIGH`)
}

async function main() {
  const startedAt = Date.now()
  ensureCacheDirectories()

  console.log('Google Fonts catalog build')
  console.log('==========================')
  console.log(`  list endpoint  ${LIST_ENDPOINT}`)

  const families = await fetchFamilyList()
  console.log(`  families       ${families.length}`)

  const previous = readCachedJson(CACHE_INDEX_NAME) || { families: {} }
  const previousFamilies = previous.families || {}

  const added = []
  const updated = []
  const work = []
  let cacheHits = 0

  for (const family of families) {
    const cachedEntry = previousFamilies[family.family]
    const fontUnchanged = Boolean(cachedEntry)
      && cachedEntry.lastModified === family.lastModified
      && cachedEntry.size === family.size
    const needsCoverage = !fontUnchanged || cachedEntry.probeVersion !== PROBE_VERSION
    const needsBlackness = !fontUnchanged || cachedEntry.blacknessVersion !== BLACKNESS_ALGO_VERSION

    if (!cachedEntry) added.push(family.family)
    else if (!fontUnchanged) updated.push(family.family)

    if (!needsCoverage && !needsBlackness) {
      cacheHits += 1
      continue
    }
    work.push({
      family,
      cachedEntry,
      needs: { coverage: needsCoverage, blackness: needsBlackness, reuseCachedFont: fontUnchanged },
    })
  }

  const removed = Object.keys(previousFamilies).filter(
    (name) => !families.some((family) => family.family === name),
  )

  console.log(`  cache hits     ${cacheHits}`)
  console.log(`  to fetch       ${work.length}`)
  if (work.length > 0) console.log(`  concurrency    ${CONCURRENCY_LIMIT}`)

  const measurements = new Map()
  let requestCount = 1 // the list endpoint
  const problems = []

  const results = await mapWithPool(
    work,
    CONCURRENCY_LIMIT,
    (item) => measureFamily(item.family, item.cachedEntry, item.needs),
    (settled, total) => {
      if (settled % 200 === 0 || settled === total) {
        console.log(`  measured       ${settled}/${total}  ${Math.round((Date.now() - startedAt) / 1000)}s`)
      }
    },
  )

  for (let index = 0; index < work.length; index += 1) {
    const { family } = work[index]
    const measurement = results[index]
    requestCount += measurement.requests
    measurements.set(family.family, measurement)
    if (measurement.problem) problems.push({ family: family.family, ...measurement.problem })
  }

  const builder = createCatalogBuilder()
  const nextCacheIndex = { algo: { blackness: BLACKNESS_ALGO_VERSION, probe: PROBE_VERSION }, families: {} }
  const ratios = []
  let measuredCount = 0
  let unmeasuredCount = 0

  for (const family of families) {
    const measurement = measurements.get(family.family) || previousFamilies[family.family]
    const resolved = measurement || {
      mask: null,
      ratio: null,
      blackness: NO_BLACKNESS,
      comparable: false,
      weight: null,
      italic: false,
    }
    const { roman, italic } = servableWeights(family)

    if (resolved.blackness === NO_BLACKNESS) unmeasuredCount += 1
    else {
      measuredCount += 1
      if (typeof resolved.ratio === 'number') ratios.push(resolved.ratio)
    }

    builder.addFamily({
      name: family.family,
      displayName: family.displayName || null,
      category: family.category,
      stroke: family.stroke || null,
      classifications: family.classifications || [],
      subsets: family.subsets || [],
      weights: roman,
      italics: italic,
      axes: family.axes || [],
      popularity: family.popularity,
      trending: family.trending,
      added: toDateInteger(family.dateAdded),
      modified: toDateInteger(family.lastModified),
      flags: computeFlags(family, resolved),
      script: family.primaryScript || '',
      blackness: resolved.blackness,
      mask: resolved.mask,
    })

    nextCacheIndex.families[family.family] = {
      lastModified: family.lastModified,
      size: family.size,
      probeVersion: PROBE_VERSION,
      blacknessVersion: BLACKNESS_ALGO_VERSION,
      mask: resolved.mask,
      ratio: resolved.ratio,
      blackness: resolved.blackness,
      comparable: resolved.comparable,
      weight: resolved.weight,
      italic: resolved.italic,
    }
  }

  const generated = today()
  const document = builder.build({
    generated,
    source: LIST_ENDPOINT,
    algo: { blackness: BLACKNESS_ALGO_VERSION, probe: PROBE_VERSION },
    probe: [...PROBE],
  })

  const serialized = JSON.stringify(document)
  const gzipped = gzipSync(serialized)
  const contentHash = createHash('sha1').update(serialized).digest('hex').slice(0, 8)
  const buildStamp = `${generated.replace(/-/g, '')}-${contentHash}`

  mkdirSync(dirname(CATALOG_OUTPUT_PATH), { recursive: true })
  writeFileSync(CATALOG_OUTPUT_PATH, `${serialized}\n`, 'utf8')

  mkdirSync(dirname(CATALOG_META_OUTPUT_PATH), { recursive: true })
  writeFileSync(CATALOG_META_OUTPUT_PATH, [
    '// Generated by scripts/build-data.mjs. Do not edit by hand.',
    '//',
    '// The catalog is fetched at runtime rather than bundled, so it downloads in',
    '// parallel with the app and caches on its own. BUILD_STAMP is the cache buster:',
    '// it carries a hash of the catalog itself, so the URL only changes when the',
    '// data does.',
    '',
    `export const SCHEMA_VERSION = ${SCHEMA_VERSION}`,
    "export const CATALOG_URL = './data/fonts.json'",
    `export const ALGO = Object.freeze({ blackness: ${BLACKNESS_ALGO_VERSION}, probe: ${PROBE_VERSION} })`,
    `export const EXPECTED_COUNT = ${document.count}`,
    `export const BUILD_STAMP = '${buildStamp}'`,
    '',
  ].join('\n'), 'utf8')

  writeCachedJson(CACHE_INDEX_NAME, nextCacheIndex)

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)

  console.log('\nRefresh summary')
  console.log('---------------')
  console.log(`  families        ${document.count}`)
  console.log(`  added           ${added.length}${added.length > 0 ? `  ${added.slice(0, 40).join(', ')}${added.length > 40 ? ` (+${added.length - 40} more)` : ''}` : ''}`)
  console.log(`  updated         ${updated.length}${updated.length > 0 ? `  ${updated.slice(0, 40).join(', ')}${updated.length > 40 ? ` (+${updated.length - 40} more)` : ''}` : ''}`)
  console.log(`  removed         ${removed.length}${removed.length > 0 ? `  ${removed.join(', ')}` : ''}`)
  console.log(`  cache hits      ${cacheHits}    misses ${work.length}`)
  console.log(`  requests        ${requestCount}`)
  console.log(`  blackness       ${measuredCount} measured, ${unmeasuredCount} unmeasurable`)
  console.log(`  mask palette    ${builder.maskCount} unique masks`)
  console.log(`  raw             ${formatBytes(serialized.length)} of ${formatBytes(RAW_BUDGET_BYTES)} budget${serialized.length > RAW_BUDGET_BYTES ? '  OVER' : ''}`)
  console.log(`  gzip            ${formatBytes(gzipped.length)} of ${formatBytes(GZIP_BUDGET_BYTES)} budget${gzipped.length > GZIP_BUDGET_BYTES ? '  OVER' : ''}`)
  console.log(`  build stamp     ${buildStamp}`)
  console.log(`  elapsed         ${elapsedSeconds}s`)

  if (problems.length > 0) {
    console.log('\nFamilies that could not be measured')
    console.log('-----------------------------------')
    for (const problem of problems) {
      console.log(`  ${problem.kind.padEnd(7)} ${problem.family}  ${problem.detail}`)
    }
  }

  printHistogram(ratios)

  console.log('\nRunning the verify gate')
  console.log('-----------------------')
  const verify = spawnSync(process.execPath, [join(PROJECT_ROOT, 'scripts', 'verify-data.mjs')], {
    stdio: 'inherit',
  })
  process.exit(verify.status ?? 1)
}

main().catch((error) => {
  console.error(`\nBuild failed: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
})
