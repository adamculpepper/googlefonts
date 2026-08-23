// Blackness: one 0-100 number per family for how heavy its heaviest servable
// weight draws.
//
// Google's own metadata carries a per-weight `thickness`, but it is null for
// thousands of entries, so the catalog measures its own from real outlines.

import { parseSfnt } from './sfnt.js'
import { inkRatio } from './raster.js'

export const BLACKNESS_ALGO_VERSION = 1

// The sample the Latin families are measured on. It is the classic type-design
// proof string: round, square, diagonal and vertical shapes in one word, so the
// ink ratio reflects the whole letterform system rather than one letter's quirk.
export const LATIN_SAMPLE_TEXT = 'HAMBURGEFONTSIV'

// Fewer than three glyphs is not a measurement, it is one letter's accident.
export const MINIMUM_SAMPLE_GLYPHS = 3

// These two constants are frozen as blackness algorithm version 1, and they are
// fixed numbers on purpose.
//
// The obvious alternative — normalising against the percentile of the measured
// population — would be prettier on any single build and wrong across builds:
// Google adds families every month, so every score in the catalog would shift
// slightly on every refresh. A saved filter of "blackness above 70", or a shared
// link carrying one, would quietly come to mean something different. Fixed
// anchors mean a family's score only moves when the font itself moves.
//
// The values come from the measured spread of the whole catalog: 0.05 sits just
// under the lightest hairline faces and 0.75 just over the heaviest slabs, so
// the interesting middle of the population spends the full 0 to 100 range.
export const INK_LOW = 0.05
export const INK_HIGH = 0.75

function clamp(value, lowest, highest) {
  return Math.min(highest, Math.max(lowest, value))
}

// Returns the raw ink ratio, or null when the font cannot answer honestly:
// wrong outline flavour, no character map, or too few of the sample characters
// present in this subset.
export function measureInk(ttfBuffer, sampleText = LATIN_SAMPLE_TEXT) {
  let font
  try {
    font = parseSfnt(ttfBuffer)
  } catch {
    return null
  }
  if (!font.hasGlyfOutlines || !font.hasCharacterMap) return null

  const glyphs = []
  const seenGlyphIds = new Set()
  for (const character of sampleText) {
    const glyphId = font.glyphIdForCodepoint(character.codePointAt(0))
    // Glyph 0 is .notdef, the tofu box. Counting it would score every font
    // that lacks the sample identically and quite heavily.
    if (glyphId === 0 || seenGlyphIds.has(glyphId)) continue
    const contours = font.glyphOutline(glyphId)
    if (contours.length === 0) continue
    seenGlyphIds.add(glyphId)
    glyphs.push({ contours, advance: font.advanceWidth(glyphId) })
  }

  if (glyphs.length < MINIMUM_SAMPLE_GLYPHS) return null
  const ratio = inkRatio(glyphs)
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

export function normalizeBlackness(ratio) {
  if (!Number.isFinite(ratio)) return 0
  return clamp(Math.round((100 * (ratio - INK_LOW)) / (INK_HIGH - INK_LOW)), 0, 100)
}
