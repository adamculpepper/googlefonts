// The eviction bookkeeping for live font faces, kept pure so it can be
// reasoned about and verified without a browser. It stores keys, byte counts
// and opaque values; deciding what a value IS, and unregistering it from the
// browser once evicted, belongs to the loader.
//
// A Map preserves insertion order, so re-inserting an entry every time it is
// touched is all the machinery an LRU needs: the first key the iterator yields
// is always the least recently used one.

// A value carrying no generation at all is never singled out as stale. Only a
// value that states a generation and states a different one is treated as an
// old text generation.
function generationOf(value) {
  return value && typeof value === 'object' ? value.generation : undefined
}

export function createLru({ maxEntries = Infinity, maxBytes = Infinity } = {}) {
  const entries = new Map()
  let totalBytes = 0

  function removeEntry(entry) {
    if (!entries.delete(entry.key)) return false
    totalBytes -= entry.bytes
    return true
  }

  function overBudget() {
    return entries.size > maxEntries || totalBytes > maxBytes
  }

  // Setting a key that already exists replaces it and makes it the most
  // recently used, which is what a reload of the same face should mean.
  function set(key, value, bytes = 0) {
    const existing = entries.get(key)
    if (existing) removeEntry(existing)
    const measured = Number(bytes)
    const entry = { key, value, bytes: Number.isFinite(measured) && measured > 0 ? measured : 0 }
    entries.set(key, entry)
    totalBytes += entry.bytes
    return entry
  }

  function touch(key) {
    const entry = entries.get(key)
    if (!entry) return false
    // Delete and re-insert moves the same entry object to the end of the Map's
    // iteration order without disturbing the byte total.
    entries.delete(key)
    entries.set(key, entry)
    return true
  }

  function get(key) {
    const entry = entries.get(key)
    if (!entry) return undefined
    touch(key)
    return entry.value
  }

  function has(key) {
    return entries.has(key)
  }

  function remove(key) {
    const entry = entries.get(key)
    if (!entry) return false
    return removeEntry(entry)
  }

  // Evicts until both ceilings are satisfied and returns the entries removed,
  // so the caller can unregister each one from the browser.
  //
  // keepKeys is absolute: the load window is what the user is looking at, and
  // dropping a face out from under a visible card to satisfy a byte budget
  // would be worse than being briefly over budget. When everything left is
  // protected, this stops while still over budget and says so by returning
  // fewer entries than the ceilings demand.
  //
  // Order: entries from an old generation go first, oldest first, because they
  // are drawing text nobody asked for any more. Only then does plain LRU
  // decide, which keeps a face the user is scrolling back toward alive longer
  // than a stale one nothing points at.
  function evict(keepKeys = null, currentGeneration = null) {
    const keep = keepKeys instanceof Set ? keepKeys : new Set()
    const evicted = []
    if (!overBudget()) return evicted

    if (currentGeneration !== null && currentGeneration !== undefined) {
      for (const entry of [...entries.values()]) {
        if (!overBudget()) break
        if (keep.has(entry.key)) continue
        const generation = generationOf(entry.value)
        if (generation === undefined || generation === currentGeneration) continue
        removeEntry(entry)
        evicted.push(entry)
      }
    }

    for (const entry of [...entries.values()]) {
      if (!overBudget()) break
      if (keep.has(entry.key)) continue
      removeEntry(entry)
      evicted.push(entry)
    }
    return evicted
  }

  function clear() {
    const cleared = [...entries.values()]
    entries.clear()
    totalBytes = 0
    return cleared
  }

  return {
    set,
    get,
    has,
    touch,
    delete: remove,
    evict,
    clear,
    // Least recently used first, which is the order evict would work through.
    keys: () => [...entries.keys()],
    get size() {
      return entries.size
    },
    get bytes() {
      return totalBytes
    },
    get maxEntries() {
      return maxEntries
    },
    get maxBytes() {
      return maxBytes
    },
  }
}
