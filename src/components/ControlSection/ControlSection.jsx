import { useEffect, useState } from 'react'
import { STORAGE_KEYS, readStoredJson, writeStoredJson } from '../../lib/storage.js'
import Icon from '../Icon.jsx'
import './ControlSection.css'

// Collapsible group. Controlled when `open` and `onToggle` are supplied (the
// sidebar persists that map); otherwise it manages itself from `defaultOpen`.
export default function ControlSection({ title, open: openProp, onToggle, defaultOpen = true, children }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen
  const handleToggle = isControlled ? onToggle : () => setInternalOpen((current) => !current)

  return (
    <section className="control-section">
      <button type="button" className="section-header" aria-expanded={open} onClick={handleToggle}>
        <span className="section-title">{title}</span>
        {/* The chevron's open state is read straight off aria-expanded in CSS,
            so the button's accessible state and its look cannot disagree. */}
        <Icon name="chevron-down" size={14} className="section-chevron" />
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

// Which sections are open, remembered across reloads. It lives beside the
// component rather than in the sidebar because the storage key and the open map
// are one contract: whoever renders these sections should not have to
// re-derive the shape, and a second panel of sections would otherwise write a
// conflicting version of it.
//
// `groups` is the full ordered list of section titles and `openByDefault` the
// ones that start expanded for a first-time visitor. Anything stored for a
// group that no longer exists is dropped on read, so renaming a section cannot
// leave a stale key deciding anything.
export function useSectionOpenState(groups, openByDefault = []) {
  const [openState, setOpenState] = useState(() => {
    const saved = readStoredJson(STORAGE_KEYS.sidebarSections, {})
    const defaults = new Set(openByDefault)
    const initial = {}
    for (const group of groups) {
      initial[group] = group in saved ? Boolean(saved[group]) : defaults.has(group)
    }
    return initial
  })

  useEffect(() => {
    writeStoredJson(STORAGE_KEYS.sidebarSections, openState)
  }, [openState])

  const toggleSection = (group) =>
    setOpenState((current) => ({ ...current, [group]: !current[group] }))

  return { openState, toggleSection }
}
