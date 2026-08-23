// Runtime coverage probe: does this loaded face actually have glyphs for the
// text, or is it drawing .notdef boxes? The css2 response cannot answer this
// (verified: Google returns a face with the requested unicode-range even when
// the font has none of those glyphs), and the catalog masks only cover the
// build-time probe set. This canvas check is the last line of truth.
//
// Method: measure a character that no real font maps (U+F8FF, private use)
// as the .notdef reference, then measure each unique character of the text.
// A character whose full TextMetrics tuple matches the reference within
// epsilon is missing. Fonts with a BLANK .notdef would make everything look
// present, so the reference must have visible ink before the probe is
// trusted; otherwise the answer is 'unknown' and the caller falls back to
// the catalog masks.

const REFERENCE_CHARACTER = '\uF8FF'
const PROBE_FONT_SIZE = 100
const EPSILON = 0.5

let sharedContext = null

function getContext() {
  if (sharedContext) return sharedContext
  if (typeof document === 'undefined') return null
  // A detached canvas still resolves families registered on document.fonts;
  // it never needs to enter the DOM.
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 150
  sharedContext = canvas.getContext('2d', { willReadFrequently: false })
  return sharedContext
}

function metricsTuple(context, character) {
  const metrics = context.measureText(character)
  return [
    metrics.width,
    metrics.actualBoundingBoxLeft || 0,
    metrics.actualBoundingBoxRight || 0,
    metrics.actualBoundingBoxAscent || 0,
    metrics.actualBoundingBoxDescent || 0,
  ]
}

function sameTuple(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > EPSILON) return false
  }
  return true
}

function hasInk(tuple) {
  const [, left, right, ascent, descent] = tuple
  return left + right > EPSILON || ascent + descent > EPSILON
}

// -> { coverage: 'full' | 'partial' | 'none' | 'unknown', missingChars: string[] }
export function probeCoverage(fontAlias, text) {
  const context = getContext()
  if (!context || !text) return { coverage: 'unknown', missingChars: [] }

  context.font = `${PROBE_FONT_SIZE}px "${fontAlias}"`
  const reference = metricsTuple(context, REFERENCE_CHARACTER)
  if (!hasInk(reference)) return { coverage: 'unknown', missingChars: [] }

  const uniqueCharacters = [...new Set([...text])].filter((character) => character.trim() !== '')
  if (uniqueCharacters.length === 0) return { coverage: 'full', missingChars: [] }

  const missingChars = []
  for (const character of uniqueCharacters) {
    if (sameTuple(metricsTuple(context, character), reference)) missingChars.push(character)
  }

  if (missingChars.length === 0) return { coverage: 'full', missingChars }
  if (missingChars.length === uniqueCharacters.length) return { coverage: 'none', missingChars }
  return { coverage: 'partial', missingChars }
}
