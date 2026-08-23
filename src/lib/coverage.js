// Glyph coverage: which codepoints a family can actually draw.
//
// Google's per-family metadata endpoint publishes exact per-codepoint coverage
// as compact range strings. That is the only trustworthy source we have: the
// css2 stylesheet lies, happily returning a stub @font-face carrying whatever
// unicode-range was asked for even when the font has none of those glyphs.
//
// Storing full coverage for 1,942 families would be megabytes, so the catalog
// ships a fixed probe of 489 codepoints and one bit per probe slot per family.
// Inside the probe the answer is exact; outside it the frontend has to fall
// back to the subset list and say so.

export const PROBE_VERSION = 1

// The 17 typographic marks that decide whether a font is usable for real
// prose. A family can carry the whole Latin alphabet and still have no proper
// quotes or dashes, which is exactly the gap a specimen browser should surface.
const TYPOGRAPHIC_MARKS = [
  0x2013, // – en dash
  0x2014, // — em dash
  0x2018, // ' left single quote
  0x2019, // ' right single quote
  0x201c, // " left double quote
  0x201d, // " right double quote
  0x2020, // † dagger
  0x2021, // ‡ double dagger
  0x2022, // • bullet
  0x2026, // … ellipsis
  0x2030, // ‰ per mille
  0x2039, // ‹ single left guillemet
  0x203a, // › single right guillemet
  0x2044, // ⁄ fraction slash
  0x20ac, // € euro
  0x2122, // ™ trademark
  0x2212, // − minus sign (not the hyphen at U+002D)
]

function codepointRange(firstCodepoint, lastCodepoint) {
  const codepoints = []
  for (let codepoint = firstCodepoint; codepoint <= lastCodepoint; codepoint += 1) codepoints.push(codepoint)
  return codepoints
}

const PROBE_CODEPOINTS = [
  ...codepointRange(0x0020, 0x007e), // printable ASCII (95)
  ...codepointRange(0x00a0, 0x00ff), // Latin-1 supplement (96)
  ...codepointRange(0x0100, 0x017f), // Latin Extended-A (128)
  ...TYPOGRAPHIC_MARKS, //               typographic marks (17)
  ...codepointRange(0x0391, 0x03c9), // Greek (57)
  ...codepointRange(0x0400, 0x045f), // Cyrillic (96)
]

export const PROBE = Object.freeze(
  [...new Set(PROBE_CODEPOINTS)].sort((left, right) => left - right),
)

export const PROBE_LENGTH = PROBE.length
export const MASK_BYTE_LENGTH = Math.ceil(PROBE.length / 8)

// A load-time assertion rather than a test, because every stored mask in the
// committed catalog is meaningless if the probe silently changes length: the
// bits would still decode but they would answer about different characters.
if (PROBE.length !== 489) {
  throw new Error(`coverage probe must hold 489 codepoints, built ${PROBE.length}`)
}

// Hand-rolled base64 rather than Buffer or btoa: this module is imported by the
// frontend, the build scripts and the verify script alike, so it cannot reach
// for anything Node-only, and btoa is byte-oriented legacy API surface that
// behaves differently enough across runtimes to not be worth the risk.
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_VALUES = (() => {
  const values = new Map()
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) values.set(BASE64_ALPHABET[index], index)
  return values
})()

export function bytesToBase64(bytes) {
  let encoded = ''
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]
    const hasSecond = second !== undefined
    const hasThird = third !== undefined
    const triple = (first << 16) | ((hasSecond ? second : 0) << 8) | (hasThird ? third : 0)
    encoded += BASE64_ALPHABET[(triple >> 18) & 63]
    encoded += BASE64_ALPHABET[(triple >> 12) & 63]
    encoded += hasSecond ? BASE64_ALPHABET[(triple >> 6) & 63] : '='
    encoded += hasThird ? BASE64_ALPHABET[triple & 63] : '='
  }
  return encoded
}

export function base64ToBytes(encoded) {
  const trimmed = encoded.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor((trimmed.length * 6) / 8))
  let bitBuffer = 0
  let bitCount = 0
  let writeIndex = 0
  for (const character of trimmed) {
    const value = BASE64_VALUES.get(character)
    if (value === undefined) throw new Error(`base64 string holds an illegal character: ${character}`)
    bitBuffer = (bitBuffer << 6) | value
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      bytes[writeIndex] = (bitBuffer >> bitCount) & 0xff
      writeIndex += 1
    }
  }
  return bytes
}

// Google writes coverage as "0,13,32-126,160-255,305,338-339": bare codepoints
// and inclusive ranges, comma separated, decimal.
export function parseRanges(rangeString) {
  const codepoints = new Set()
  if (typeof rangeString !== 'string' || rangeString.length === 0) return codepoints
  for (const token of rangeString.split(',')) {
    const trimmed = token.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('-')
    if (separator <= 0) {
      const single = Number.parseInt(trimmed, 10)
      if (Number.isInteger(single)) codepoints.add(single)
      continue
    }
    const first = Number.parseInt(trimmed.slice(0, separator), 10)
    const last = Number.parseInt(trimmed.slice(separator + 1), 10)
    if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) continue
    for (let codepoint = first; codepoint <= last; codepoint += 1) codepoints.add(codepoint)
  }
  return codepoints
}

// Bit i of the mask answers probe[i]. Bits run most-significant-first inside
// each byte so a hex dump of the mask reads in probe order.
export function buildMask(codepointSet, probe = PROBE) {
  const bytes = new Uint8Array(Math.ceil(probe.length / 8))
  for (let index = 0; index < probe.length; index += 1) {
    if (!codepointSet.has(probe[index])) continue
    bytes[index >> 3] |= 0x80 >> (index & 7)
  }
  return bytesToBase64(bytes)
}

function probeIndexOf(probe, codepoint) {
  let low = 0
  let high = probe.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (probe[middle] === codepoint) return middle
    if (probe[middle] < codepoint) low = middle + 1
    else high = middle - 1
  }
  return -1
}

export function maskHas(maskBytes, probeIndex) {
  return (maskBytes[probeIndex >> 3] & (0x80 >> (probeIndex & 7))) !== 0
}

// `missing` holds probe codepoints the family provably cannot draw. `unknown`
// holds codepoints outside the probe, which this mask says nothing about — the
// caller has to decide whether to guess from the subset list or stay quiet.
export function testMask(maskBase64, probe, text) {
  const maskBytes = base64ToBytes(maskBase64)
  const missing = []
  const unknown = []
  const seen = new Set()
  for (const character of text) {
    const codepoint = character.codePointAt(0)
    if (seen.has(codepoint)) continue
    seen.add(codepoint)
    const index = probeIndexOf(probe, codepoint)
    if (index < 0) unknown.push(codepoint)
    else if (!maskHas(maskBytes, index)) missing.push(codepoint)
  }
  return { covered: missing.length === 0, missing, unknown }
}
