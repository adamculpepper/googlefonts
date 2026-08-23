// Which families are shown, in what order, and which page of them.
//
// Pure and allocation-shy: this runs on every keystroke over the whole
// catalog, so the comparisons are integer compares on fields the data pipeline
// precomputed and the string work is limited to folded keys the search index
// already built. No clock, no randomness, no DOM.
//
// The record shape this module is written against:
//   { name, slug, category, classifications, subsets, weights, italics,
//     axes: [{ tag, min, max, def }], popularity, trending, dateAdded,
//     flags, primaryScript, blackness, displayName }

import { foldText, foldedKeysFor } from './searchIndex.js'

// Bitfield packed by the data pipeline. A bitfield rather than booleans
// because it is one integer per family in a file the browser downloads.
export const FLAGS = Object.freeze({
  NOTO: 1,
  BRAND: 2,
  VARIABLE: 4,
  HAS_LATIN: 8,
  BLACKNESS_COMPARABLE: 128,
})

export const FLAG_NOTO = FLAGS.NOTO
export const FLAG_BRAND = FLAGS.BRAND
export const FLAG_VARIABLE = FLAGS.VARIABLE
export const FLAG_HAS_LATIN = FLAGS.HAS_LATIN
export const FLAG_BLACKNESS_COMPARABLE = FLAGS.BLACKNESS_COMPARABLE

// Blackness is measured ink coverage. -1 means the measurement was never taken
// for that family, which is not the same as thin.
const BLACKNESS_UNMEASURED = -1

export function hasFlag(record, flag) {
  return (Number(record?.flags) & flag) !== 0
}

function maxOf(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  let largest = 0
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > largest) largest = number
  }
  return largest
}

function weightAxisOf(record) {
  const axes = Array.isArray(record?.axes) ? record.axes : []
  return axes.find((axis) => axis && axis.tag === 'wght') ?? null
}

function isVariable(record) {
  // The flag is the pipeline's answer, but a record that carries axes and no
  // flag is still obviously variable, so either one is taken as a yes.
  return hasFlag(record, FLAGS.VARIABLE) || (Array.isArray(record?.axes) && record.axes.length > 0)
}

// Lenient on purpose. A recorded primary script is trusted when it is there;
// when it is missing, an empty script is not evidence that a family is written
// in something other than Latin, so the Latin flag decides instead. Being
// wrong in the other direction would hide a usable font behind a filter that
// is ON by default, which is this app's worst failure mode.
function isLatinFamily(record) {
  const script = typeof record?.primaryScript === 'string' ? record.primaryScript.trim().toLowerCase() : ''
  // Google's metadata has carried both the word and the ISO 15924 code;
  // accepting either keeps a Latin-primary family from being hidden by a
  // filter that is ON by default just because the upstream spelling moved.
  if (script.length > 0) return script === 'latin' || script === 'latn'
  return hasFlag(record, FLAGS.HAS_LATIN)
}

function meetsMinWeight(record, minWeight, axisCountsForMin) {
  if (minWeight <= 0) return true
  if (Math.max(maxOf(record?.weights), maxOf(record?.italics)) >= minWeight) return true
  if (!axisCountsForMin) return false
  const axis = weightAxisOf(record)
  return Boolean(axis) && Number(axis.max) >= minWeight
}

function measuredBlackness(record) {
  const value = Number(record?.blackness)
  return Number.isFinite(value) ? value : BLACKNESS_UNMEASURED
}

// inputs: { q, category: string[], variableOnly, hasItalic, hideNoto, latinOnly,
//           supportsText, minWeight: 'any' | '500' ... '900', axisCountsForMin,
//           blacknessMin, blacknessMax, listSlugs: Set | null }
//
// coversText: (record) => true | false | null. null means the coverage data
// cannot answer for that record, and unknown keeps the family: a filter that
// is ON by default may not hide a font on a guess. Called only when
// inputs.supportsText is true, and called last, because it is the most
// expensive question here.
export function filterFamilies(records, inputs = {}, coversText = null) {
  if (!Array.isArray(records) || records.length === 0) return []

  const foldedQuery = foldText(inputs.q ?? '')
  const categories = new Set(
    (Array.isArray(inputs.category) ? inputs.category : []).map((value) => String(value).toLowerCase()),
  )
  const minWeight = inputs.minWeight && inputs.minWeight !== 'any' ? Number(inputs.minWeight) : 0
  const axisCountsForMin = inputs.axisCountsForMin !== false
  const blacknessMin = Number.isFinite(inputs.blacknessMin) ? inputs.blacknessMin : 0
  const blacknessMax = Number.isFinite(inputs.blacknessMax) ? inputs.blacknessMax : 100
  // Skipped entirely at the full range, which is where the sliders sit almost
  // all of the time.
  const blacknessNarrowed = blacknessMin > 0 || blacknessMax < 100
  const listSlugs = inputs.listSlugs instanceof Set ? inputs.listSlugs : null
  const checksCoverage = inputs.supportsText === true && typeof coversText === 'function'

  const kept = []
  for (const record of records) {
    if (!record) continue
    if (listSlugs && !listSlugs.has(record.slug)) continue
    if (inputs.hideNoto && hasFlag(record, FLAGS.NOTO)) continue
    if (categories.size > 0 && !categories.has(String(record.category ?? '').toLowerCase())) continue
    if (inputs.variableOnly && !isVariable(record)) continue
    if (inputs.hasItalic && !(Array.isArray(record.italics) && record.italics.length > 0)) continue
    if (inputs.latinOnly && !isLatinFamily(record)) continue
    if (!meetsMinWeight(record, minWeight, axisCountsForMin)) continue

    if (blacknessNarrowed) {
      const blackness = measuredBlackness(record)
      // An unmeasured family passes both ends of the range. Hiding a font
      // because of a measurement we failed to take would blame the font for
      // our own gap in the data.
      if (blackness >= 0 && (blackness < blacknessMin || blackness > blacknessMax)) continue
    }

    if (foldedQuery && !foldedKeysFor(record).search.includes(foldedQuery)) continue
    if (checksCoverage && coversText(record) === false) continue

    kept.push(record)
  }
  return kept
}

// popularity and trending arrive from Google's metadata as RANKS, where 1 is
// the top of the list. A missing or non-positive rank sorts last rather than
// first, which is what an unranked family deserves and what stops a zero from
// winning the whole page.
function rankOf(value) {
  const rank = Number(value)
  return Number.isFinite(rank) && rank > 0 ? rank : Infinity
}

function numberOf(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function styleCount(record) {
  const weights = Array.isArray(record?.weights) ? record.weights.length : 0
  const italics = Array.isArray(record?.italics) ? record.italics.length : 0
  return weights + italics
}

// Subtraction would answer NaN when two unmeasured families meet at Infinity,
// and NaN in a comparator silently scrambles the sort.
function compareNumbers(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareText(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sortKeyOf(record) {
  return foldedKeysFor(record).sort
}

// Ties break by popularity and then by name, so two families that are equal on
// the chosen axis always land in the same order. Without it a re-sort after a
// filter change would shuffle equal rows under the reader.
function breakTie(left, right) {
  const byPopularity = compareNumbers(rankOf(left.popularity), rankOf(right.popularity))
  if (byPopularity !== 0) return byPopularity
  const byName = compareText(sortKeyOf(left), sortKeyOf(right))
  if (byName !== 0) return byName
  return compareText(String(left.slug ?? ''), String(right.slug ?? ''))
}

const COMPARATORS = {
  popularity: (left, right) => compareNumbers(rankOf(left.popularity), rankOf(right.popularity)),
  trending: (left, right) => compareNumbers(rankOf(left.trending), rankOf(right.trending)),
  newest: (left, right) => compareNumbers(numberOf(right.dateAdded), numberOf(left.dateAdded)),
  'name-az': (left, right) => compareText(sortKeyOf(left), sortKeyOf(right)),
  'name-za': (left, right) => compareText(sortKeyOf(right), sortKeyOf(left)),
  // Unmeasured blackness sorts last in BOTH directions, so it is mapped to the
  // losing end of whichever direction is running.
  'blackness-desc': (left, right) => compareNumbers(
    blacknessOr(right, -Infinity),
    blacknessOr(left, -Infinity),
  ),
  'blackness-asc': (left, right) => compareNumbers(
    blacknessOr(left, Infinity),
    blacknessOr(right, Infinity),
  ),
  'weights-desc': (left, right) => compareNumbers(styleCount(right), styleCount(left)),
}

function blacknessOr(record, missing) {
  const blackness = measuredBlackness(record)
  return blackness >= 0 ? blackness : missing
}

// mulberry32: 32 bits of state, one multiply-shift round, good enough for a
// shuffle and small enough to read. Seeded rather than Math.random because the
// seed rides the share URL, which is what makes a random order somebody liked
// reproducible from their link.
export function mulberry32(seed) {
  let state = Number(seed) >>> 0
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(records, shuffleSeed) {
  const order = [...records]
  const nextRandom = mulberry32(shuffleSeed)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(nextRandom() * (index + 1))
    const held = order[index]
    order[index] = order[swap]
    order[swap] = held
  }
  return order
}

// Returns a new array; the caller's list is never reordered in place, because
// the decoded catalog is shared by everything on the page.
export function sortFamilies(records, sort = 'popularity', shuffleSeed = 1) {
  if (!Array.isArray(records)) return []
  if (records.length < 2) return [...records]
  if (sort === 'random') return shuffled(records, shuffleSeed)

  const comparator = COMPARATORS[sort] ?? COMPARATORS.popularity
  return [...records].sort((left, right) => {
    const primary = comparator(left, right)
    return primary !== 0 ? primary : breakTie(left, right)
  })
}

// pageSize: '24' | '48' | '96' | '192' | 'all'. Anything unreadable is treated
// as 'all', because showing everything is the failure that a reader can see
// and recover from, while showing nothing looks like a broken catalog.
export function sliceForView(records, pageSize = 'all', page = 1) {
  const all = Array.isArray(records) ? records : []
  const size = Math.trunc(Number(pageSize))
  if (!Number.isFinite(size) || size < 1) {
    return { pageRecords: all, pageCount: 1, clampedPage: 1 }
  }

  // An empty result set is still one page, so the pager has something to draw
  // and the page number in the share URL stays legal.
  const pageCount = Math.max(1, Math.ceil(all.length / size))
  const requested = Math.trunc(Number(page))
  const clampedPage = Math.min(Math.max(Number.isFinite(requested) ? requested : 1, 1), pageCount)
  const start = (clampedPage - 1) * size
  return { pageRecords: all.slice(start, start + size), pageCount, clampedPage }
}
