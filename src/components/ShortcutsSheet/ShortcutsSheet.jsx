// The keyboard shortcuts sheet, opened with ?.

import { useRef } from 'react'
import useFocusTrap from '../../hooks/useFocusTrap.js'
import Icon from '../Icon.jsx'
import './ShortcutsSheet.css'

const SHORTCUTS = [
  { keys: ['T'], action: 'Focus the preview text' },
  { keys: ['/'], action: 'Focus the name search' },
  { keys: ['J', 'K'], action: 'Move between fonts' },
  { keys: ['Enter'], action: 'Open the focused font' },
  { keys: ['P'], action: 'Pin the focused font to compare' },
  { keys: ['F'], action: 'Add the focused font to favorites' },
  { keys: ['C'], action: 'Copy CSS for the focused font' },
  { keys: ['Esc'], action: 'Close panels and dialogs' },
  { keys: ['?'], action: 'Show this sheet' },
]

export default function ShortcutsSheet({ onClose }) {
  const containerRef = useRef(null)
  useFocusTrap({ containerRef, onClose, active: true })

  return (
    <div className="shortcuts-scrim" onClick={onClose}>
      <div
        className="shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        ref={containerRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shortcuts__header">
          <h2 className="shortcuts__title">Keyboard shortcuts</h2>
          <button type="button" className="shortcuts__close" aria-label="Close" onClick={onClose}>
            <Icon name="xmark" size={16} />
          </button>
        </div>
        <ul className="shortcuts__list">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.action} className="shortcuts__row">
              <span className="shortcuts__keys">
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="shortcuts__key">
                    {key}
                  </kbd>
                ))}
              </span>
              <span className="shortcuts__action">{shortcut.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
