// The sidebar's saved-collection filter: all fonts, favorites, or one list.
//
// The filter chain reads listFilter.slugs, a resolved Set, rather than looking
// a list up for itself: the filter runs over every record on every pass and has
// no business knowing what a list is. That means the Set is a snapshot, and a
// snapshot goes stale the moment a font is starred while its own view is on
// screen, so this component re-resolves it whenever the collections change.
// Unstar a font while looking at Favorites and it leaves the grid.

import { useEffect, useId } from 'react'
import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import { useCollections } from '../../context/CollectionsContext.jsx'
import Icon from '../Icon.jsx'
import './ListFilterControl.css'

const LIST_VALUE_PREFIX = 'list:'

function sameSlugs(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false
  for (const slug of a) {
    if (!b.has(slug)) return false
  }
  return true
}

export default function ListFilterControl({ onManage }) {
  const { listFilter } = useAppState()
  const { setListFilter } = useAppActions()
  const { favorites, lists, listById } = useCollections()
  const selectId = useId()

  useEffect(() => {
    if (!listFilter) return
    if (listFilter.kind === 'favorites') {
      if (!sameSlugs(listFilter.slugs, favorites)) {
        setListFilter({ kind: 'favorites', slugs: new Set(favorites) })
      }
      return
    }
    const list = listById(listFilter.id)
    // The list was deleted while its own view was showing. Dropping back to all
    // fonts beats leaving the grid filtered by something that no longer exists.
    if (!list) {
      setListFilter(null)
      return
    }
    const slugs = new Set(list.slugs)
    if (!sameSlugs(listFilter.slugs, slugs)) {
      setListFilter({ kind: 'list', id: list.id, slugs })
    }
  }, [favorites, lists, listById, listFilter, setListFilter])

  const value = listFilter
    ? listFilter.kind === 'favorites'
      ? 'favorites'
      : `${LIST_VALUE_PREFIX}${listFilter.id}`
    : 'all'

  function handleChange(next) {
    if (next === 'favorites') {
      setListFilter({ kind: 'favorites', slugs: new Set(favorites) })
      return
    }
    if (next.startsWith(LIST_VALUE_PREFIX)) {
      const list = listById(next.slice(LIST_VALUE_PREFIX.length))
      if (list) {
        setListFilter({ kind: 'list', id: list.id, slugs: new Set(list.slugs) })
        return
      }
    }
    setListFilter(null)
  }

  return (
    <div className="control list-filter">
      <div className="head">
        <label className="label" htmlFor={selectId}>
          Saved lists
        </label>
        <button type="button" className="list-filter__manage" onClick={onManage}>
          <Icon name="pen" size={11} />
          Manage
        </button>
      </div>
      <select id={selectId} value={value} onChange={(event) => handleChange(event.target.value)}>
        <option value="all">All fonts</option>
        <option value="favorites">Favorites ({favorites.size})</option>
        {lists.map((list) => (
          <option key={list.id} value={`${LIST_VALUE_PREFIX}${list.id}`}>
            {list.name} ({list.slugs.length})
          </option>
        ))}
      </select>
    </div>
  )
}
