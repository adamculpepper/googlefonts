// css2 URL construction and response parsing.
//
// Pure by contract: no DOM, no network, no clock, no randomness. The browser
// app and the Node verify scripts import this same file, so a green
// verify-fonturl run is a statement about the URLs the app actually builds
// rather than about a parallel test-only copy of the logic.
//
// Every endpoint fact encoded below was live-probed on 2026-08-22:
//   - 120 family= params per request is a hard cap; the 121st answers 403.
//     URL length is not the constraint (a 4,987-character URL was served
//     fine), so the guard counts families and never bytes.
//   - A family whose spec is invalid is dropped SILENTLY: the response is 200
//     and simply lacks that family. response.ok therefore proves nothing about
//     any individual family, and the caller has to diff what it asked for
//     against what parseFaces found.
//   - The response body is alphabetized by family rather than echoing request
//     order, which is why parseFaces keys by the font-family value instead of
//     zipping faces against the request list.
//   - Google normalizes text= to sorted unique codepoints itself. Sending our
//     canonical charset means two people typing the same word produce the
//     byte-identical URL, and byte-identical URLs are HTTP cache hits.
//   - Mixed per-family weights in one URL are fine, so chunks never have to be
//     grouped by weight.

export const CSS2_ENDPOINT = 'https://fonts.googleapis.com/css2'

// The cap is 120. Requesting 100 leaves room for the endpoint to tighten the
// limit without taking the app down, and no plausible viewport needs a single
// request that wide anyway.
export const MAX_FAMILIES_PER_REQUEST = 100

// Small chunks are what make a scrolling grid feel instant: 24 families is
// roughly two screens of cards, so the first response paints while the rest is
// still in flight, and a chunk that fails costs 24 cards rather than 100.
export const DEFAULT_CHUNK_SIZE = 24

// css2 refuses weights above 900, and the weight slider stops there too, so a
// variable axis that claims more is requested capped rather than as declared.
export const MAX_REQUESTED_WEIGHT = 900

// CSS says an unspecified font-weight is normal, which is 400. Used both for a
// family whose metadata carries no weights at all and for a parsed @font-face
// block that omits the declaration.
const DEFAULT_WEIGHT = 400

export function familySlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// C0 controls, DEL and the C1 block. A control character in a specimen would
// draw nothing, but it would still change the charset hash and therefore the
// alias of every font on the page, so stripping them keeps a stray paste from
// silently invalidating the whole cache.
function isControlCodepoint(codepoint) {
  return codepoint <= 0x1f || (codepoint >= 0x7f && codepoint <= 0x9f)
}

// The canonical charset: sorted, deduped, control-free. Canonical is the whole
// point, because it is what makes the same word produce the same URL for every
// user and the same hash for every alias.
export function normalizeCharset(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const seen = new Set()
  // for..of over a string iterates by code POINT, so a surrogate pair such as
  // U+1F600 stays one value instead of being split into two lone surrogates
  // that would each be requested as a character Google cannot serve.
  for (const character of text) {
    const codepoint = character.codePointAt(0)
    if (isControlCodepoint(codepoint)) continue
    seen.add(codepoint)
  }
  return [...seen].sort((left, right) => left - right)
}

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

function mixByte(hash, byte) {
  return Math.imul(hash ^ byte, FNV_PRIME)
}

// FNV-1a over four bytes per value, most significant first. Feeding whole
// bytes rather than the numbers themselves keeps U+1F600 and U+F600 apart
// instead of letting them collapse into the same byte stream.
function hashNumbers(values) {
  let hash = FNV_OFFSET_BASIS
  for (const value of values) {
    const number = Number(value) >>> 0
    hash = mixByte(hash, (number >>> 24) & 0xff)
    hash = mixByte(hash, (number >>> 16) & 0xff)
    hash = mixByte(hash, (number >>> 8) & 0xff)
    hash = mixByte(hash, number & 0xff)
  }
  return hash >>> 0
}

function hashText(text) {
  const codes = []
  for (let index = 0; index < text.length; index += 1) codes.push(text.charCodeAt(index))
  return hashNumbers(codes)
}

// Base 36 of a 32-bit value runs up to six digits. The low four carry the most
// variation, and this string is a cache discriminator rather than a digest, so
// 36^4 buckets is the right amount of work for something that appears in every
// font alias on the page.
function toBase36Four(hash) {
  return hash.toString(36).padStart(4, '0').slice(-4)
}

// The hash is order dependent, which is exactly why the input has to be the
// output of normalizeCharset. Canonical input is what buys order independence
// at the level that matters: "cab" and "abc" hash the same because both
// normalize to the same sorted array before they ever reach this function.
export function charsetHash(codepoints) {
  return toBase36Four(hashNumbers(Array.isArray(codepoints) ? codepoints : []))
}

// The identity of one loadable face. Two faces of the same family at different
// weights are different keys, because they are different downloads.
export function fontKey({ name, weightSpec, italic, charsetHash: hash }) {
  return `${name}|${weightSpec}|${italic ? 1 : 0}|${hash}`
}

// The CSS font-family name a face is registered under. Deliberately not the
// real family name: registering "Roboto" would collide with any Roboto the
// user's machine already has, and would make an old text generation and a new
// one the same font to the matcher.
//
// The alias is per family and generation, NOT per weight. Two faces of one
// family at different weights share an alias on purpose, so ordinary CSS
// font-weight matching picks between them the way it would for a real family.
export function fontAlias(name, hash) {
  return `gf_${familySlug(name)}_${hash}`
}

function sortedNumbers(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
}

function findWeightAxis(family) {
  const axes = Array.isArray(family?.axes) ? family.axes : []
  const axis = axes.find((entry) => entry && entry.tag === 'wght')
  if (!axis) return null
  const min = Number(axis.min)
  const max = Number(axis.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null
  return { min, max }
}

// The CSS Fonts font matching algorithm, which is not "pick the closest
// number": 400 prefers 500 over 300, and 500 prefers 400 over 600. On the
// 100-step weight sets real families ship this reduces exactly to the table
// the plan pins down, and it also answers sensibly for the in-between values
// the weight slider can produce.
function nearestStaticWeight(available, requested) {
  if (available.length === 0) return null
  if (available.includes(requested)) return requested

  const below = available.filter((weight) => weight < requested).reverse()
  const above = available.filter((weight) => weight > requested)

  if (requested >= 400 && requested <= 500) {
    // Up to 500 first, then down, then past 500.
    const throughFiveHundred = above.filter((weight) => weight <= 500)
    const pastFiveHundred = above.filter((weight) => weight > 500)
    return throughFiveHundred[0] ?? below[0] ?? pastFiveHundred[0] ?? null
  }
  if (requested < 400) return below[0] ?? above[0] ?? null
  return above[0] ?? below[0] ?? null
}

// Decides what to ask css2 for and what font-weight to draw with, which are
// two different numbers: a variable family is requested as its whole range and
// positioned client side, a static family is requested as one instance.
//
// family: { weights: number[], italics: number[], axes: [{ tag, min, max }] }
export function resolveWeight(family, requestedWeight, wantItalic) {
  const romanWeights = sortedNumbers(family?.weights)
  const italicWeights = sortedNumbers(family?.italics)
  const romanAvailable = romanWeights.length > 0
  const italicAvailable = italicWeights.length > 0

  // An italic-only family such as Molle has no upright face to fall back to,
  // so it is served italic whether or not italic was asked for. The card reads
  // italicAvailable together with the requested state to explain itself.
  const italic = italicAvailable && (Boolean(wantItalic) || !romanAvailable)
  const available = italic ? italicWeights : romanWeights

  const requestedNumber = Number(requestedWeight)
  const requested = Number.isFinite(requestedNumber) ? requestedNumber : DEFAULT_WEIGHT

  const axis = findWeightAxis(family)
  if (axis) {
    const min = axis.min
    // The request caps at 900, so cssWeight has to cap there too: asking the
    // served face for 950 when only 100..900 was downloaded would be clamped
    // by the font anyway, and reporting a weight we did not fetch would make
    // the card lie about what it is showing.
    const max = Math.max(min, Math.min(axis.max, MAX_REQUESTED_WEIGHT))
    const cssWeight = Math.min(Math.max(requested, min), max)
    return {
      weightSpec: `${min}..${max}`,
      cssWeight,
      exact: cssWeight === requested,
      italic,
      italicAvailable,
      romanAvailable,
      variable: true,
    }
  }

  const snapped = nearestStaticWeight(available, requested) ?? DEFAULT_WEIGHT
  return {
    weightSpec: String(snapped),
    cssWeight: snapped,
    exact: snapped === requested,
    italic,
    italicAvailable,
    romanAvailable,
    variable: false,
  }
}

// One family= fragment. Spaces become '+' because that is what css2 expects;
// no other character in the Google Fonts catalog needs escaping here, and
// percent-encoding the fragment as a whole would destroy the ':' '@' ';' and
// ',' that carry its meaning.
export function familySpec(name, resolved) {
  const family = String(name ?? '').trim().replace(/\s+/g, '+')
  const spec = resolved?.weightSpec ?? String(DEFAULT_WEIGHT)
  if (!resolved?.italic) return `${family}:wght@${spec}`

  // Asking for a roman instance a family does not have invalidates the whole
  // spec, and an invalid spec is dropped silently, so an italic-only family
  // asks for the italic axis position alone.
  if (!resolved.romanAvailable) return `${family}:ital,wght@1,${spec}`

  // A variable family is asked for in both axis positions so the upright is
  // already resident when the italic toggle flips back. A static family is
  // not: one instance is one download, and the upright would be dead weight.
  if (resolved.variable) return `${family}:ital,wght@0,${spec};1,${spec}`
  return `${family}:ital,wght@1,${spec}`
}

// Locale-free ordering. localeCompare would sort differently depending on the
// user's ICU data, and a URL that differs between two users for the same set
// of families is a cache miss for both of them.
function compareCodeUnits(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareCandidateNames(left, right) {
  const byName = compareCodeUnits(String(left?.name ?? '').toLowerCase(), String(right?.name ?? '').toLowerCase())
  if (byName !== 0) return byName
  // Same family twice in one chunk happens when the compare tray pins it at
  // two weights, so the key breaks the tie and keeps the order total.
  return compareCodeUnits(String(left?.key ?? ''), String(right?.key ?? ''))
}

// Splits a priority-ordered candidate list into request-sized chunks.
//
// Chunk BOUNDARIES follow priority order, so the families nearest the middle
// of the viewport travel in the first request and paint first. Families are
// sorted alphabetically WITHIN each chunk, which changes nothing about who
// travels with whom and makes the resulting URL canonical.
//
// candidates: [{ name, resolved, key, alias }] in priority order.
// Returns [{ id, families, specs }] where specs[i] describes families[i].
export function planChunks(candidates, { chunkSize = DEFAULT_CHUNK_SIZE, maxPerRequest = MAX_FAMILIES_PER_REQUEST } = {}) {
  const queue = (Array.isArray(candidates) ? candidates : []).filter(Boolean)
  if (!Number.isFinite(chunkSize) || chunkSize < 1) {
    throw new Error(`planChunks needs a chunk size of at least 1, got ${chunkSize}`)
  }
  if (chunkSize > maxPerRequest) {
    throw new Error(`planChunks was asked for ${chunkSize} families per request, over the ${maxPerRequest} cap`)
  }

  const chunks = []
  for (let start = 0; start < queue.length; start += chunkSize) {
    const families = queue.slice(start, start + chunkSize).sort(compareCandidateNames)
    const specs = families.map((candidate) => familySpec(candidate.name, candidate.resolved))
    // The id carries a hash of its own contents, so a chunk from a superseded
    // generation can never be mistaken for the chunk that replaced it even
    // though both sit at the same position in the plan.
    chunks.push({ id: `chunk-${chunks.length}-${toBase36Four(hashText(specs.join('|')))}`, families, specs })
  }
  return chunks
}

function textFromCodepoints(codepoints) {
  let text = ''
  // Built one codepoint at a time rather than spread into fromCodePoint,
  // because a spread of a long charset is an argument list long enough to
  // overflow the call stack.
  for (const codepoint of codepoints) text += String.fromCodePoint(codepoint)
  return text
}

// The full request URL. Specs are sorted and deduped here as well as in
// planChunks, because this is the last place the bytes can still be made
// canonical before they go out.
//
// display=block is always present and is deliberately not swap: the grid holds
// a skeleton until the real face resolves, so no card ever flashes a fallback
// face. Export snippets shown to users DO use swap, which is correct there and
// wrong here.
export function buildCss2Url(specs, codepoints) {
  const unique = [...new Set((Array.isArray(specs) ? specs : []).filter((spec) => typeof spec === 'string' && spec.length > 0))]
  unique.sort(compareCodeUnits)
  if (unique.length > MAX_FAMILIES_PER_REQUEST) {
    throw new Error(`buildCss2Url was given ${unique.length} families, over the ${MAX_FAMILIES_PER_REQUEST} cap`)
  }

  const params = unique.map((spec) => `family=${spec}`)
  const points = Array.isArray(codepoints) ? codepoints : []
  // No text= at all when the charset is empty. That is the family-name
  // specimen case, where each card draws its own name and the full font is
  // wanted rather than a subset.
  if (points.length > 0) params.push(`text=${encodeURIComponent(textFromCodepoints(points))}`)
  params.push('display=block')
  return `${CSS2_ENDPOINT}?${params.join('&')}`
}

function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && (trimmed.startsWith("'") || trimmed.startsWith('"')) && trimmed.endsWith(trimmed[0])) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

// Declarations are split at top-level semicolons only. A semicolon inside
// url(...) is legal (data:font/woff2;base64,... carries one) and splitting on
// it would cut a src value in half.
function readDeclarations(blockBody) {
  const declarations = new Map()
  let depth = 0
  let quote = ''
  let current = ''
  const commit = () => {
    const separator = current.indexOf(':')
    if (separator > 0) {
      const property = current.slice(0, separator).trim().toLowerCase()
      const value = current.slice(separator + 1).trim()
      if (property.length > 0) declarations.set(property, value)
    }
    current = ''
  }
  for (const character of blockBody) {
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === "'" || character === '"') {
      quote = character
    } else if (character === '(') {
      depth += 1
    } else if (character === ')') {
      depth = Math.max(0, depth - 1)
    } else if (character === ';' && depth === 0) {
      commit()
      continue
    }
    current += character
  }
  commit()
  return declarations
}

// A variable response writes "font-weight: 100 900". A static one writes a
// single number. Anything unreadable is treated as the CSS initial value,
// which is normal, which is 400.
function parseWeightRange(rawWeight) {
  const numbers = (rawWeight.match(/\d+/g) || []).map((token) => Number.parseInt(token, 10))
  if (numbers.length === 0) return { min: DEFAULT_WEIGHT, max: DEFAULT_WEIGHT }
  return { min: Math.min(...numbers), max: Math.max(...numbers) }
}

// Reads a css2 response into Map<familyName, face[]>.
//
// Keyed by the font-family VALUE because the response comes back alphabetized
// rather than in request order. Several @font-face blocks per family are
// normal (one per subset when there is no text=), so every block is collected.
//
// Never throws. A junk or truncated body returns whatever parsed, and a family
// that is simply absent from the map is how the caller detects the silent drop
// that css2 answers with instead of an error.
export function parseFaces(cssText) {
  const faces = new Map()
  if (typeof cssText !== 'string' || cssText.length === 0) return faces

  const blockPattern = /@font-face\s*\{([^}]*)\}/gi
  let block = blockPattern.exec(cssText)
  while (block !== null) {
    const declarations = readDeclarations(block[1])
    const family = unquote(declarations.get('font-family') ?? '')
    if (family.length > 0) {
      const weight = (declarations.get('font-weight') ?? String(DEFAULT_WEIGHT)).trim()
      const face = {
        weight,
        weightRange: parseWeightRange(weight),
        style: (declarations.get('font-style') ?? 'normal').trim(),
        src: (declarations.get('src') ?? '').trim(),
        unicodeRange: (declarations.get('unicode-range') ?? '').trim(),
      }
      const existing = faces.get(family)
      if (existing) existing.push(face)
      else faces.set(family, [face])
    }
    block = blockPattern.exec(cssText)
  }
  return faces
}
