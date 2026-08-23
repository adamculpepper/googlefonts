// Saved collections as data: the favorites set, and the named lists.
//
// Everything here is a pure function over plain arrays apart from the four load
// and save calls, which are the only place this feature touches storage. There
// is no clock and no random source: a list id is derived from its name, so the
// same sequence of edits always produces the same data and a test can assert on
// it without freezing anything.
//
// None of this rides the share URL. A list describes one person's browser, not
// the view a link is meant to reproduce, so a link carrying someone else's
// saved lists would open wrong for everyone who clicked it.

import { STORAGE_KEYS, readStoredJson, writeStoredJson } from './storage.js'

// Long enough for a name someone would actually type, short enough that one
// runaway paste cannot blow out the row it renders in.
const MAX_NAME_LENGTH = 60
// Used when a name slugifies to nothing, which is what happens to a name
// written entirely in a script this slugifier does not transliterate.
const FALLBACK_ID = 'list'

// Stored slugs are trusted to be strings and nothing else. Unknown slugs are
// deliberately KEPT: this layer has no catalog to check them against, and a
// family missing from today's data may be back tomorrow. Consumers filter
// against real records, which is where the catalog actually exists.
export function decodeSlugs(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const slugs = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const slug = entry.trim()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    slugs.push(slug)
  }
  return slugs
}

// A list without an id or a name cannot be selected, renamed or shown, so it is
// dropped rather than repaired: guessing a name for it would put a row in the
// manage dialog that the reader never created.
export function decodeLists(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const lists = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    lists.push({ id, name: name.slice(0, MAX_NAME_LENGTH), slugs: decodeSlugs(entry.slugs) })
  }
  return lists
}

function cleanName(name) {
  return typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : ''
}

function slugifyName(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || FALLBACK_ID
}

// Two lists may share a name (people do reuse "drafts"), so the id takes a
// numeric suffix instead of the create being refused.
function uniqueListId(lists, base) {
  const taken = new Set(lists.map((list) => list.id))
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export function loadFavorites() {
  return decodeSlugs(readStoredJson(STORAGE_KEYS.favorites, []))
}

export function saveFavorites(slugs) {
  // Normalized on the way out as well as on the way in, so a mistake upstream
  // cannot leave shapes in storage that the next session has to survive.
  writeStoredJson(STORAGE_KEYS.favorites, decodeSlugs(slugs))
}

export function loadLists() {
  return decodeLists(readStoredJson(STORAGE_KEYS.lists, []))
}

export function saveLists(lists) {
  writeStoredJson(STORAGE_KEYS.lists, decodeLists(lists))
}

// Returns the new array and the new id together: the caller almost always wants
// to do something with the list it just made (add the font that prompted it),
// and re-deriving the id outside would duplicate the collision rule.
export function createList(lists, name) {
  const clean = cleanName(name)
  // A blank name is a slip, not an intent, so it changes nothing and says so by
  // handing back a null id.
  if (!clean) return { lists, id: null }
  const id = uniqueListId(lists, slugifyName(clean))
  return { lists: [...lists, { id, name: clean, slugs: [] }], id }
}

// The id does not follow the name. It is what the active filter and any open
// picker hold, so re-deriving it here would break the view mid-rename.
export function renameList(lists, id, name) {
  const clean = cleanName(name)
  if (!clean) return lists
  let changed = false
  const next = lists.map((list) => {
    if (list.id !== id || list.name === clean) return list
    changed = true
    return { ...list, name: clean }
  })
  return changed ? next : lists
}

export function deleteList(lists, id) {
  const next = lists.filter((list) => list.id !== id)
  return next.length === lists.length ? lists : next
}

export function toggleInList(lists, id, slug) {
  if (!slug) return lists
  let changed = false
  const next = lists.map((list) => {
    if (list.id !== id) return list
    changed = true
    return list.slugs.includes(slug)
      ? { ...list, slugs: list.slugs.filter((entry) => entry !== slug) }
      : { ...list, slugs: [...list.slugs, slug] }
  })
  return changed ? next : lists
}

export function toggleFavorite(favorites, slug) {
  if (!slug) return favorites
  return favorites.includes(slug)
    ? favorites.filter((entry) => entry !== slug)
    : [...favorites, slug]
}
