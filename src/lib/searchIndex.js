// Name folding for search and for sorting.
//
// Folding a name means normalizing it to NFD, dropping the combining marks and
// lowercasing what is left, so that typing "marcellus" finds "Marcellus SC"
// and typing "grandiflora" finds a family whose real name carries an accent.
// The work is small per name and enormous across 1,942 of them on every
// keystroke, so it is done once and kept.
//
// Two folded strings come out of each record and they are not the same string:
//   search  the name plus the display name, so either one finds the family
//   sort    the name alone, because a display name appended to a sort key
//           would reorder the alphabet for no reason the user can see
//
// buildSearchIndex is meant to be called once at boot with the decoded
// catalog. foldedKeysFor exists for the paths that hold records rather than
// slugs; it memoizes per record object, so the filter and sort layer gets the
// boot-built strings back without carrying the index through every signature.

const COMBINING_MARKS = /\p{M}+/gu
const WHITESPACE_RUNS = /\s+/g

export function foldText(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(WHITESPACE_RUNS, ' ')
    .trim()
}

// Keyed by the record object rather than by slug, so it survives the filtered
// arrays that get rebuilt on every keystroke and is collected with the catalog
// it describes.
const keysByRecord = new WeakMap()

export function foldedKeysFor(record) {
  if (!record || typeof record !== 'object') return { search: '', sort: '' }
  const cached = keysByRecord.get(record)
  if (cached) return cached

  const sort = foldText(record.name)
  const display = foldText(record.displayName)
  const keys = {
    search: display && display !== sort ? `${sort} ${display}` : sort,
    sort,
  }
  keysByRecord.set(record, keys)
  return keys
}

// Map<slug, { search, sort }>. Built once at boot from the decoded catalog and
// handed to anything that holds slugs rather than records, such as a pinned
// list or the compare tray.
export function buildSearchIndex(records) {
  const index = new Map()
  if (!Array.isArray(records)) return index
  for (const record of records) {
    if (!record || typeof record.slug !== 'string' || record.slug.length === 0) continue
    index.set(record.slug, foldedKeysFor(record))
  }
  return index
}

// The hot path: the query is folded once by the caller, then tested against
// every candidate. Substring rather than prefix, because people search for the
// distinctive half of a name ("slab", "mono") more often than the first word.
export function matchesFoldedQuery(index, slug, foldedQuery) {
  if (!foldedQuery) return true
  const keys = index instanceof Map ? index.get(slug) : null
  return keys ? keys.search.includes(foldedQuery) : false
}

export function matchesQuery(index, slug, query) {
  return matchesFoldedQuery(index, slug, foldText(query))
}

export function sortKeyFor(index, slug) {
  const keys = index instanceof Map ? index.get(slug) : null
  return keys ? keys.sort : ''
}
