// Saved collections, reachable from the header beside share and theme. The
// button names the collection currently on screen, so what is filtering the
// grid is legible without opening anything.
//
// The filter chain reads listFilter.slugs, a resolved Set, rather than looking
// a list up for itself: the filter runs over every record on every pass and has
// no business knowing what a list is. That means the Set is a snapshot, and a
// snapshot goes stale the moment a font is starred while its own view is on
// screen, so this component re-resolves it whenever the collections change.
// Unstar a font while looking at Favorites and it leaves the grid.

import { useEffect, useRef, useState } from 'react'
import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import { useCollections } from '../../context/CollectionsContext.jsx'
import Icon from '../Icon.jsx'
import ListsDialog from '../ListsDialog/ListsDialog.jsx'
import './CollectionsMenu.css'

function sameSlugs(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false
  for (const slug of a) {
    if (!b.has(slug)) return false
  }
  return true
}

export default function CollectionsMenu() {
  const { listFilter } = useAppState()
  const { setListFilter } = useAppActions()
  const { favorites, lists, listById } = useCollections()
  const [open, setOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const wrapperRef = useRef(null)

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

  // Pointerdown rather than click, so a press that starts outside dismisses the
  // menu before the thing under the pointer reacts to it.
  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const activeList = listFilter && listFilter.kind === 'list' ? listById(listFilter.id) : null
  const activeLabel = listFilter
    ? listFilter.kind === 'favorites'
      ? 'Favorites'
      : activeList
        ? activeList.name
        : 'Saved'
    : 'Saved'
  const isFiltering = Boolean(listFilter)

  function choose(next) {
    setListFilter(next)
    setOpen(false)
  }

  return (
    <div className="collections-menu" ref={wrapperRef}>
      <button
        type="button"
        className={isFiltering ? 'collections-menu__button is-active' : 'collections-menu__button'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Favorites and saved lists"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="star" size={14} />
        <span className="collections-menu__label">{activeLabel}</span>
        <span className="collections-menu__count">{favorites.size + lists.length}</span>
      </button>

      {open && (
        <div className="collections-menu__popover" role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!listFilter}
            className={!listFilter ? 'collections-menu__item is-active' : 'collections-menu__item'}
            onClick={() => choose(null)}
          >
            All fonts
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={listFilter?.kind === 'favorites'}
            className={
              listFilter?.kind === 'favorites'
                ? 'collections-menu__item is-active'
                : 'collections-menu__item'
            }
            onClick={() => choose({ kind: 'favorites', slugs: new Set(favorites) })}
          >
            <Icon name="star" size={12} />
            Favorites
            <span className="collections-menu__item-count">{favorites.size}</span>
          </button>

          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              role="menuitemradio"
              aria-checked={activeList?.id === list.id}
              className={
                activeList?.id === list.id
                  ? 'collections-menu__item is-active'
                  : 'collections-menu__item'
              }
              onClick={() => choose({ kind: 'list', id: list.id, slugs: new Set(list.slugs) })}
            >
              <Icon name="list" size={12} />
              <span className="collections-menu__item-name">{list.name}</span>
              <span className="collections-menu__item-count">{list.slugs.length}</span>
            </button>
          ))}

          <button
            type="button"
            role="menuitem"
            className="collections-menu__manage"
            onClick={() => {
              setOpen(false)
              setManageOpen(true)
            }}
          >
            <Icon name="pen" size={12} />
            Manage lists
          </button>
        </div>
      )}

      {manageOpen && <ListsDialog onClose={() => setManageOpen(false)} />}
    </div>
  )
}
