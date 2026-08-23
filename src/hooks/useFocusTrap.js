import { useEffect, useRef } from 'react'

// The dialog contract, written once: focus moves in when the dialog opens, Tab
// cycles inside it, Escape closes it, and focus returns to whatever had it
// before. The detail panel, the compare view, the list dialogs and the
// shortcuts sheet all run through here so none of them can drift.
//
// Listeners bind to DOCUMENT, not the container. A container-bound listener
// dies the moment focus escapes the dialog (a stray click on the page behind
// a scrimless drawer, a programmatic focus move), leaving Escape dead and the
// dialog impossible to close from the keyboard; that was a confirmed bug.
// A module-level stack keeps stacked dialogs honest: only the topmost trap
// reacts, so one Escape closes one layer.
//
// `onClose` is held in a ref rather than listed as a dependency. Callers pass
// an inline arrow function, and re-running this effect on every parent render
// would restore focus mid-session, jumping the caret out of the dialog the
// moment a slider inside it moved.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const trapStack = []

export default function useFocusTrap({ containerRef, onClose, initialFocusRef, active = true }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return undefined
    const container = containerRef.current
    if (!container) return undefined

    trapStack.push(container)
    const previouslyFocused = document.activeElement
    const focusableItems = () => [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
    const target = initialFocusRef?.current || focusableItems()[0] || container
    target.focus()

    function handleKeyDown(event) {
      // A lower dialog stays inert while another sits on top of it.
      if (trapStack[trapStack.length - 1] !== container) return

      if (event.key === 'Escape') {
        // Stops here so an outer dialog or a global shortcut never also reacts.
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusableItems()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      // Focus that strayed outside the dialog comes back on the next Tab
      // instead of wandering the page behind it.
      if (!container.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      const stackIndex = trapStack.lastIndexOf(container)
      if (stackIndex !== -1) trapStack.splice(stackIndex, 1)
      previouslyFocused?.focus?.()
    }
  }, [active, containerRef, initialFocusRef])
}
