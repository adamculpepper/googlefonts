// The compare overlay: every pinned family on its own row, all of them drawing
// the same words at the same size, which is the only way a side by side test of
// eight typefaces means anything.
//
// The specimens are free. Each row subscribes to the font manager under the
// SAME key the grid computes (family, resolved weight spec, italic, charset
// hash), so a family the grid already painted is already resident and the row
// renders instantly with no extra request. That is why the current preview
// text, weight and italic arrive as props instead of being read from settings
// here: the key math has to be the grid's, not a parallel version of it that
// drifts.
//
// The size slider is local and does not touch app state. Size changes nothing
// about which face is downloaded, so cranking it to 140 costs a repaint and
// never a request.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { charsetHash, fontKey, normalizeCharset, resolveWeight } from '../../lib/fontUrl.js'
import { findRecord } from '../../lib/pinnedCodec.js'
import { useFontStatus } from '../../hooks/useFontStatus.js'
import useFocusTrap from '../../hooks/useFocusTrap.js'
import Icon from '../Icon.jsx'
import './CompareView.css'

const MIN_SIZE = 24
const MAX_SIZE = 140
const SIZE_STEP = 2
const DEFAULT_SIZE = 72

// A press longer than this reads as "hold to preview" rather than as a tap, so
// releasing it leaves the solo latch exactly where it was.
const HOLD_MS = 400

// What the row is actually drawn at, which is not always what was pinned.
function drawnWeightLabel(resolved) {
  const base = resolved.italic ? `${resolved.cssWeight} italic` : String(resolved.cssWeight)
  return resolved.variable ? `${base}, variable` : base
}

function statusNote(status) {
  if (status.state === 'error') {
    if (status.error === 'dropped') return `Unavailable at this weight; nearest is ${status.weight}`
    return 'Could not load'
  }
  if (status.state === 'unsupported') {
    return `Missing characters: ${status.missingChars.slice(0, 6).join(' ')}`
  }
  return ''
}

function CompareRow({
  slug,
  name,
  statusKey,
  specimenText,
  weight,
  pinnedNote,
  fontSize,
  dimmed,
  soloed,
  onSoloPress,
  onSoloKeys,
  onSoloClick,
  onUnpin,
}) {
  const status = useFontStatus(statusKey)
  const ready = status.state === 'ready' || status.state === 'unsupported'
  const note = statusNote(status)

  return (
    <li
      className="compare-view__row"
      data-dimmed={dimmed ? 'true' : 'false'}
      data-solo={soloed ? 'true' : 'false'}
      // Focusable on purpose. The rows are the content of this dialog, so a
      // keyboard or screen reader user walks family by family rather than
      // hopping between the two buttons each row happens to carry.
      tabIndex={0}
      aria-label={`${name}, weight ${weight}`}
    >
      <div className="compare-view__row-head">
        <span className="compare-view__row-name">{name}</span>
        <span className="compare-view__row-weight">{weight}</span>
        {pinnedNote && <span className="compare-view__row-note">{pinnedNote}</span>}
        {note && <span className="compare-view__row-note is-warning">{note}</span>}
        <div className="compare-view__row-actions">
          <button
            type="button"
            className={soloed ? 'button compare-view__solo is-accent' : 'button compare-view__solo'}
            aria-pressed={soloed}
            aria-label={`Show ${name} on its own`}
            onPointerDown={() => onSoloPress(slug)}
            onKeyDown={onSoloKeys}
            onClick={() => onSoloClick(slug)}
          >
            Solo
          </button>
          <button
            type="button"
            className="button is-icon-only"
            aria-label={`Unpin ${name}`}
            onClick={() => onUnpin(slug)}
          >
            <Icon name="xmark" size={13} />
          </button>
        </div>
      </div>

      {/* Each row scrolls on its own rather than clipping behind a fade the way
          a grid card does. The tail of a long word is exactly what someone
          opened this view to look at. */}
      <div className="compare-view__specimen">
        {ready ? (
          <span
            className="compare-view__text"
            style={{
              fontFamily: `"${status.alias}"`,
              fontWeight: status.weight,
              fontStyle: status.italic ? 'italic' : 'normal',
              fontSize: `${fontSize}px`,
            }}
          >
            {specimenText}
          </span>
        ) : (
          <span className="compare-view__skeleton" style={{ height: `${fontSize}px` }} />
        )}
      </div>
    </li>
  )
}

const noop = () => {}

export default function CompareView({
  pins,
  records,
  requestText,
  typedText,
  requestedWeight,
  italic,
  onUnpin = noop,
  onClose = noop,
}) {
  const containerRef = useRef(null)
  const closeRef = useRef(null)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [heldSolo, setHeldSolo] = useState(null)
  const [lockedSolo, setLockedSolo] = useState(null)
  const sizeId = useId()
  const titleId = useId()

  // Press bookkeeping for the solo control: a tap latches, a hold previews.
  // Keyboard activation arrives with nothing recorded here, which is why the
  // zero state has to count as a tap.
  const soloPressRef = useRef({ startedAt: 0, wasHold: false })

  useFocusTrap({ containerRef, onClose, initialFocusRef: closeRef })

  // The release listener sits on the window, not the button: a pointer that
  // goes down on Solo and comes up somewhere else must still let go of the
  // preview, or the view stays dimmed with no way back.
  useEffect(() => {
    if (!heldSolo) return undefined
    function release() {
      const press = soloPressRef.current
      soloPressRef.current = { startedAt: press.startedAt, wasHold: Date.now() - press.startedAt > HOLD_MS }
      setHeldSolo(null)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [heldSolo])

  const hash = useMemo(() => charsetHash(normalizeCharset(requestText)), [requestText])

  // Everything a row needs, computed once per settings change rather than
  // inside each row. resolveWeight and the key math live here, mirroring how
  // the grid feeds its cards.
  const rows = useMemo(() => {
    const list = Array.isArray(pins) ? pins : []
    const built = []
    for (const pin of list) {
      const record = findRecord(records, pin.slug)
      if (!record) continue
      const resolved = resolveWeight(record, requestedWeight, italic)
      built.push({
        pin,
        record,
        statusKey: fontKey({
          name: record.name,
          weightSpec: resolved.weightSpec,
          italic: resolved.italic,
          charsetHash: hash,
        }),
        specimenText: typedText || record.displayName,
        weight: drawnWeightLabel(resolved),
        // Every row draws at the current preview weight, because a comparison
        // at eight different weights compares nothing. When that is not the
        // weight the pin remembers (the one in the share link and the embed),
        // the row says so instead of quietly disagreeing with its tray chip.
        pinnedNote:
          resolved.cssWeight === pin.weight && resolved.italic === pin.italic
            ? ''
            : `Pinned at ${pin.italic ? `${pin.weight} italic` : pin.weight}`,
      })
    }
    return built
  }, [pins, records, requestedWeight, italic, hash, typedText])

  // A solo latched on a family that has since been unpinned must dissolve,
  // or every remaining row stays dimmed with nothing soloed.
  const pinnedSlugSet = new Set(pins.map((pin) => pin.slug))
  const requestedSolo = heldSolo || lockedSolo
  const soloSlug = requestedSolo && pinnedSlugSet.has(requestedSolo) ? requestedSolo : null

  function handleSoloPress(slug) {
    soloPressRef.current = { startedAt: Date.now(), wasHold: false }
    setHeldSolo(slug)
  }

  function handleSoloKeys(event) {
    // Space and Enter fire click without a pointer press, so clear whatever the
    // last pointer left behind and let the click count as a tap.
    if (event.key === 'Enter' || event.key === ' ') {
      soloPressRef.current = { startedAt: 0, wasHold: false }
    }
  }

  function handleSoloClick(slug) {
    const wasHold = soloPressRef.current.wasHold
    soloPressRef.current = { startedAt: 0, wasHold: false }
    if (wasHold) return
    setLockedSolo((current) => (current === slug ? null : slug))
  }

  return (
    <div
      className="compare-view"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={containerRef}
    >
      <header className="compare-view__bar">
        <h2 className="compare-view__title" id={titleId}>
          Comparing {rows.length} {rows.length === 1 ? 'font' : 'fonts'}
        </h2>

        <div className="compare-view__size">
          <label className="compare-view__size-label" htmlFor={sizeId}>
            Size
          </label>
          <input
            id={sizeId}
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={SIZE_STEP}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
          <span className="compare-view__size-value">{size}px</span>
        </div>

        <button
          type="button"
          className="button is-icon-only"
          ref={closeRef}
          aria-label="Close compare"
          onClick={onClose}
        >
          <Icon name="xmark" size={14} />
        </button>
      </header>

      {rows.length === 0 ? (
        <p className="compare-view__empty">
          Nothing is pinned. Pin a font from the grid and it shows up here.
        </p>
      ) : (
        <ul className="compare-view__rows">
          {rows.map((row) => (
            <CompareRow
              key={row.pin.slug}
              slug={row.pin.slug}
              name={row.record.displayName || row.record.name}
              statusKey={row.statusKey}
              specimenText={row.specimenText}
              weight={row.weight}
              pinnedNote={row.pinnedNote}
              fontSize={size}
              dimmed={Boolean(soloSlug) && soloSlug !== row.pin.slug}
              soloed={lockedSolo === row.pin.slug}
              onSoloPress={handleSoloPress}
              onSoloKeys={handleSoloKeys}
              onSoloClick={handleSoloClick}
              onUnpin={onUnpin}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
