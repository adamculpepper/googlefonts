// The share-URL codec.
//
// Encoding stores only what differs from the defaults, so a link stays short
// and a browse session left at the defaults produces no hash at all. Arrays are
// compared by their serialized form; comparing them with !== would mark an
// untouched empty category list as changed on every single write.
//
// Decoding treats the hash as hostile input, because it is: anyone can hand a
// user a link. Every key is checked against the param registry, numbers are
// clamped to their declared range, select values must exist in the options
// list, and check lists are filtered to known options. Anything that fails
// falls back to the default for that key, and unknown keys are dropped.
// Decoding never throws.

import { PARAM_BY_KEY, getDefaults, stepPrecision } from '../data/params.js'

const CHECKS_SEPARATOR = ','

function toBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function isChanged(value, defaultValue) {
  if (typeof value === 'object' || typeof defaultValue === 'object') {
    return JSON.stringify(value) !== JSON.stringify(defaultValue)
  }
  return value !== defaultValue
}

function coerceNumber(param, value) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return undefined
  const clamped = Math.min(param.max, Math.max(param.min, numeric))
  return Number(clamped.toFixed(stepPrecision(param.step)))
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1) return true
  if (value === 'false' || value === 0) return false
  return undefined
}

function coerceOption(param, value) {
  return param.options.some((option) => option.value === value) ? value : undefined
}

function coerceText(param, value) {
  if (typeof value !== 'string') return undefined
  return param.maxLength ? value.slice(0, param.maxLength) : value
}

// Check lists travel packed as `Serif,Display` rather than a JSON array of
// quoted strings: fewer characters for the same data. Accepts either form so a
// hand-edited hash still decodes.
function coerceChecks(param, value) {
  const tokens = typeof value === 'string' ? value.split(CHECKS_SEPARATOR) : value
  if (!Array.isArray(tokens)) return undefined
  const known = new Set(param.options.map((option) => option.value))
  const picked = []
  for (const token of tokens) {
    if (typeof token !== 'string') continue
    const trimmed = token.trim()
    if (known.has(trimmed) && !picked.includes(trimmed)) picked.push(trimmed)
  }
  return picked
}

// Returns undefined when the value cannot be salvaged, which the caller reads
// as "keep the default for this key".
export function coerceParamValue(param, value) {
  switch (param.type) {
    case 'slider':
      return coerceNumber(param, value)
    case 'select':
    case 'segmented':
      return coerceOption(param, value)
    case 'toggle':
      return coerceBoolean(value)
    case 'text':
      return coerceText(param, value)
    case 'checks':
      return coerceChecks(param, value)
    default:
      return undefined
  }
}

// Full, valid settings from an arbitrary object. The only way untrusted values
// reach app state.
export function sanitizeSettings(raw) {
  const settings = getDefaults()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return settings

  for (const [key, value] of Object.entries(raw)) {
    const param = PARAM_BY_KEY[key]
    if (!param) continue
    const coerced = coerceParamValue(param, value)
    if (coerced !== undefined) settings[key] = coerced
  }
  return settings
}

export function encodeSettings(settings) {
  const defaults = getDefaults()
  const diff = {}

  for (const key of Object.keys(defaults)) {
    const value = settings?.[key]
    if (value === undefined || !isChanged(value, defaults[key])) continue
    const param = PARAM_BY_KEY[key]
    if (param.type === 'checks') {
      const packed = Array.isArray(value) ? value.join(CHECKS_SEPARATOR) : ''
      if (packed) diff[key] = packed
      continue
    }
    diff[key] = value
  }

  if (Object.keys(diff).length === 0) return ''
  try {
    return toBase64(JSON.stringify(diff))
  } catch {
    return ''
  }
}

// Null means "there was nothing usable here"; a hash that decodes to junk still
// comes back as a complete, valid settings object.
export function decodeSettings(hash) {
  if (typeof hash !== 'string') return null
  const encoded = hash.replace(/^#/, '').trim()
  if (encoded === '') return null

  try {
    return sanitizeSettings(JSON.parse(fromBase64(encoded)))
  } catch {
    return null
  }
}

export function readHashSettings() {
  if (typeof window === 'undefined') return null
  return decodeSettings(window.location.hash)
}

// replaceState, never pushState: the hash is a mirror of the current view, not
// a navigation step, so the back button never has to walk out of a session one
// slider at a time.
export function writeHashSettings(settings) {
  if (typeof window === 'undefined') return
  const encoded = encodeSettings(settings)
  const { pathname, search } = window.location
  window.history.replaceState(null, '', `${pathname}${search}${encoded ? `#${encoded}` : ''}`)
}

export function shareUrl(settings) {
  const encoded = encodeSettings(settings)
  const base = `${window.location.origin}${window.location.pathname}`
  return encoded ? `${base}#${encoded}` : base
}
