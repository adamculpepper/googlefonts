// Namespaced localStorage helpers. Every key this app writes is prefixed with
// `gf-` so the site can share an origin with other tools without collisions.
// Access is guarded: localStorage throws when storage is disabled or full, and a
// preference failing to persist must never take the app down.

const NAMESPACE = 'gf'

// favorites, lists and recentlyViewed are deliberately local-only. They are
// this browser's collection, not part of a view, so they never ride the share
// URL: a link carrying someone else's saved lists would open wrong for everyone
// who clicked it.
export const STORAGE_KEYS = {
  theme: 'theme',
  sidebarSections: 'sections',
  favorites: 'favorites',
  lists: 'lists',
  recentlyViewed: 'recent',
  // Mirror of the pinned compare set. Unlike lists, pins DO ride the share
  // URL (the URL wins); this key only restores them when a session starts
  // without a link.
  pinned: 'pinned',
}

function namespacedKey(name) {
  return `${NAMESPACE}-${name}`
}

export function readStoredString(name, fallback = null) {
  try {
    const raw = localStorage.getItem(namespacedKey(name))
    return raw === null ? fallback : raw
  } catch {
    return fallback
  }
}

export function writeStoredString(name, value) {
  try {
    localStorage.setItem(namespacedKey(name), value)
  } catch {
    /* storage unavailable, so the preference simply will not survive a reload */
  }
}

export function readStoredJson(name, fallback) {
  const raw = readStoredString(name)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeStoredJson(name, value) {
  try {
    writeStoredString(name, JSON.stringify(value))
  } catch {
    /* value could not be serialized, so there is nothing to persist */
  }
}

export function removeStored(name) {
  try {
    localStorage.removeItem(namespacedKey(name))
  } catch {
    /* storage unavailable */
  }
}
