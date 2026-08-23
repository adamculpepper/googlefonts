// The "save to list" popover: one checkbox row per list, favorites first, and a
// row that turns into a name field for making a new one.
//
// Given an anchor it portals into document.body and positions itself against
// the anchor's rect. That is not decoration: a specimen card is
// `overflow: hidden` inside a virtualized row, so a popover rendered in place
// would be clipped by its own card. Without an anchor it falls back to absolute
// positioning inside whatever relatively positioned parent mounted it, which is
// the easier case and the one a test or a dev route hits.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCollections } from '../../context/CollectionsContext.jsx'
import useFocusTrap from '../../hooks/useFocusTrap.js'
import { useToast } from '../Toast/Toast.jsx'
import Icon from '../Icon.jsx'
import './ListPicker.css'

// Kept in step with --picker-width in the stylesheet. Placement reads the width
// as a constant rather than measuring the panel, so the popover lands in one
// pass with nothing to flash into position.
const PANEL_WIDTH = 232
const MAX_PANEL_HEIGHT = 320
// Below this the popover would show one row and a scrollbar, so it flips rather
// than squeezing.
const MIN_PANEL_HEIGHT = 180
const ANCHOR_GAP = 6
const EDGE_MARGIN = 8

function computePlacement(rect) {
  const spaceBelow = window.innerHeight - rect.bottom - ANCHOR_GAP - EDGE_MARGIN
  const spaceAbove = rect.top - ANCHOR_GAP - EDGE_MARGIN
  const above = spaceBelow < MIN_PANEL_HEIGHT && spaceAbove > spaceBelow
  const available = Math.max(MIN_PANEL_HEIGHT, above ? spaceAbove : spaceBelow)
  // Right edges line up with the anchor, since the trigger lives at the top
  // right of a card and a popover hanging off to the left of it reads as
  // belonging to the card next door.
  const rightAligned = rect.right - PANEL_WIDTH
  const furthestLeft = Math.max(EDGE_MARGIN, window.innerWidth - PANEL_WIDTH - EDGE_MARGIN)
  return {
    left: Math.min(Math.max(rightAligned, EDGE_MARGIN), furthestLeft),
    y: above ? rect.top - ANCHOR_GAP : rect.bottom + ANCHOR_GAP,
    above,
    maxHeight: Math.min(MAX_PANEL_HEIGHT, available),
  }
}

export default function ListPicker({ slug, onClose, anchorRef }) {
  const { favorites, lists, toggleFavorite, createList, toggleInList } = useCollections()
  const showToast = useToast()
  const panelRef = useRef(null)
  const nameInputRef = useRef(null)
  const [placement, setPlacement] = useState(null)
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')

  useFocusTrap({ containerRef: panelRef, onClose })

  const reposition = useCallback(() => {
    const anchor = anchorRef?.current
    if (!anchor) return
    setPlacement(computePlacement(anchor.getBoundingClientRect()))
  }, [anchorRef])

  // Placed before paint, then kept glued to the anchor. The capture phase is
  // what catches the stage's own scroll container, which does not bubble its
  // scroll events to the window.
  useLayoutEffect(() => {
    if (!anchorRef?.current) return undefined
    reposition()
    window.addEventListener('scroll', reposition, { capture: true, passive: true })
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, { capture: true })
      window.removeEventListener('resize', reposition)
    }
  }, [anchorRef, reposition])

  // A click on the anchor is the trigger's own business: closing here as well
  // would fight the parent's toggle and leave the popover flickering shut and
  // straight back open.
  useEffect(() => {
    function handlePointerDown(event) {
      const target = event.target
      if (panelRef.current?.contains(target)) return
      if (anchorRef?.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [anchorRef, onClose])

  // Escape in the name field cancels just the field. The listener has to be
  // native and on the input itself: the focus trap listens on the panel, and a
  // React onKeyDown is dispatched from the root long after the trap has already
  // seen the key and closed the whole popover.
  useEffect(() => {
    const input = nameInputRef.current
    if (!naming || !input) return undefined
    input.focus()
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setNaming(false)
      setDraft('')
    }
    input.addEventListener('keydown', handleKeyDown)
    return () => input.removeEventListener('keydown', handleKeyDown)
  }, [naming])

  function handleCreate(event) {
    event.preventDefault()
    const name = draft.trim()
    const id = createList(name)
    if (!id) return
    toggleInList(id, slug)
    setNaming(false)
    setDraft('')
    // The new list is off screen in the sidebar select, so the toast is the
    // only place the reader sees that it exists.
    showToast(`Saved to ${name}`)
  }

  const style = placement
    ? {
        '--picker-left': `${placement.left}px`,
        '--picker-y': `${placement.y}px`,
        '--picker-max-height': `${placement.maxHeight}px`,
      }
    : undefined

  // Whether this portals is decided by the anchor alone, never by whether the
  // position has been measured yet. Moving the panel between the parent and the
  // portal on the second render would remount the element, and the focus trap
  // would be left holding listeners on a node that no longer exists. Until the
  // measurement lands the panel is transparent rather than hidden, because
  // nothing inside a `visibility: hidden` subtree can take focus.
  const anchored = Boolean(anchorRef)
  const className = [
    'list-picker',
    anchored ? 'is-anchored' : 'is-inline',
    placement ? 'is-placed' : '',
    placement?.above ? 'is-above' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const panel = (
    <div className={className} style={style} ref={panelRef} role="dialog" aria-label="Save to list">
      <p className="list-picker__title">Save to list</p>
      <ul className="list-picker__rows">
        <li>
          <label className="list-picker__row">
            <input
              type="checkbox"
              checked={favorites.has(slug)}
              onChange={() => toggleFavorite(slug)}
            />
            <Icon name="star" size={12} className="list-picker__row-icon" />
            <span className="list-picker__row-name">Favorites</span>
          </label>
        </li>
        {lists.map((list) => (
          <li key={list.id}>
            <label className="list-picker__row">
              <input
                type="checkbox"
                checked={list.slugs.includes(slug)}
                onChange={() => toggleInList(list.id, slug)}
              />
              <span className="list-picker__row-name">{list.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {naming ? (
        <form className="list-picker__new" onSubmit={handleCreate}>
          <input
            type="text"
            ref={nameInputRef}
            className="list-picker__new-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              // An empty field that lost focus was abandoned, so the row goes
              // back to being a button rather than sitting there half open.
              if (draft.trim() === '') setNaming(false)
            }}
            placeholder="Name this list"
            aria-label="Name this list"
            maxLength={60}
          />
        </form>
      ) : (
        <button type="button" className="list-picker__new-button" onClick={() => setNaming(true)}>
          <Icon name="plus" size={11} />
          New list
        </button>
      )}
    </div>
  )

  return anchored ? createPortal(panel, document.body) : panel
}
