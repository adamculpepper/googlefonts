// The detail panel's own font loader, deliberately separate from the grid's
// font manager.
//
// The manager loads ONE weight of a family, subsetted to the preview text,
// because that is what 48 cards on a screen can afford. The panel is the
// opposite situation: one family, every weight, the whole character set, so a
// weight ladder and a punctuation block have something to draw. Trying to make
// the manager serve both would mean teaching it a second lifetime and a second
// eviction rule for one consumer.
//
// Two rules this file keeps:
//
// - Only the faces that cover Basic Latin are registered. A css2 response with
//   no text= carries one @font-face per SUBSET per weight (latin, latin-ext,
//   cyrillic, greek, vietnamese), which for a nine-weight family is around
//   fifty downloads for a panel that shows Latin. The Latin subset already
//   covers everything the panel draws, currency signs included.
//
// - Registration is refcounted. React StrictMode mounts, unmounts and remounts
//   the panel, so a plain "release on unmount" would delete the faces the
//   second mount is about to draw with.

import { CSS2_ENDPOINT, familySlug, parseFaces } from './fontUrl.js'
import { urlFamilyName, variableWeightRange } from './embedSnippets.js'

const FULL_ALIAS_PREFIX = 'gf_full_'
const DEFAULT_WEIGHT = 400

// 'A'. Any face that can draw it is the Latin subset of this family.
const LATIN_PROBE = 0x41

// slug -> { promise, count, handle }
const entries = new Map()

const fontSet = typeof document !== 'undefined' ? document.fonts : null

function sortedWeights(values) {
  if (!Array.isArray(values)) return []
  const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  return [...new Set(numbers)].sort((left, right) => left - right)
}

// Every weight the family has, in one family= fragment. Semicolon tuples for a
// static family, the whole range for a variable one, and both italic positions
// whenever italics exist, since the ladder can be flipped without a refetch.
export function fullFamilySpec(record) {
  const name = urlFamilyName(record?.name)
  const range = variableWeightRange(record)
  const roman = sortedWeights(record?.weights)
  const italic = sortedWeights(record?.italics)

  if (range) {
    const text = `${range.min}..${range.max}`
    if (italic.length === 0) return `${name}:wght@${text}`
    if (roman.length === 0) return `${name}:ital,wght@1,${text}`
    return `${name}:ital,wght@0,${text};1,${text}`
  }

  if (italic.length === 0) {
    const list = roman.length > 0 ? roman : [DEFAULT_WEIGHT]
    return `${name}:wght@${list.join(';')}`
  }

  // Tuples ascend: every roman position before every italic one, weights
  // ascending inside each.
  const tuples = [...roman.map((weight) => `0,${weight}`), ...italic.map((weight) => `1,${weight}`)]
  return `${name}:ital,wght@${tuples.join(';')}`
}

// Reads a unicode-range value well enough to answer one question: can this
// face draw this codepoint. Handles the three forms css2 emits, which are
// U+41, U+0-FF and the wildcard U+30??.
function coversCodepoint(unicodeRange, codepoint) {
  if (!unicodeRange) return true
  for (const token of unicodeRange.split(',')) {
    const text = token.trim().replace(/^u\+/i, '')
    if (text.length === 0) continue
    if (text.includes('?')) {
      const low = Number.parseInt(text.replace(/\?/g, '0'), 16)
      const high = Number.parseInt(text.replace(/\?/g, 'F'), 16)
      if (Number.isFinite(low) && codepoint >= low && codepoint <= high) return true
      continue
    }
    const [startText, endText] = text.split('-')
    const start = Number.parseInt(startText, 16)
    const end = endText === undefined ? start : Number.parseInt(endText, 16)
    if (Number.isFinite(start) && Number.isFinite(end) && codepoint >= start && codepoint <= end) {
      return true
    }
  }
  return false
}

async function registerFullFamily(record, slug) {
  // No text= on purpose: this is the one request in the app that wants the
  // whole character set rather than the typed word.
  const url = `${CSS2_ENDPOINT}?family=${fullFamilySpec(record)}&display=block`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`css2 responded ${response.status} for ${record?.name}`)

  const parsed = parseFaces(await response.text())
  // Keyed by the font-family value in the response. One family was requested,
  // so any entry present is this family; the fallback covers a name that came
  // back spelled differently from the catalog's.
  const descriptors = parsed.get(record?.name) ?? [...parsed.values()][0] ?? []
  if (descriptors.length === 0) throw new Error(`css2 returned no faces for ${record?.name}`)

  const latin = descriptors.filter((descriptor) => coversCodepoint(descriptor.unicodeRange, LATIN_PROBE))
  // A family with no Latin at all (a Devanagari or CJK face) still deserves a
  // panel, so fall back to everything it sent rather than to nothing.
  const chosen = latin.length > 0 ? latin : descriptors

  const alias = `${FULL_ALIAS_PREFIX}${slug}`
  const faces = []
  for (const descriptor of chosen) {
    // unicodeRange is omitted for the same reason the grid omits it: a missing
    // character should draw this font's own .notdef box rather than silently
    // fall through to the next font in the stack and hide the gap.
    const face = new FontFace(alias, descriptor.src, {
      weight: descriptor.weight,
      style: descriptor.style || 'normal',
      display: 'block',
    })
    if (fontSet) fontSet.add(face)
    faces.push(face)
  }

  try {
    await Promise.all(faces.map((face) => face.load()))
  } catch (error) {
    // Half-registered faces would sit in document.fonts forever with nothing
    // holding a handle to them.
    if (fontSet) for (const face of faces) fontSet.delete(face)
    throw error
  }

  return { alias, faces, slug, name: record?.name }
}

// Loads every weight of one family at the full character set.
//
// Returns { alias, faces }. The in-flight promise is cached per slug, so
// reopening the same panel neither refetches nor re-registers; each call takes
// a reference and must be paired with exactly one releaseFullFamily.
export function loadFullFamily(record) {
  const slug = familySlug(record?.name)
  let entry = entries.get(slug)
  if (!entry) {
    entry = { count: 0, handle: null, promise: null }
    entry.promise = registerFullFamily(record, slug).then(
      (handle) => {
        entry.handle = handle
        return handle
      },
      (error) => {
        // Drop the failure rather than caching it, so reopening the panel is a
        // real retry.
        entries.delete(slug)
        throw error
      },
    )
    entries.set(slug, entry)
  }
  entry.count += 1
  return entry.promise
}

// Deletes the faces once the last holder lets go. The panel calls this on
// close because a full family is the whole Latin subset at every weight, and
// browsing thirty fonts would otherwise leave thirty of them resident.
export function releaseFullFamily(handle) {
  if (!handle) return
  const entry = entries.get(handle.slug)
  // A handle whose entry is gone (or was replaced by a later load) has already
  // been released; releasing twice must not delete somebody else's faces.
  if (!entry || (entry.handle && entry.handle !== handle)) return
  entry.count -= 1
  if (entry.count > 0) return
  entries.delete(handle.slug)
  if (fontSet) for (const face of handle.faces) fontSet.delete(face)
}
