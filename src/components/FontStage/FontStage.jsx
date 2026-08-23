// The stage: scroll container, results bar, grid, pagination, plus the three
// overlays that act on fonts: the detail panel, the compare tray, and the
// compare view. It owns the card action handlers (one stable object through
// context, so memoized cards never see a fresh closure) and the pinned set
// (the hidden `pinned` param is the source of truth; localStorage only seeds
// it when a session starts without a share link).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import { CardActionsProvider } from '../../context/CardActionsContext.jsx'
import { useCollections } from '../../context/CollectionsContext.jsx'
import { useFontManager } from '../../context/FontManagerContext.jsx'
import { useVisibleFamilies } from '../../hooks/useVisibleFamilies.js'
import { useToast } from '../Toast/Toast.jsx'
import { resolveWeight } from '../../lib/fontUrl.js'
import {
  MAX_PINS,
  isPinned as pinnedHas,
  packPinned,
  togglePin as codecTogglePin,
  unpackPinned,
} from '../../lib/pinnedCodec.js'
import { STORAGE_KEYS, readStoredString } from '../../lib/storage.js'
import FontGrid from '../FontGrid/FontGrid.jsx'
import ResultsBar from '../ResultsBar/ResultsBar.jsx'
import Pagination from '../Pagination/Pagination.jsx'
import DetailPanel from '../DetailPanel/DetailPanel.jsx'
import CompareTray from '../CompareTray/CompareTray.jsx'
import CompareView from '../CompareView/CompareView.jsx'
import './FontStage.css'

const CSS_FALLBACK_BY_CATEGORY = {
  'Sans Serif': 'sans-serif',
  Serif: 'serif',
  Display: 'serif',
  Handwriting: 'cursive',
  Monospace: 'monospace',
}

// Thickest and Lightest modes draw each family at its own extreme; requesting
// 900 or 100 and letting the per-family snap do the work is what makes that
// possible with one shared request weight. FontGrid uses the same table.
const WEIGHT_FOR_MODE = { thickest: 900, lightest: 100 }

export default function FontStage({ records, probe }) {
  const { settings } = useAppState()
  const { setParam, setParamQuiet } = useAppActions()
  // useToast returns the show function itself, not an object.
  const showToast = useToast()
  const { toggleFavorite, isFavorite } = useCollections()
  const scrollRef = useRef(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const view = useVisibleFamilies(records, probe)

  const recordBySlug = useMemo(() => {
    const map = new Map()
    for (const record of records) map.set(record.slug, record)
    return map
  }, [records])

  const requestedWeight = WEIGHT_FOR_MODE[settings.weightMode] ?? settings.weight

  // The pinned param is the source of truth; decoding is defensive, so a link
  // carrying a retired family simply drops it.
  const pins = useMemo(
    () => unpackPinned(settings.pinned, recordBySlug),
    [settings.pinned, recordBySlug],
  )
  const pinnedSlugs = useMemo(() => new Set(pins.map((pin) => pin.slug)), [pins])
  const pinnedRecords = useMemo(
    () => pins.map((pin) => recordBySlug.get(pin.slug)).filter(Boolean),
    [pins, recordBySlug],
  )

  // localStorage mirroring happens in AppContext on committed.pinned, so it
  // also tracks Undo/Reset; this writer only owns the param.
  const writePins = useCallback(
    (nextPins) => setParam('pinned', packPinned(nextPins)),
    [setParam],
  )

  // Boot seeding: local pins restore only when the URL brought none, so a
  // shared link never inherits the reader's own pins.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    seededRef.current = true
    if (settings.pinned) return
    const stored = readStoredString(STORAGE_KEYS.pinned, '')
    if (stored) setParam('pinned', stored)
  }, [settings.pinned, setParam])

  // Live values reach the stable action bundle through a ref, the same move
  // AppContext.toggleTheme makes, so the memo never churns.
  const pinContextRef = useRef(null)
  pinContextRef.current = { pins, requestedWeight, italic: settings.italic }

  const cardActions = useMemo(
    () => ({
      openDetail: (slug) => setParamQuiet('detail', slug),
      togglePin: (slug) => {
        const record = recordBySlug.get(slug)
        if (!record) return
        const context = pinContextRef.current
        const resolved = resolveWeight(record, context.requestedWeight, context.italic)
        const result = codecTogglePin(context.pins, {
          slug,
          weight: resolved.cssWeight,
          italic: resolved.italic,
        })
        if (result.atLimit) {
          showToast(`${MAX_PINS} fonts is the most you can compare at once`)
          return
        }
        writePins(result.pins)
      },
      toggleFavorite,
      copyCss: async (slug) => {
        const record = recordBySlug.get(slug)
        if (!record) return
        const fallback = CSS_FALLBACK_BY_CATEGORY[record.category] || 'sans-serif'
        try {
          await navigator.clipboard.writeText(`font-family: '${record.name}', ${fallback};`)
          showToast(`CSS for ${record.displayName} copied`)
        } catch {
          showToast('Could not reach the clipboard')
        }
      },
      isPinned: (slug) => pinnedHas(pinContextRef.current.pins, slug),
      isFavorite,
    }),
    [recordBySlug, showToast, writePins, setParamQuiet, toggleFavorite, isFavorite],
  )

  const detailRecord = settings.detail ? recordBySlug.get(settings.detail) || null : null

  // A stale detail slug (an old share link) should not linger in the URL.
  useEffect(() => {
    if (settings.detail && !detailRecord) setParamQuiet('detail', '')
  }, [settings.detail, detailRecord, setParamQuiet])

  // Pinned faces normally stay loaded because FontGrid appends them to every
  // request, but FontGrid unmounts when the filtered set is empty. Without
  // this fallback, opening Compare from a "No fonts match" state (or changing
  // the text there) leaves every compare row a skeleton.
  const manager = useFontManager()
  useEffect(() => {
    if (view.filtered.length > 0 || pinnedRecords.length === 0) return
    manager.request({
      families: pinnedRecords,
      text: view.requestText,
      weight: requestedWeight,
      italic: settings.italic,
    })
  }, [
    manager,
    view.filtered.length,
    pinnedRecords,
    view.requestText,
    requestedWeight,
    settings.italic,
  ])

  const visibleRecords = view.showAll ? view.sorted : view.pageRecords
  const shownStart =
    view.filtered.length === 0
      ? 0
      : view.showAll
        ? 1
        : (view.page - 1) * Number(settings.pageSize) + 1
  const shownEnd = view.showAll
    ? view.filtered.length
    : Math.min(view.page * Number(settings.pageSize), view.filtered.length)

  function goToPage(page) {
    setParam('page', page)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  function unpin(slug) {
    const next = pins.filter((pin) => pin.slug !== slug)
    writePins(next)
    if (next.length === 0) setCompareOpen(false)
  }

  return (
    <>
      <div
        className={pins.length > 0 ? 'font-stage has-compare-tray' : 'font-stage'}
        ref={scrollRef}
      >
        <ResultsBar
          shownStart={shownStart}
          shownEnd={shownEnd}
          filteredCount={view.filtered.length}
          effectiveText={view.effectiveText}
        />
        {view.filtered.length === 0 ? (
          <div className="font-stage__empty">
            <p className="font-stage__empty-title">No fonts match</p>
            <p className="font-stage__empty-hint">
              Try removing a filter chip above, or reset everything from the sidebar.
            </p>
          </div>
        ) : (
          <CardActionsProvider actions={cardActions}>
            <FontGrid
              records={visibleRecords}
              requestText={view.requestText}
              typedText={view.effectiveText}
              scrollRef={scrollRef}
              pinnedSlugs={pinnedSlugs}
              pinnedRecords={pinnedRecords}
            />
          </CardActionsProvider>
        )}
        {!view.showAll && (
          <Pagination page={view.page} pageCount={view.pageCount} onSetPage={goToPage} />
        )}
      </div>

      <CompareTray
        pins={pins}
        records={recordBySlug}
        onUnpin={unpin}
        onClear={() => {
          writePins([])
          setCompareOpen(false)
        }}
        onOpenCompare={() => setCompareOpen(true)}
      />

      {compareOpen && (
        <CompareView
          pins={pins}
          records={recordBySlug}
          requestText={view.requestText}
          typedText={view.effectiveText}
          requestedWeight={requestedWeight}
          italic={settings.italic}
          onUnpin={unpin}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {detailRecord && (
        <DetailPanel
          record={detailRecord}
          settings={{ ...settings, weight: requestedWeight }}
          onClose={() => setParamQuiet('detail', '')}
        />
      )}
    </>
  )
}
