// The snippet builders behind the detail panel's embed blocks: what a person
// pastes into their own site to get this font.
//
// Pure by contract, same rule as fontUrl.js: no DOM, no network, no clock. A
// string goes in, a string comes out, so the snippets can be diffed in a test
// without a browser.
//
// Two facts about these URLs that are easy to get wrong later:
//
// - display=swap is correct HERE and wrong inside the app. The app requests
//   display=block because the grid holds a skeleton until a face resolves and
//   must never flash a fallback. A visitor to somebody else's site has no
//   skeleton, so blocking text on a font download is the worse trade. Do not
//   "fix" this to match buildCss2Url.
//
// - The 'ital,' axis prefix appears only when an italic tuple is actually being
//   requested. fontUrl.js reached the same shape against the live endpoint, and
//   a spec css2 dislikes is dropped SILENTLY (200, family missing), which in a
//   snippet means a stranger's site quietly renders in Arial. When in doubt,
//   emit the narrower form that is known to work.

import { CSS2_ENDPOINT, MAX_REQUESTED_WEIGHT, familySlug, resolveWeight } from './fontUrl.js'

const DEFAULT_WEIGHT = 400

// The generic family a stack falls back to while the webfont is in flight, or
// forever if it never arrives. Display faces fall back to serif rather than to
// a generic display face, because there is no such generic.
export const CSS_FALLBACK_BY_CATEGORY = {
  'Sans Serif': 'sans-serif',
  Serif: 'serif',
  Display: 'serif',
  Handwriting: 'cursive',
  Monospace: 'monospace',
}

const DEFAULT_FALLBACK = 'sans-serif'

const PRECONNECT_LINES = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
]

// Spaces become '+', which is what css2 and the specimen site both want. No
// other character in the Google Fonts catalog needs escaping, and percent
// encoding the whole fragment would destroy the ':' '@' ';' and ',' that carry
// its meaning.
export function urlFamilyName(name) {
  return String(name ?? '').trim().replace(/\s+/g, '+')
}

export function googleFontsSpecimenUrl(name) {
  return `https://fonts.google.com/specimen/${urlFamilyName(name)}`
}

function sortedWeights(values) {
  if (!Array.isArray(values)) return []
  const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  return [...new Set(numbers)].sort((left, right) => left - right)
}

// The weight axis as a requestable range, or null when the family has no
// continuous weight to ask for. Capped at 900 because css2 refuses more, so a
// 1000-max family such as Roboto Flex is requested at the range it will
// actually be served rather than at the range it declares.
export function variableWeightRange(record) {
  if (!record?.isVariable) return null
  const axis = (Array.isArray(record.axes) ? record.axes : []).find((entry) => entry?.tag === 'wght')
  if (!axis) return null
  const min = Number(axis.min)
  const max = Number(axis.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  return { min, max: Math.min(max, MAX_REQUESTED_WEIGHT) }
}

// Snapping matters even in a snippet: asking css2 for a weight the family does
// not ship gets the family dropped silently, so the URL asks for the nearest
// real weight and the CSS block below reports that same number.
function snapWeight(available, requested) {
  if (available.length === 0) return DEFAULT_WEIGHT
  const resolved = resolveWeight({ weights: available, italics: [], axes: [] }, requested, false)
  return resolved.cssWeight
}

// css2 wants axis names sorted alphabetically with custom (uppercase) axes
// ahead of the registered lowercase ones.
function compareAxisTags(left, right) {
  const leftCustom = /[A-Z]/.test(left)
  const rightCustom = /[A-Z]/.test(right)
  if (leftCustom !== rightCustom) return leftCustom ? -1 : 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

// Axes the user actually dragged, other than the two the URL already speaks
// for. They have to ride along in the request: Google serves a file pinned to
// the axes you asked for, so a font-variation-settings line for an axis that
// was never requested is a line that does nothing on the user's site.
function movedRangeAxes(record, state) {
  const moved = state?.movedAxes && typeof state.movedAxes === 'object' ? state.movedAxes : {}
  const tags = new Set(Object.keys(moved).filter((tag) => tag !== 'wght' && tag !== 'ital'))
  return (Array.isArray(record?.axes) ? record.axes : [])
    .filter((axis) => tags.has(axis?.tag) && Number(axis.max) > Number(axis.min))
    .sort((left, right) => compareAxisTags(left.tag, right.tag))
}

// One family= fragment for the current UI state.
//
// Static: the current weight, plus the italic position only when italic is
// asked for and exists. Variable: the whole weight range, with both italic
// positions whenever the family ships italics, so the toggle on the reader's
// own site costs no second download.
export function familyRequestSpec(record, state = {}) {
  const name = urlFamilyName(record?.name)
  const range = variableWeightRange(record)
  const romanWeights = sortedWeights(record?.weights)
  const italicWeights = sortedWeights(record?.italics)
  const requested = Number.isFinite(Number(state?.weight)) ? Number(state.weight) : DEFAULT_WEIGHT
  const wantItalic = Boolean(state?.italic) && italicWeights.length > 0

  let romanValue = null
  let italicValue = null
  if (range) {
    const text = `${range.min}..${range.max}`
    if (romanWeights.length > 0 || italicWeights.length === 0) romanValue = text
    if (italicWeights.length > 0) italicValue = text
  } else {
    if (romanWeights.length > 0) romanValue = String(snapWeight(romanWeights, requested))
    if (italicWeights.length > 0 && (wantItalic || romanWeights.length === 0)) {
      italicValue = String(snapWeight(italicWeights, requested))
    }
  }

  const positions = []
  if (romanValue !== null) positions.push({ ital: 0, wght: romanValue })
  if (italicValue !== null) positions.push({ ital: 1, wght: italicValue })
  // A catalog record with no weights at all should not exist, but a snippet
  // that says nothing is worse than one that says 400.
  if (positions.length === 0) positions.push({ ital: 0, wght: String(DEFAULT_WEIGHT) })

  const extras = movedRangeAxes(record, state)
  const useItalAxis = positions.some((position) => position.ital === 1)
  const tags = [...(useItalAxis ? ['ital'] : []), ...extras.map((axis) => axis.tag), 'wght'].sort(
    compareAxisTags,
  )
  const tuples = positions.map((position) =>
    tags
      .map((tag) => {
        if (tag === 'ital') return String(position.ital)
        if (tag === 'wght') return position.wght
        const axis = extras.find((entry) => entry.tag === tag)
        return `${axis.min}..${axis.max}`
      })
      .join(','),
  )

  return `${name}:${tags.join(',')}@${tuples.join(';')}`
}

export function embedUrl(record, state = {}) {
  return `${CSS2_ENDPOINT}?family=${familyRequestSpec(record, state)}&display=swap`
}

// The two preconnects are not decoration. The stylesheet lives on one host and
// the font binaries on another, so without them the browser opens the second
// connection only after it has parsed the CSS.
export function linkSnippet(record, state = {}) {
  return [...PRECONNECT_LINES, `<link href="${embedUrl(record, state)}" rel="stylesheet">`].join('\n')
}

export function importSnippet(record, state = {}) {
  return `@import url('${embedUrl(record, state)}');`
}

// Fontsource mirrors Google Fonts on npm, which is how you self-host without
// building a pipeline. The package name follows a convention rather than an
// index we hold, so the caveat travels with the snippet.
export function fontsourceSnippet(record) {
  const slug = familySlug(record?.name)
  const packageName = record?.isVariable ? `@fontsource-variable/${slug}` : `@fontsource/${slug}`
  const url = `https://www.npmjs.com/package/${packageName}`
  const code = `npm install ${packageName}\n\nimport '${packageName}'`
  const caveatText =
    'This package name follows the Fontsource naming convention rather than a list we hold, so check it exists before you install:'
  return { code, caveatText, caveat: `${caveatText} ${url}`, url, packageName }
}

// Trims 0.005 to "0.005" and 0.120 to "0.12" without ever printing "0.0000001".
function formatNumber(value, decimals) {
  const text = Number(value).toFixed(decimals)
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

export function cssSnippet(record, state = {}) {
  const fallback = CSS_FALLBACK_BY_CATEGORY[record?.category] || DEFAULT_FALLBACK
  const range = variableWeightRange(record)
  const romanWeights = sortedWeights(record?.weights)
  const italicWeights = sortedWeights(record?.italics)
  const requested = Number.isFinite(Number(state?.weight)) ? Number(state.weight) : DEFAULT_WEIGHT
  const wantItalic = Boolean(state?.italic) && italicWeights.length > 0
  const available = wantItalic ? italicWeights : romanWeights

  const moved = state?.movedAxes && typeof state.movedAxes === 'object' ? state.movedAxes : {}
  // A dragged weight axis is reported as font-weight, not as a variation
  // setting. The two render identically (CSS Fonts 4 maps any font-weight onto
  // the wght axis), but a block carrying both would name two different numbers
  // for one thing, and the one a reader would delete as redundant is the one
  // that was actually winning.
  const movedWeight = range && Number.isFinite(Number(moved.wght)) ? Number(moved.wght) : null

  // The same number the URL above asked for. A CSS block naming a weight the
  // stylesheet never fetched would leave the browser to fake it.
  const weight = range
    ? Math.min(Math.max(movedWeight ?? requested, range.min), range.max)
    : snapWeight(available, requested)

  const lines = [`  font-family: '${record?.name}', ${fallback};`, `  font-weight: ${weight};`]
  if (wantItalic) lines.push('  font-style: italic;')

  const tracking = Number(state?.tracking) || 0
  // Thousandths of an em, so the spacing scales with whatever size it is set
  // at rather than pinning to one pixel value.
  if (tracking !== 0) lines.push(`  letter-spacing: ${formatNumber(tracking / 1000, 3)}em;`)

  const movedTags = Object.keys(moved)
    .filter((tag) => Number.isFinite(Number(moved[tag])))
    .filter((tag) => !(tag === 'wght' && movedWeight !== null))
    .sort(compareAxisTags)
  if (movedTags.length > 0) {
    const settings = movedTags.map((tag) => `'${tag}' ${formatNumber(moved[tag], 2)}`).join(', ')
    lines.push(`  font-variation-settings: ${settings};`)
  }

  return `.your-brand {\n${lines.join('\n')}\n}`
}
