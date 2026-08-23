// The virtualized grid. One virtual item is one ROW of N uniform cards, and
// row height is a pure function of the settings (specimen box, meta line,
// padding), so the virtualizer never measures the DOM. That determinism is
// the whole performance story: estimateSize is exact, getTotalSize is a
// multiply, and typing never causes layout thrash.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppState } from '../../context/AppContext.jsx'
import { useCollections } from '../../context/CollectionsContext.jsx'
import { useFontManager } from '../../context/FontManagerContext.jsx'
import { charsetHash, fontKey, normalizeCharset, resolveWeight } from '../../lib/fontUrl.js'
import FontCard from '../FontCard/FontCard.jsx'
import './FontGrid.css'

const SPECIMEN_BOX_RATIO = 1.5
const CARD_PADDING_Y = 24
const ROW_GAP = 12
// 3 rows of overscan each side: enough that slow scrolling never catches the
// loader, small enough that the eviction-immune window stays well inside the
// live-face budget (measured: 4 rows left ~32 families immune).
const LOAD_BUFFER_ROWS = 3
const LOAD_DEBOUNCE_MS = 120
// One 20px line per density step (name row / + badges / + ink meter) plus the
// meta's own top margin and row gaps. Must track the line structure in
// FontCard.css or badges get sliced mid-glyph again.
const META_HEIGHT_BY_DENSITY = { minimal: 30, normal: 56, detailed: 82 }

// "New" badge cutoff: twelve months back, as a YYYYMMDD integer to compare
// against the catalog's dateAdded. Computed once per session in the UI layer;
// lib code stays clock-free.
const now = new Date()
const NEW_CUTOFF =
  (now.getFullYear() - 1) * 10000 + (now.getMonth() + 1) * 100 + now.getDate()

const WEIGHT_FOR_MODE = { thickest: 900, lightest: 100 }

function autoColumns(width, fontSize) {
  // Bigger specimen text earns wider tracks, so cranking the size naturally
  // thins the grid without a separate control.
  const minTrack = Math.min(560, Math.max(250, fontSize * 3.2 + 60))
  return Math.max(1, Math.min(6, Math.floor(width / minTrack)))
}

function weightsLabelFor(record) {
  const count = record.weights.length
  if (count === 0 && record.italics.length > 0) return 'Italic only'
  const base = count === 1 ? '1 weight' : `${count} weights`
  return record.italics.length > 0 ? `${base} + italics` : base
}

function FontGrid({ records, requestText, typedText, scrollRef, pinnedSlugs, pinnedRecords }) {
  const { settings } = useAppState()
  const { favorites } = useCollections()
  const manager = useFontManager()
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return undefined
    const observer = new ResizeObserver((entries) => {
      // Quantized so subpixel rounding cannot flip the column count per frame.
      setContainerWidth(Math.round(entries[0].contentRect.width / 8) * 8)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [scrollRef])

  const columns =
    settings.columns === 'auto'
      ? autoColumns(containerWidth || 1200, settings.size)
      : Math.max(1, Math.min(Number(settings.columns), Math.max(1, Math.floor((containerWidth || 1200) / 220))))

  const rowCount = Math.ceil(records.length / columns)
  const rowHeight =
    CARD_PADDING_Y +
    Math.round(settings.size * SPECIMEN_BOX_RATIO) +
    META_HEIGHT_BY_DENSITY[settings.density] +
    ROW_GAP

  const estimateSize = useCallback(() => rowHeight, [rowHeight])
  const getScrollElement = useCallback(() => scrollRef.current, [scrollRef])
  const getItemKey = useCallback(
    (rowIndex) => records[rowIndex * columns]?.slug ?? rowIndex,
    [records, columns],
  )

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize,
    overscan: 3,
    getItemKey,
  })

  // The measurement cache does not invalidate itself when the estimate
  // changes; without this, changing the font size overlaps rows.
  useLayoutEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight, columns])

  const requestedWeight = WEIGHT_FOR_MODE[settings.weightMode] ?? settings.weight
  const hash = useMemo(() => charsetHash(normalizeCharset(requestText)), [requestText])

  // Everything a card needs, computed once per settings change instead of
  // inside each of the 40 mounted cards. resolveWeight runs here, per visible
  // family, never in a card render.
  const cardData = useMemo(
    () =>
      records.map((record) => {
        const resolved = resolveWeight(record, requestedWeight, settings.italic)
        return {
          record,
          resolved,
          statusKey: fontKey({
            name: record.name,
            weightSpec: resolved.weightSpec,
            italic: resolved.italic,
            charsetHash: hash,
          }),
          // The empty-text charset covers ASCII family names; displayName can
          // carry non-ASCII (134 families) and would render tofu, so the
          // specimen draws `name` while the meta row keeps the display name.
          specimenText: typedText || record.name,
          weightsLabel: weightsLabelFor(record),
          variableLabel: record.isVariable
            ? `VF ${record.axes.map((axis) => axis.tag).join(' ')}`
            : '',
          isNew: record.dateAdded >= NEW_CUTOFF,
        }
      }),
    [records, requestedWeight, settings.italic, hash, typedText],
  )

  const virtualItems = virtualizer.getVirtualItems()
  const firstRow = virtualItems[0]?.index ?? 0
  const lastRow = virtualItems[virtualItems.length - 1]?.index ?? 0

  // The load window: visible rows plus a buffer on each side, flattened to
  // families and ordered center-out so the fonts under the reader's eyes win
  // the connection. Debounced so a fast scroll settles before requesting.
  useEffect(() => {
    const timer = setTimeout(() => {
      const start = Math.max(0, (firstRow - LOAD_BUFFER_ROWS) * columns)
      const end = Math.min(records.length, (lastRow + 1 + LOAD_BUFFER_ROWS) * columns)
      const window = records.slice(start, end)
      const center = (start + end) / 2
      const ordered = window
        .map((record, index) => ({ record, distance: Math.abs(start + index - center) }))
        .sort((a, b) => a.distance - b.distance)
        .map((entry) => entry.record)
      // Pinned families ride at the tail of every request so the compare
      // tray's faces stay loaded (and inside the eviction-immune window)
      // even when their cards scrolled far away.
      const windowSlugs = new Set(ordered.map((record) => record.slug))
      for (const pinnedRecord of pinnedRecords || []) {
        if (!windowSlugs.has(pinnedRecord.slug)) ordered.push(pinnedRecord)
      }
      if (ordered.length > 0) {
        manager.request({
          families: ordered,
          text: requestText,
          weight: requestedWeight,
          italic: settings.italic,
        })
      }
    }, LOAD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [
    manager,
    records,
    firstRow,
    lastRow,
    columns,
    requestText,
    requestedWeight,
    settings.italic,
    pinnedRecords,
  ])

  const showBlackness =
    settings.density === 'detailed' ||
    settings.sort.startsWith('blackness') ||
    settings.blacknessMin > 0 ||
    settings.blacknessMax < 100
  const showRank = settings.sort === 'popularity' || settings.sort === 'trending'

  return (
    <div
      className="font-grid"
      data-ink={settings.previewInk}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualItems.map((virtualRow) => {
        const rowRecords = cardData.slice(
          virtualRow.index * columns,
          (virtualRow.index + 1) * columns,
        )
        return (
          <ul
            key={virtualRow.key}
            className="font-grid__row"
            style={{
              transform: `translateY(${virtualRow.start}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              height: rowHeight - ROW_GAP,
            }}
          >
            {rowRecords.map((card) => (
              <FontCard
                key={card.record.slug}
                slug={card.record.slug}
                name={card.record.name}
                displayName={card.record.displayName}
                statusKey={card.statusKey}
                specimenText={card.specimenText}
                fontSize={settings.size}
                tracking={settings.tracking}
                requestedWeight={settings.weightMode === 'set' ? settings.weight : 0}
                italicWanted={settings.italic}
                density={settings.density}
                categoryLabel={card.record.category}
                weightsLabel={card.weightsLabel}
                variableLabel={card.variableLabel}
                isNew={card.isNew}
                rankLabel={
                  showRank
                    ? `#${settings.sort === 'trending' ? card.record.trending : card.record.popularity}`
                    : ''
                }
                blackness={card.record.blackness}
                showBlackness={showBlackness}
                pinned={pinnedSlugs ? pinnedSlugs.has(card.record.slug) : false}
                favorite={favorites.has(card.record.slug)}
              />
            ))}
          </ul>
        )
      })}
    </div>
  )
}

export default memo(FontGrid)
