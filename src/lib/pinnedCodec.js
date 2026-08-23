// The pinned compare set, packed for the share URL.
//
// Wire shape: `roboto:700,lora:400:i`. One token per family: the slug, the
// weight it was pinned at, and `:i` when the pin is italic. Short on purpose,
// because it rides inside the same base64 hash as every other setting.
//
// Pure by contract: no DOM, no storage, no clock, no randomness. The packed
// string is untrusted input (anyone can hand someone a link), so unpackPinned
// treats every token as hostile and never throws. Unknown slugs are dropped,
// weights are snapped to what the family actually ships through the same
// resolveWeight the grid draws with, and the list is truncated at MAX_PINS.
//
// Weights are stored rather than recomputed because the pin records a decision:
// someone pinned Lora at 700, and a later move of the weight slider must not
// silently rewrite what their link says.

import { resolveWeight } from './fontUrl.js'

// Eight rows is what fits on a laptop screen at a readable specimen size, and
// past that a comparison stops being a comparison.
export const MAX_PINS = 8

// Mirrors the maxLength on the `pinned` param in data/params.js. The share
// codec slices text params at that length without asking, and a token cut in
// half decodes as junk, so packPinned drops whole trailing pins instead of
// letting the tail get sheared off.
export const MAX_PINNED_TEXT = 240

const PIN_SEPARATOR = ','
const FIELD_SEPARATOR = ':'
const ITALIC_FLAG = 'i'

// CSS says an unspecified weight is normal, and a token whose weight is missing
// or unreadable is exactly that case.
const DEFAULT_PIN_WEIGHT = 400

// The app keeps a Map of records by slug (FontStage builds one already), which
// is what this expects. An array or a plain object is accepted too so a caller
// that has not built the map yet still decodes rather than silently returning
// nothing. Exported because the tray and the compare view do the same lookup,
// and three copies of it would eventually disagree.
export function findRecord(records, slug) {
  if (records instanceof Map) return records.get(slug) || null
  if (Array.isArray(records)) return records.find((record) => record?.slug === slug) || null
  if (records && typeof records === 'object') return records[slug] || null
  return null
}

function toWeightNumber(value) {
  const numeric = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isFinite(numeric) ? Math.round(numeric) : DEFAULT_PIN_WEIGHT
}

// One pin, normalized: a trimmed slug, an integer weight, a real boolean.
export function normalizePin(pin) {
  const slug = typeof pin?.slug === 'string' ? pin.slug.trim().toLowerCase() : ''
  if (slug === '') return null
  return { slug, weight: toWeightNumber(pin.weight), italic: Boolean(pin.italic) }
}

export function isPinned(pins, slug) {
  return Array.isArray(pins) && pins.some((pin) => pin.slug === slug)
}

// Add or remove one family, capped at MAX_PINS. Returns the next list together
// with what happened, so the caller can toast the cap without re-deriving it.
// `changed: false` with `atLimit: true` is the ninth pin; the caller decides
// what to say about it.
export function togglePin(pins, candidate) {
  const list = Array.isArray(pins) ? pins : []
  const pin = normalizePin(candidate)
  if (!pin) return { pins: list, changed: false, added: false, atLimit: false }

  if (isPinned(list, pin.slug)) {
    return {
      pins: list.filter((entry) => entry.slug !== pin.slug),
      changed: true,
      added: false,
      atLimit: false,
    }
  }
  if (list.length >= MAX_PINS) {
    return { pins: list, changed: false, added: false, atLimit: true }
  }
  return { pins: [...list, pin], changed: true, added: true, atLimit: false }
}

// pins: [{ slug, weight, italic }] -> `roboto:700,lora:400:i`
//
// Duplicate slugs collapse to their first appearance: the same family twice is
// one row in the tray, so it is one token here.
export function packPinned(pins) {
  const list = Array.isArray(pins) ? pins : []
  const seen = new Set()
  const tokens = []
  let length = 0

  for (const entry of list) {
    if (tokens.length >= MAX_PINS) break
    const pin = normalizePin(entry)
    if (!pin || seen.has(pin.slug)) continue

    const token = pin.italic
      ? `${pin.slug}${FIELD_SEPARATOR}${pin.weight}${FIELD_SEPARATOR}${ITALIC_FLAG}`
      : `${pin.slug}${FIELD_SEPARATOR}${pin.weight}`
    const nextLength = length + token.length + (tokens.length === 0 ? 0 : PIN_SEPARATOR.length)
    if (nextLength > MAX_PINNED_TEXT) break

    seen.add(pin.slug)
    tokens.push(token)
    length = nextLength
  }

  return tokens.join(PIN_SEPARATOR)
}

// `roboto:700,lora:400:i` -> [{ slug, weight, italic }], every entry backed by a
// real family in recordsBySlug.
//
// The weight that comes back is the weight that will actually be DRAWN, not the
// number in the string: resolveWeight snaps a static family to its nearest real
// instance and clamps a variable family into its axis range, so the tray chip
// and the compare row can never advertise a weight the font does not have. The
// same call fixes the italic flag, since an italic-only family is served italic
// whether or not the token said so, and a family with no italic never is.
export function unpackPinned(text, recordsBySlug) {
  if (typeof text !== 'string' || text.trim() === '') return []

  const pins = []
  const seen = new Set()

  for (const rawToken of text.split(PIN_SEPARATOR)) {
    if (pins.length >= MAX_PINS) break
    const fields = rawToken.trim().split(FIELD_SEPARATOR)
    const slug = fields[0].trim().toLowerCase()
    if (slug === '' || seen.has(slug)) continue

    const record = findRecord(recordsBySlug, slug)
    if (!record) continue

    const wantItalic = String(fields[2] ?? '').trim().toLowerCase() === ITALIC_FLAG
    const resolved = resolveWeight(record, toWeightNumber(fields[1]), wantItalic)

    seen.add(slug)
    pins.push({ slug, weight: resolved.cssWeight, italic: resolved.italic })
  }

  return pins
}
