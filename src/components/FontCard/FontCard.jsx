// One specimen card. It renders 20 to 60 times live in the virtualized grid,
// so it must be boring: memoized on primitive props only, with font-load state
// arriving through its own useSyncExternalStore subscription so one face
// resolving re-renders one card.
//
// The regenerating trick: while a new text generation loads, the card keeps
// showing the PREVIOUS generation's text in the previous generation's font
// (held in a ref), with a shimmer on the top edge. The grid never blanks and
// never shows a fallback font; it resolves from old word to new word.

import { memo, useRef, useState } from 'react'
import { useFontStatus } from '../../hooks/useFontStatus.js'
import { useCardActions } from '../../context/CardActionsContext.jsx'
import Icon from '../Icon.jsx'
import ListPicker from '../ListPicker/ListPicker.jsx'
import './FontCard.css'

const SPECIMEN_BOX_RATIO = 1.5

function buildNote(status, requestedWeight, italicWanted) {
  if (status.state === 'error') {
    if (status.error === 'dropped') return `Unavailable at this weight; nearest is ${status.weight}`
    if (status.error === 'http' || status.error === 'network') return 'Could not load'
  }
  if (status.state === 'unsupported') {
    const missing = status.missingChars.slice(0, 6).join(' ')
    return `Missing characters: ${missing}`
  }
  const notes = []
  if (status.state === 'ready' && !status.exactWeight && requestedWeight) {
    notes.push(`${requestedWeight} requested, drawn at ${status.weight}`)
  }
  if (italicWanted && !status.italicAvailable) notes.push('No italic')
  return notes.join('. ')
}

function FontCard({
  slug,
  name,
  displayName,
  statusKey,
  specimenText,
  fontSize,
  tracking,
  requestedWeight,
  italicWanted,
  density,
  categoryLabel,
  weightsLabel,
  variableLabel,
  isNew,
  rankLabel,
  blackness,
  showBlackness,
  pinned,
  favorite,
}) {
  const status = useFontStatus(statusKey)
  const actions = useCardActions()
  const lastReadyRef = useRef(null)
  const savePickerAnchorRef = useRef(null)
  const [savePickerOpen, setSavePickerOpen] = useState(false)

  if (status.state === 'ready' || status.state === 'unsupported') {
    lastReadyRef.current = {
      alias: status.alias,
      weight: status.weight,
      italic: status.italic,
      text: specimenText,
    }
  }

  const shown =
    status.state === 'ready' || status.state === 'unsupported'
      ? { alias: status.alias, weight: status.weight, italic: status.italic, text: specimenText }
      : lastReadyRef.current

  const cardState =
    status.state === 'loading' || status.state === 'idle'
      ? shown
        ? 'regenerating'
        : 'loading'
      : status.state

  const note = buildNote(status, requestedWeight, italicWanted)
  const shownName = displayName || name
  const accessibleName = [shownName, categoryLabel, weightsLabel, variableLabel && 'Variable']
    .filter(Boolean)
    .join('. ')

  const specimenStyle = shown
    ? {
        fontFamily: `"${shown.alias}"`,
        fontWeight: shown.weight,
        fontStyle: shown.italic ? 'italic' : 'normal',
        fontSize: `${fontSize}px`,
        letterSpacing: tracking ? `${tracking / 1000}em` : undefined,
      }
    : undefined

  return (
    <li
      className="font-card"
      data-state={cardState}
      style={{ '--specimen-box': `${Math.round(fontSize * SPECIMEN_BOX_RATIO)}px` }}
    >
      <button
        type="button"
        className="font-card__open"
        aria-label={accessibleName}
        onClick={() => actions.openDetail(slug)}
        onKeyDown={(event) => {
          // Single-letter shortcuts act on the focused card. Enter is the
          // button's own click; everything else must not scroll the page.
          if (event.key === 'p') {
            event.preventDefault()
            actions.togglePin(slug)
          } else if (event.key === 'f') {
            event.preventDefault()
            actions.toggleFavorite(slug)
          } else if (event.key === 'c') {
            event.preventDefault()
            actions.copyCss(slug)
          }
        }}
      >
        <div className="font-card__specimen" aria-hidden="true">
          {shown ? (
            <span className="font-card__text" style={specimenStyle}>
              {shown.text}
            </span>
          ) : (
            <span className="font-card__skeleton" />
          )}
        </div>
        {/* Fixed rows, one per density step, so the meta area can never be
            sliced mid-line by the card's uniform height: minimal shows the
            name row, normal adds the badge row, detailed adds the ink row.
            The substitution note shares the name row because honesty about
            what is actually drawn must survive every density. */}
        <div className="font-card__meta" data-density={density}>
          <span className="font-card__name-row">
            <span className="font-card__name">{shownName}</span>
            {isNew && <span className="font-card__badge font-card__badge--new">New</span>}
            {rankLabel && <span className="font-card__badge">{rankLabel}</span>}
            {note && <span className="font-card__note">{note}</span>}
          </span>
          {density !== 'minimal' && (
            <span className="font-card__badges">
              {categoryLabel && <span className="font-card__badge">{categoryLabel}</span>}
              {weightsLabel && <span className="font-card__badge">{weightsLabel}</span>}
              {variableLabel && (
                <span className="font-card__badge font-card__badge--variable">{variableLabel}</span>
              )}
              {showBlackness && blackness >= 0 && density === 'normal' && (
                <span className="font-card__badge" title="Measured ink density at the heaviest weight">
                  ink {blackness}
                </span>
              )}
            </span>
          )}
          {density === 'detailed' && showBlackness && blackness >= 0 && (
            <span className="font-card__ink" title="Measured ink density at the heaviest weight">
              <span className="font-card__ink-bar">
                <span className="font-card__ink-fill" style={{ width: `${blackness}%` }} />
              </span>
              <span className="font-card__ink-value">{blackness}</span>
            </span>
          )}
        </div>
      </button>
      <div className={savePickerOpen ? 'font-card__actions is-open' : 'font-card__actions'}>
        <button
          type="button"
          className={pinned ? 'font-card__action is-active' : 'font-card__action'}
          aria-label={pinned ? `Unpin ${shownName}` : `Pin ${shownName} to compare`}
          aria-pressed={pinned}
          onClick={() => actions.togglePin(slug)}
        >
          <Icon name="pin" size={14} />
        </button>
        <button
          type="button"
          className={favorite ? 'font-card__action is-active' : 'font-card__action'}
          aria-label={favorite ? `Remove ${shownName} from favorites` : `Add ${shownName} to favorites`}
          aria-pressed={favorite}
          onClick={() => actions.toggleFavorite(slug)}
        >
          <Icon name="star" size={14} />
        </button>
        <button
          type="button"
          ref={savePickerAnchorRef}
          className={savePickerOpen ? 'font-card__action is-active' : 'font-card__action'}
          aria-label={`Save ${shownName} to a list`}
          aria-expanded={savePickerOpen}
          onClick={() => setSavePickerOpen((open) => !open)}
        >
          <Icon name="list" size={14} />
        </button>
        {savePickerOpen && (
          <ListPicker
            slug={slug}
            anchorRef={savePickerAnchorRef}
            onClose={() => setSavePickerOpen(false)}
          />
        )}
        <button
          type="button"
          className="font-card__action"
          aria-label={`Copy CSS for ${shownName}`}
          onClick={() => actions.copyCss(slug)}
        >
          <Icon name="copy" size={14} />
        </button>
        <a
          className="font-card__action"
          href={`https://fonts.google.com/specimen/${encodeURIComponent(name).replace(/%20/g, '+')}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${shownName} on Google Fonts`}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="external" size={14} />
        </a>
      </div>
    </li>
  )
}

export default memo(FontCard)
