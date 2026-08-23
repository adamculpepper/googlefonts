// The manage-lists dialog: every saved list with its count, renamed in place,
// deleted behind a confirm step.
//
// The confirm is the row swapping to a question, not a second dialog on top of
// the first. A modal over a modal takes the focus trap with it and leaves the
// reader two Escape keys deep, and the question being asked here is small
// enough to fit in the row that raises it.

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCollections } from '../../context/CollectionsContext.jsx'
import useFocusTrap from '../../hooks/useFocusTrap.js'
import { useToast } from '../Toast/Toast.jsx'
import Icon from '../Icon.jsx'
import './ListsDialog.css'

function countLabel(count) {
  return count === 1 ? '1 font' : `${count} fonts`
}

export default function ListsDialog({ onClose }) {
  const { favorites, lists, renameList, deleteList } = useCollections()
  const showToast = useToast()
  const panelRef = useRef(null)
  const renameInputRef = useRef(null)
  const titleId = useId()
  const [renamingId, setRenamingId] = useState(null)
  const [draft, setDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)

  useFocusTrap({ containerRef: panelRef, onClose })

  // Escape while renaming backs out of the rename only. Native and on the input
  // itself, because the focus trap listens on the panel and would otherwise see
  // the key first and close the whole dialog.
  useEffect(() => {
    const input = renameInputRef.current
    if (!renamingId || !input) return undefined
    input.focus()
    input.select()
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setRenamingId(null)
    }
    input.addEventListener('keydown', handleKeyDown)
    return () => input.removeEventListener('keydown', handleKeyDown)
  }, [renamingId])

  function startRename(list) {
    setConfirmingId(null)
    setRenamingId(list.id)
    setDraft(list.name)
  }

  function submitRename(event) {
    event.preventDefault()
    renameList(renamingId, draft)
    setRenamingId(null)
  }

  function confirmDelete(list) {
    deleteList(list.id)
    setConfirmingId(null)
    // The row is gone from under the pointer, so the toast is what confirms
    // which list went.
    showToast(`Deleted ${list.name}`)
  }

  const nothingSaved = lists.length === 0 && favorites.size === 0

  // A click closes the dialog only when the press that started it also landed on
  // the scrim. Selecting a name and releasing the mouse past the edge of the
  // panel is a drag, not a dismissal, and it must not throw away what was typed.
  const pressedScrim = useRef(false)

  return createPortal(
    <div
      className="lists-dialog__scrim"
      onPointerDown={(event) => {
        pressedScrim.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedScrim.current) onClose()
      }}
    >
      <div
        className="lists-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <div className="lists-dialog__head">
          <h2 className="lists-dialog__title" id={titleId}>
            Saved lists
          </h2>
          <button
            type="button"
            className="lists-dialog__close"
            aria-label="Close saved lists"
            onClick={onClose}
          >
            <Icon name="xmark" size={14} />
          </button>
        </div>

        {nothingSaved ? (
          <p className="lists-dialog__empty">
            Star a font or save it to a list and it shows up here.
          </p>
        ) : (
          <ul className="lists-dialog__rows">
            {/* Favorites is the one collection nobody made and nobody can
                remove, so it holds the top row with no actions beside it. */}
            <li className="lists-dialog__row">
              <Icon name="star" size={13} className="lists-dialog__row-icon" />
              <span className="lists-dialog__row-name">Favorites</span>
              <span className="lists-dialog__row-count">{countLabel(favorites.size)}</span>
            </li>

            {lists.map((list) => {
              if (renamingId === list.id) {
                return (
                  <li className="lists-dialog__row" key={list.id}>
                    <form className="lists-dialog__rename" onSubmit={submitRename}>
                      <input
                        type="text"
                        ref={renameInputRef}
                        className="lists-dialog__rename-input"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        aria-label={`Rename ${list.name}`}
                        maxLength={60}
                      />
                      <button type="submit" className="lists-dialog__action" aria-label="Save name">
                        <Icon name="check" size={13} />
                      </button>
                      <button
                        type="button"
                        className="lists-dialog__action"
                        aria-label="Keep the old name"
                        onClick={() => setRenamingId(null)}
                      >
                        <Icon name="xmark" size={13} />
                      </button>
                    </form>
                  </li>
                )
              }

              if (confirmingId === list.id) {
                return (
                  <li className="lists-dialog__row is-confirming" key={list.id}>
                    <span className="lists-dialog__confirm-question">Delete this list?</span>
                    <button
                      type="button"
                      className="lists-dialog__confirm-button is-yes"
                      onClick={() => confirmDelete(list)}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className="lists-dialog__confirm-button"
                      onClick={() => setConfirmingId(null)}
                    >
                      No
                    </button>
                  </li>
                )
              }

              return (
                <li className="lists-dialog__row" key={list.id}>
                  <Icon name="list" size={13} className="lists-dialog__row-icon" />
                  <span className="lists-dialog__row-name">{list.name}</span>
                  <span className="lists-dialog__row-count">{countLabel(list.slugs.length)}</span>
                  <button
                    type="button"
                    className="lists-dialog__action"
                    aria-label={`Rename ${list.name}`}
                    onClick={() => startRename(list)}
                  >
                    <Icon name="pen" size={13} />
                  </button>
                  <button
                    type="button"
                    className="lists-dialog__action is-danger"
                    aria-label={`Delete ${list.name}`}
                    onClick={() => {
                      setRenamingId(null)
                      setConfirmingId(list.id)
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}
