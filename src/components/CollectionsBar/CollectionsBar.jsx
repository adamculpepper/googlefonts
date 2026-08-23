// Saved collections, promoted out of the sidebar into a row above the grid.
// Browsing is one click from a shortlist, the counts are always in sight, and
// somebody who has never starred a font can still see that starring exists.
//
// The filter chain reads listFilter.slugs, a resolved Set, rather than looking
// a list up for itself: the filter runs over every record on every pass and has
// no business knowing what a list is. That means the Set is a snapshot, and a
// snapshot goes stale the moment a font is starred while its own view is on
// screen, so this component re-resolves it whenever the collections change.
// Unstar a font while looking at Favorites and it leaves the grid.

import { useEffect, useState } from 'react'
import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import { useCollections } from '../../context/CollectionsContext.jsx'
import Icon from '../Icon.jsx'
import ListsDialog from '../ListsDialog/ListsDialog.jsx'
import './CollectionsBar.css'

function sameSlugs(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false
  for (const slug of a) {
    if (!b.has(slug)) return false
  }
  return true
}

export default function CollectionsBar() {
  const { listFilter } = useAppState()
  const { setListFilter } = useAppActions()
  const { favorites, lists, listById } = useCollections()
  const [manageOpen, setManageOpen] = useState(false)

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

  const activeKind = listFilter ? listFilter.kind : 'all'
  const activeListId = listFilter && listFilter.kind === 'list' ? listFilter.id : null

  return (
    <div className="collections-bar">
      <div className="collections-bar__tabs" role="group" aria-label="Saved collections">
        <button
          type="button"
          className={activeKind === 'all' ? 'collections-bar__tab is-active' : 'collections-bar__tab'}
          aria-pressed={activeKind === 'all'}
          onClick={() => setListFilter(null)}
        >
          All fonts
        </button>
        <button
          type="button"
          className={
            activeKind === 'favorites' ? 'collections-bar__tab is-active' : 'collections-bar__tab'
          }
          aria-pressed={activeKind === 'favorites'}
          title="Fonts you starred"
          onClick={() => setListFilter({ kind: 'favorites', slugs: new Set(favorites) })}
        >
          <Icon name="star" size={12} />
          Favorites
          <span className="collections-bar__count">{favorites.size}</span>
        </button>
        {lists.map((list) => (
          <button
            key={list.id}
            type="button"
            className={
              activeListId === list.id ? 'collections-bar__tab is-active' : 'collections-bar__tab'
            }
            aria-pressed={activeListId === list.id}
            onClick={() => setListFilter({ kind: 'list', id: list.id, slugs: new Set(list.slugs) })}
          >
            <Icon name="list" size={12} />
            {list.name}
            <span className="collections-bar__count">{list.slugs.length}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="collections-bar__manage"
        aria-label="Manage favorites and lists"
        title="Manage favorites and lists"
        onClick={() => setManageOpen(true)}
      >
        <Icon name="pen" size={12} />
        <span className="collections-bar__manage-label">Manage</span>
      </button>
      {manageOpen && <ListsDialog onClose={() => setManageOpen(false)} />}
    </div>
  )
}
