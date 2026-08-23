// Favorites and saved lists as live state. Loaded from storage once, written
// back on every single mutation: someone who stars a font and closes the tab a
// second later has to find that star still there, and a debounce cannot promise
// that.
//
// The mutators read the current data through refs rather than through the state
// they close over, which is what lets every callback here keep one identity for
// the life of the app. Card handlers are memoized on those identities, so a
// stable toggleFavorite is the difference between one card re-rendering and the
// whole visible grid re-rendering when a star is clicked.
//
// The same trick makes isFavorite and listById stable readers. They read the
// ref, so they are correct for anything that renders from this context (a
// mutation updates the ref before it sets state, and the value object changes
// identity anyway, so consumers re-render with fresh answers). Behind a memo
// barrier they intentionally do NOT trigger a render: components on that side of
// the barrier take a `favorite` prop instead, which is the whole point.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import {
  createList as createListEntry,
  deleteList as deleteListEntry,
  loadFavorites,
  loadLists,
  renameList as renameListEntry,
  saveFavorites,
  saveLists,
  toggleFavorite as toggleFavoriteSlug,
  toggleInList as toggleSlugInList,
} from '../lib/collections.js'

const CollectionsContext = createContext(null)

export function CollectionsProvider({ children }) {
  // Read once, lazily. Storage is touched during the first render and never
  // again on a read path.
  const [favorites, setFavorites] = useState(loadFavorites)
  const [lists, setLists] = useState(loadLists)

  const favoritesRef = useRef(favorites)
  const listsRef = useRef(lists)

  // Both commits bail on an unchanged array. The lib layer returns the same
  // reference when an edit was a no-op (unknown id, blank name), so a rename
  // typed and then reverted costs nothing.
  const commitFavorites = useCallback((next) => {
    if (next === favoritesRef.current) return
    favoritesRef.current = next
    setFavorites(next)
    saveFavorites(next)
  }, [])

  const commitLists = useCallback((next) => {
    if (next === listsRef.current) return
    listsRef.current = next
    setLists(next)
    saveLists(next)
  }, [])

  const toggleFavorite = useCallback(
    (slug) => commitFavorites(toggleFavoriteSlug(favoritesRef.current, slug)),
    [commitFavorites],
  )

  // Hands back the new id so the caller can add a font to the list it just
  // made, or null when the name was blank and nothing was created.
  const createList = useCallback(
    (name) => {
      const result = createListEntry(listsRef.current, name)
      commitLists(result.lists)
      return result.id
    },
    [commitLists],
  )

  const renameList = useCallback(
    (id, name) => commitLists(renameListEntry(listsRef.current, id, name)),
    [commitLists],
  )

  const deleteList = useCallback(
    (id) => commitLists(deleteListEntry(listsRef.current, id)),
    [commitLists],
  )

  const toggleInList = useCallback(
    (id, slug) => commitLists(toggleSlugInList(listsRef.current, id, slug)),
    [commitLists],
  )

  const isFavorite = useCallback((slug) => favoritesRef.current.includes(slug), [])

  const listById = useCallback(
    (id) => listsRef.current.find((list) => list.id === id) || null,
    [],
  )

  // A Set for rendering. Storage keeps an array (order is the order they were
  // starred in), but every read is a membership test, one per visible card.
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])

  const value = useMemo(
    () => ({
      favorites: favoriteSet,
      lists,
      toggleFavorite,
      createList,
      renameList,
      deleteList,
      toggleInList,
      isFavorite,
      listById,
    }),
    [
      favoriteSet,
      lists,
      toggleFavorite,
      createList,
      renameList,
      deleteList,
      toggleInList,
      isFavorite,
      listById,
    ],
  )

  return <CollectionsContext.Provider value={value}>{children}</CollectionsContext.Provider>
}

export function useCollections() {
  const context = useContext(CollectionsContext)
  if (!context) throw new Error('useCollections must be used within CollectionsProvider')
  return context
}
