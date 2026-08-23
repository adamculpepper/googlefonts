// Catalog fixture: 33 ordered checks over the committed public/data/fonts.json.
// Runs fully offline, so it is safe as a prebuild step and CI never touches
// Google.
//
//   node scripts/verify-data.mjs
import { existsSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  FIELDS,
  FLAG_BLACKNESS_COMPARABLE,
  FLAG_HAS_LATIN,
  FLAG_VARIABLE,
  EXCLUDED_SUBSET,
  ENUM_KEYS,
  NO_BLACKNESS,
  NO_COVERAGE,
  NO_STROKE,
  SCHEMA_VERSION,
  SLOT,
  decodeCatalog,
} from '../src/lib/catalog.js'
import {
  MASK_BYTE_LENGTH,
  PROBE,
  PROBE_VERSION,
  base64ToBytes,
  buildMask,
  parseRanges,
  testMask,
} from '../src/lib/coverage.js'
import { BLACKNESS_ALGO_VERSION, normalizeBlackness } from '../src/lib/font/blackness.js'
import { cssSpecFor, resolveLadder, servableWeights, weightLadder } from '../src/lib/weights.js'

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CATALOG_PATH = join(PROJECT_ROOT, 'public', 'data', 'fonts.json')
const CATALOG_META_PATH = join(PROJECT_ROOT, 'src', 'data', 'catalog-meta.js')

const RAW_BUDGET_BYTES = 400 * 1024
const GZIP_BUDGET_BYTES = 120 * 1024
const MINIMUM_FAMILY_COUNT = 1900
const LATIN_BLACKNESS_FLOOR = 0.95
const LATIN_COVERAGE_FLOOR = 0.98
// Google's popularity field carries a few genuine ties. The floor is here to
// catch the field degrading into something that is not a rank at all, not to
// insist on the uniqueness the data never had.
const DISTINCT_RANK_FLOOR = 0.99
const EXPECTED_PROBE_LENGTH = 489

const CYRILLIC_ZHE = 0x0416 // Ж, absent from any Latin-only family

// css2 reads the colon, comma and at sign as its own delimiters, and splits
// families on the ampersand and the pipe. A family name carrying one of those
// could not be requested at all. Spaces are fine: they percent-encode to %20,
// which is how every multi-word family name is requested.
const CSS2_DELIMITERS = /[:;,@&|]/

function hasControlCharacter(text) {
  for (const character of text) {
    const codepoint = character.codePointAt(0)
    if (codepoint < 0x20 || codepoint === 0x7f) return true
  }
  return false
}

let failures = 0
let checks = 0

function section(title) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
}

function check(label, passed, detail = '') {
  checks += 1
  if (!passed) failures += 1
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function isAscendingUnique(values) {
  return values.every((value, index) => index === 0 || value > values[index - 1])
}

function percentage(part, whole) {
  return whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(1)}%`
}

// A. The artifact ------------------------------------------------------------
section('A. Artifact')

const artifactExists = existsSync(CATALOG_PATH)
let rawBytes = null
let document = null
let parseError = null
if (artifactExists) {
  rawBytes = readFileSync(CATALOG_PATH)
  try {
    document = JSON.parse(rawBytes.toString('utf8'))
  } catch (error) {
    parseError = error
  }
}

check(
  'public/data/fonts.json exists and parses',
  Boolean(document),
  artifactExists ? (parseError ? parseError.message : `${statSync(CATALOG_PATH).size} bytes`) : 'file is missing',
)

if (!document) {
  console.log('\nFAILED  the catalog could not be read; run npm run data:refresh')
  process.exit(1)
}

const families = document.f || []
const records = decodeCatalog(document)
const byName = new Map(records.map((record) => [record.name, record]))
const latinFamilies = records.filter((record) => record.hasLatin)

check('schema version matches the library', document.v === SCHEMA_VERSION, `artifact v${document.v}, library v${SCHEMA_VERSION}`)

// Imported rather than pattern-matched as text, so this really is the module
// the app will bundle. A stale catalog-meta is the one failure the frontend
// could not detect on its own: it would cache-bust to the wrong URL and quietly
// serve yesterday's catalog.
let catalogMeta = null
if (existsSync(CATALOG_META_PATH)) {
  try {
    catalogMeta = await import(pathToFileURL(CATALOG_META_PATH).href)
  } catch {
    catalogMeta = null
  }
}
const metaAgrees = Boolean(catalogMeta)
  && catalogMeta.SCHEMA_VERSION === SCHEMA_VERSION
  && catalogMeta.ALGO?.blackness === BLACKNESS_ALGO_VERSION
  && catalogMeta.ALGO?.probe === PROBE_VERSION
  && catalogMeta.EXPECTED_COUNT === document.count
  && catalogMeta.CATALOG_URL === './data/fonts.json'
  && typeof catalogMeta.BUILD_STAMP === 'string'
  && catalogMeta.BUILD_STAMP.length > 0
check(
  'algorithm versions match the library constants and catalog-meta',
  document.algo?.blackness === BLACKNESS_ALGO_VERSION
    && document.algo?.probe === PROBE_VERSION
    && metaAgrees,
  `blackness ${document.algo?.blackness}, probe ${document.algo?.probe}, meta ${metaAgrees ? `agrees (stamp ${catalogMeta.BUILD_STAMP})` : 'disagrees'}`,
)

const gzippedBytes = gzipSync(rawBytes)
check(
  'catalog fits the byte budget',
  rawBytes.length < RAW_BUDGET_BYTES && gzippedBytes.length < GZIP_BUDGET_BYTES,
  `raw ${(rawBytes.length / 1024).toFixed(1)}KB of ${RAW_BUDGET_BYTES / 1024}KB, gzip ${(gzippedBytes.length / 1024).toFixed(1)}KB of ${GZIP_BUDGET_BYTES / 1024}KB`,
)

const generatedIsValid = /^\d{4}-\d{2}-\d{2}$/.test(document.generated || '')
  && !Number.isNaN(Date.parse(document.generated))
check('generated is a valid YYYY-MM-DD date', generatedIsValid, document.generated)

// B. Shape -------------------------------------------------------------------
section('B. Shape')

check(
  'count matches the record list and clears the floor',
  families.length === document.count && document.count >= MINIMUM_FAMILY_COUNT,
  `${document.count} families, floor ${MINIMUM_FAMILY_COUNT}`,
)

const wrongWidth = families.filter((tuple) => !Array.isArray(tuple) || tuple.length !== FIELDS.length)
check(
  `every record carries exactly ${FIELDS.length} slots`,
  wrongWidth.length === 0,
  wrongWidth.length > 0 ? `${wrongWidth.length} malformed` : '',
)

check(
  'the artifact field list matches catalog.js',
  Array.isArray(document.fields) && document.fields.join() === FIELDS.join(),
  (document.fields || []).join(','),
)

const names = families.map((tuple) => tuple[SLOT.name])
const emptyNames = names.filter((name) => typeof name !== 'string' || name.trim().length === 0 || name !== name.trim())
const unsafeNames = names.filter((name) => typeof name === 'string' && (CSS2_DELIMITERS.test(name) || hasControlCharacter(name)))
check(
  'family names are unique, non-empty and safe to put in a css2 request',
  new Set(names).size === names.length && emptyNames.length === 0 && unsafeNames.length === 0,
  `${new Set(names).size} unique${unsafeNames.length > 0 ? `, unsafe: ${unsafeNames.slice(0, 5).join(', ')}` : ''}`,
)

// C. Enums -------------------------------------------------------------------
section('C. Enums')

const enums = document.enums || {}
const inRange = (index, table) => Number.isInteger(index) && index >= 0 && index < table.length

const scalarEnumProblems = []
for (const tuple of families) {
  if (!inRange(tuple[SLOT.cat], enums.cat || [])) scalarEnumProblems.push(`${tuple[SLOT.name]} cat=${tuple[SLOT.cat]}`)
  if (!inRange(tuple[SLOT.scr], enums.scr || [])) scalarEnumProblems.push(`${tuple[SLOT.name]} scr=${tuple[SLOT.scr]}`)
  const stroke = tuple[SLOT.stroke]
  if (stroke !== NO_STROKE && !inRange(stroke, enums.stroke || [])) scalarEnumProblems.push(`${tuple[SLOT.name]} stroke=${stroke}`)
}
check(
  'category, script and stroke indices resolve',
  scalarEnumProblems.length === 0,
  scalarEnumProblems.slice(0, 4).join('; '),
)

const listEnumProblems = []
for (const tuple of families) {
  for (const index of tuple[SLOT.cls]) if (!inRange(index, enums.cls || [])) listEnumProblems.push(`${tuple[SLOT.name]} cls=${index}`)
  for (const index of tuple[SLOT.subs]) if (!inRange(index, enums.subs || [])) listEnumProblems.push(`${tuple[SLOT.name]} subs=${index}`)
  for (const axis of tuple[SLOT.axes]) if (!inRange(axis[0], enums.ax || [])) listEnumProblems.push(`${tuple[SLOT.name]} ax=${axis[0]}`)
}
// Sortedness is the offline half of a determinism guarantee that otherwise
// needs the network to test: upstream hands these back as unordered sets whose
// order really does vary between fetches, so an unsorted list here means a
// refresh that changed nothing would still rewrite the artifact.
const isSorted = (values) => values.every((value, index) => index === 0 || values[index - 1] <= value)
const unsortedSets = records.filter((record) => (
  !isSorted(record.classifications)
  || !isSorted(record.subsets)
  || !isSorted(record.axes.map((axis) => axis.tag))
))
check(
  'classification, subset and axis indices resolve, and each set is in stable sorted order',
  listEnumProblems.length === 0 && unsortedSets.length === 0,
  `${listEnumProblems.slice(0, 4).join('; ')}${unsortedSets.length > 0 ? `unsorted: ${unsortedSets.slice(0, 4).map((record) => record.name).join(', ')}` : ''}`,
)

const duplicatedEnums = ENUM_KEYS.filter((key) => {
  const values = enums[key] || []
  return new Set(values).size !== values.length
})
check(
  'no enum table repeats a value',
  duplicatedEnums.length === 0,
  ENUM_KEYS.map((key) => `${key}:${(enums[key] || []).length}`).join(' '),
)

check(
  `the subset enum drops "${EXCLUDED_SUBSET}"`,
  !(enums.subs || []).includes(EXCLUDED_SUBSET),
  (enums.subs || []).slice(0, 6).join(','),
)

// D. Weights and axes --------------------------------------------------------
section('D. Weights and axes')

const weightless = records.filter((record) => record.weights.length + record.italics.length === 0)
check(
  'every family declares at least one weight',
  weightless.length === 0,
  weightless.slice(0, 5).map((record) => record.name).join(', '),
)

const weightProblems = records.filter((record) => {
  const legal = (values) => values.every((weight) => Number.isInteger(weight) && weight >= 1 && weight <= 1000)
  return !legal(record.weights) || !legal(record.italics)
    || !isAscendingUnique(record.weights) || !isAscendingUnique(record.italics)
})
check(
  'weights are 1-1000, ascending and unique',
  weightProblems.length === 0,
  weightProblems.slice(0, 5).map((record) => `${record.name} [${record.weights.join(',')}]`).join('; '),
)

const variableFlagProblems = records.filter((record) => record.isVariable !== (record.axes.length >= 1))
check(
  'the variable flag agrees with the axis list',
  variableFlagProblems.length === 0,
  `${records.filter((record) => record.isVariable).length} variable families`,
)

const axisProblems = []
for (const record of records) {
  for (const axis of record.axes) {
    const ordered = Number.isFinite(axis.min) && Number.isFinite(axis.max) && Number.isFinite(axis.defaultValue)
      && axis.min <= axis.defaultValue && axis.defaultValue <= axis.max
    if (!ordered) axisProblems.push(`${record.name} ${axis.tag} ${axis.min}/${axis.defaultValue}/${axis.max}`)
  }
}
check('every axis reads min <= default <= max', axisProblems.length === 0, axisProblems.slice(0, 4).join('; '))

const weightAxisProblems = []
for (const record of records) {
  const weightAxis = record.axes.find((axis) => axis.tag === 'wght')
  if (!weightAxis) continue
  const outside = record.weights.filter((weight) => weight < weightAxis.min || weight > weightAxis.max)
  if (outside.length > 0) weightAxisProblems.push(`${record.name} ${outside.join(',')} outside ${weightAxis.min}-${weightAxis.max}`)
}
check(
  'declared weights sit inside the wght axis range',
  weightAxisProblems.length === 0,
  weightAxisProblems.slice(0, 4).join('; '),
)

// E. Blackness ---------------------------------------------------------------
section('E. Blackness')

const blacknessProblems = records.filter((record) => (
  !Number.isInteger(record.blackness)
  || (record.blackness !== NO_BLACKNESS && (record.blackness < 0 || record.blackness > 100))
))
check(
  'every blackness is an integer 0-100 or -1',
  blacknessProblems.length === 0,
  blacknessProblems.slice(0, 5).map((record) => `${record.name}=${record.blackness}`).join('; '),
)

const comparableWithoutMeasurement = records.filter(
  (record) => record.blackness === NO_BLACKNESS && record.blacknessComparable,
)
check(
  'an unmeasured family never claims a comparable score',
  comparableWithoutMeasurement.length === 0,
  comparableWithoutMeasurement.slice(0, 5).map((record) => record.name).join(', '),
)

const measuredLatin = latinFamilies.filter((record) => record.blackness !== NO_BLACKNESS)
check(
  `at least ${LATIN_BLACKNESS_FLOOR * 100}% of Latin families are measured`,
  measuredLatin.length >= latinFamilies.length * LATIN_BLACKNESS_FLOOR,
  `${measuredLatin.length}/${latinFamilies.length} (${percentage(measuredLatin.length, latinFamilies.length)})`,
)

const comparableWithoutLatin = records.filter((record) => record.blacknessComparable && !record.hasLatin)
check(
  'a comparable score always came from the shared Latin sample',
  comparableWithoutLatin.length === 0,
  comparableWithoutLatin.slice(0, 5).map((record) => record.name).join(', '),
)

const anton = byName.get('Anton')
const roboto = byName.get('Roboto')
const alfaSlabOne = byName.get('Alfa Slab One')
const raleway = byName.get('Raleway')
const anchorsPresent = Boolean(anton && roboto && alfaSlabOne && raleway)
check(
  'the blackness anchors hold: Anton is heavier than Roboto and Raleway, Alfa Slab One clears 80',
  anchorsPresent
    && anton.blackness > roboto.blackness
    && alfaSlabOne.blackness > 80
    && raleway.blackness < anton.blackness,
  anchorsPresent
    ? `Anton ${anton.blackness}, Roboto ${roboto.blackness}, Alfa Slab One ${alfaSlabOne.blackness}, Raleway ${raleway.blackness}`
    : 'an anchor family is missing from the catalog',
)

// F. Coverage ----------------------------------------------------------------
section('F. Coverage')

const probe = document.probe || []
check(
  `the probe holds ${EXPECTED_PROBE_LENGTH} codepoints in ascending order`,
  probe.length === EXPECTED_PROBE_LENGTH
    && probe.length === PROBE.length
    && isAscendingUnique(probe)
    && probe.every((codepoint, index) => codepoint === PROBE[index]),
  `${probe.length} codepoints, U+${probe[0]?.toString(16).toUpperCase().padStart(4, '0')} to U+${probe[probe.length - 1]?.toString(16).toUpperCase()}`,
)

const masks = document.masks || []
const wrongLengthMasks = masks.filter((mask) => base64ToBytes(mask).length !== MASK_BYTE_LENGTH)
check(
  `every mask decodes to ${MASK_BYTE_LENGTH} bytes`,
  wrongLengthMasks.length === 0,
  `${masks.length} masks in the palette`,
)

check(
  'the mask palette holds no duplicates',
  new Set(masks).size === masks.length,
  `${new Set(masks).size} unique of ${masks.length}`,
)

const badMaskIndices = families.filter((tuple) => {
  const index = tuple[SLOT.cov]
  return index !== NO_COVERAGE && !inRange(index, masks)
})
const latinWithCoverage = latinFamilies.filter((record) => record.mask !== null)
check(
  `mask indices resolve and at least ${LATIN_COVERAGE_FLOOR * 100}% of Latin families carry one`,
  badMaskIndices.length === 0 && latinWithCoverage.length >= latinFamilies.length * LATIN_COVERAGE_FLOOR,
  `${latinWithCoverage.length}/${latinFamilies.length} (${percentage(latinWithCoverage.length, latinFamilies.length)})`,
)

const notoSans = byName.get('Noto Sans')
const uppercaseAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const antonAlphabet = anton?.mask ? testMask(anton.mask, probe, uppercaseAlphabet) : null
const antonZhe = anton?.mask ? testMask(anton.mask, probe, String.fromCodePoint(CYRILLIC_ZHE)) : null
const notoZhe = notoSans?.mask ? testMask(notoSans.mask, probe, String.fromCodePoint(CYRILLIC_ZHE)) : null
check(
  'coverage spot-checks: Anton draws A-Z but not Cyrillic Ж, Noto Sans draws Ж',
  Boolean(antonAlphabet?.covered) && antonZhe?.covered === false && Boolean(notoZhe?.covered),
  `Anton A-Z ${antonAlphabet?.covered}, Anton Ж ${antonZhe?.covered}, Noto Sans Ж ${notoZhe?.covered}`,
)

// G. Dates and ranks ---------------------------------------------------------
section('G. Dates and ranks')

const dateProblems = []
const orderProblems = []
for (const record of records) {
  for (const [label, value] of [['added', record.added], ['modified', record.modified]]) {
    if (!Number.isInteger(value) || value < 19900101 || value > 21000101) {
      dateProblems.push(`${record.name} ${label}=${value}`)
    }
  }
  if (record.added > record.modified) orderProblems.push(`${record.name} ${record.added}>${record.modified}`)
}
check(
  'dates are YYYYMMDD integers in range and a family is never modified before it was added',
  dateProblems.length === 0 && orderProblems.length === 0,
  `${dateProblems.slice(0, 3).join('; ')}${orderProblems.length > 0 ? ` out of order: ${orderProblems.slice(0, 3).join('; ')}` : ''}`,
)

// Popularity was expected to be a unique rank and it is not: Google ships a
// handful of ties, all of them in the top ten, where an obscure family shares a
// rank with a famous one (Roboto with Basic at 2, Inter with Handjet at 5). It
// is their data and it is stable, so the check accepts it and names the pairs
// rather than failing.
//
// The consequence is real and belongs to the frontend, not here: sorting by
// popularity has to carry a deterministic tiebreaker, or those pairs swap
// places between renders and a shared permalink stops reproducing.
const rankProblems = records.filter((record) => !isPositiveInteger(record.popularity) || !isPositiveInteger(record.trending))
const popularityRanks = records.map((record) => record.popularity)
const distinctRanks = new Set(popularityRanks).size
const tiedRanks = [...new Map(
  records.map((record) => [record.popularity, records.filter((other) => other.popularity === record.popularity)]),
)].filter(([, tied]) => tied.length > 1)
const tieSummary = tiedRanks
  .sort((left, right) => left[0] - right[0])
  .map(([rank, tied]) => `${rank}: ${tied.map((record) => record.name).join(' + ')}`)
check(
  `popularity and trending are positive integers, and at least ${DISTINCT_RANK_FLOOR * 100}% of popularity ranks are distinct`,
  rankProblems.length === 0 && distinctRanks >= popularityRanks.length * DISTINCT_RANK_FLOOR,
  `${distinctRanks} distinct of ${popularityRanks.length}; ties at ${tieSummary.join(', ') || 'none'}`,
)

// H. Pure logic --------------------------------------------------------------
section('H. Pure logic')

const normalizationLadder = [0, 0.02, 0.05, 0.2, 0.4, 0.6, 0.75, 0.9, 1].map(normalizeBlackness)
check(
  'normalizeBlackness rises monotonically and clamps to 0-100 at both ends',
  normalizationLadder.every((value, index) => index === 0 || value >= normalizationLadder[index - 1])
    && normalizeBlackness(-1) === 0
    && normalizeBlackness(0.05) === 0
    && normalizeBlackness(0.75) === 100
    && normalizeBlackness(5) === 100,
  normalizationLadder.join(' '),
)

const sampleRanges = '0,13,32-126'
const sampleCodepoints = parseRanges(sampleRanges)
const sampleMask = buildMask(sampleCodepoints, PROBE)
const asciiResult = testMask(sampleMask, PROBE, 'Hello, world!')
const greekResult = testMask(sampleMask, PROBE, 'Δ')
const outsideResult = testMask(sampleMask, PROBE, '漢')
check(
  'parseRanges round-trips through buildMask and testMask',
  sampleCodepoints.has(13) && sampleCodepoints.has(126) && sampleCodepoints.size === 97
    && asciiResult.covered
    && greekResult.covered === false && greekResult.missing[0] === 0x0394
    && outsideResult.covered && outsideResult.unknown[0] === 0x6f22,
  `${sampleCodepoints.size} codepoints, ASCII covered ${asciiResult.covered}, Δ missing ${greekResult.missing.length === 1}, 漢 unknown ${outsideResult.unknown.length === 1}`,
)

// Buda ships one weight, Molle ships one italic and no roman at all, and Roboto
// Flex declares a 100-1000 axis while css2 serves exactly one instance of it.
// The ladder is what turns all three into a single measurable weight.
const budaLike = { fonts: { 300: {} }, axes: [] }
const molleLike = { fonts: { '400i': {} }, axes: [] }
const robotoFlexLike = {
  fonts: Object.fromEntries([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((weight) => [String(weight), {}])),
  axes: [{ tag: 'wght', min: 100, max: 1000, defaultValue: 400 }],
}

const budaWeights = servableWeights(budaLike)
const molleWeights = servableWeights(molleLike)
const budaRung = await resolveLadder(weightLadder(budaLike), () => true)
const molleRung = await resolveLadder(weightLadder(molleLike), () => true)
// Only 400 answers, exactly as the live endpoint behaves for Roboto Flex.
const robotoFlexRung = await resolveLadder(weightLadder(robotoFlexLike), (rung) => rung.weight === 400)

check(
  'the weight ladder resolves the three awkward shapes: Buda 300, Molle italic 400, Roboto Flex 400',
  budaWeights.roman.join() === '300' && budaWeights.italic.length === 0 && budaRung.weight === 300 && budaRung.italic === false
    && molleWeights.roman.length === 0 && molleWeights.italic.join() === '400'
    && molleRung.weight === 400 && molleRung.italic === true
    && cssSpecFor('Molle', molleRung.weight, molleRung.italic) === 'Molle:ital,wght@1,400'
    && robotoFlexRung.weight === 400
    && weightLadder(robotoFlexLike)[0].weight === 900,
  `Buda ${budaRung.weight}, Molle ${cssSpecFor('Molle', molleRung.weight, molleRung.italic)}, Roboto Flex ${robotoFlexRung.weight} after walking down from ${weightLadder(robotoFlexLike)[0].weight}`,
)

// ---------------------------------------------------------------------------
console.log(`\n${failures ? 'FAILED' : 'OK'}  ${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
