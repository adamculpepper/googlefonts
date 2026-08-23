// The memo chain from catalog to page: filter, then sort, then slice, each in
// its own useMemo so a sort change never re-runs the filter and a page turn
// never re-runs either. Coverage keys off the DEBOUNCED text: filtering the
// result set per keystroke would churn scroll position mid-thought.

import { useCallback, useMemo } from 'react'
import { useAppState } from '../context/AppContext.jsx'
import { filterFamilies, sortFamilies, sliceForView } from '../lib/familySelect.js'
import { testMask } from '../lib/coverage.js'
import { applyCase, FAMILY_NAME_CHARSET } from '../lib/textTransform.js'
import useDebouncedValue from './useDebouncedValue.js'

// Measured: 9 keystrokes cost 2 requests at 350ms; 250ms lands the redraw
// near half a second and still collapses a typed word into at most 3.
const TEXT_DEBOUNCE_MS = 250

export function useVisibleFamilies(records, probe) {
  const { settings, listFilter } = useAppState()
  const debouncedText = useDebouncedValue(settings.text, TEXT_DEBOUNCE_MS)

  const effectiveText = useMemo(
    () => applyCase(debouncedText.trim(), settings.case),
    [debouncedText, settings.case],
  )

  // Unknown answers keep the family: a default-ON filter may not hide a font
  // on a guess. False only when the mask can rule every character out.
  const coversText = useCallback(
    (record) => {
      if (!effectiveText) return true
      if (!record.mask) return null
      const result = testMask(record.mask, probe, effectiveText)
      if (!result.covered) return false
      return result.unknown.length > 0 ? null : true
    },
    [effectiveText, probe],
  )

  const filterInputs = useMemo(
    () => ({
      q: settings.q,
      category: settings.category,
      variableOnly: settings.variableOnly,
      hasItalic: settings.hasItalic,
      hideNoto: settings.hideNoto,
      latinOnly: settings.latinOnly,
      supportsText: settings.supportsText,
      minWeight: settings.minWeight,
      axisCountsForMin: settings.axisCountsForMin,
      blacknessMin: settings.blacknessMin,
      blacknessMax: settings.blacknessMax,
      // Wired when saved lists arrive; null means no list narrowing.
      listSlugs: listFilter ? listFilter.slugs : null,
    }),
    [
      settings.q,
      settings.category,
      settings.variableOnly,
      settings.hasItalic,
      settings.hideNoto,
      settings.latinOnly,
      settings.supportsText,
      settings.minWeight,
      settings.axisCountsForMin,
      settings.blacknessMin,
      settings.blacknessMax,
      listFilter,
    ],
  )

  const filtered = useMemo(
    () => filterFamilies(records, filterInputs, coversText),
    [records, filterInputs, coversText],
  )

  const sorted = useMemo(
    () => sortFamilies(filtered, settings.sort, settings.shuffleSeed),
    [filtered, settings.sort, settings.shuffleSeed],
  )

  const view = useMemo(
    () => sliceForView(sorted, settings.pageSize, settings.page),
    [sorted, settings.pageSize, settings.page],
  )

  return {
    filtered,
    sorted,
    pageRecords: view.pageRecords,
    pageCount: view.pageCount,
    page: view.clampedPage,
    showAll: settings.pageSize === 'all',
    effectiveText,
    // What the font manager should request: the transformed text, or the
    // fixed name charset when nothing is typed (every card then renders its
    // own family name from one stable cache generation).
    requestText: effectiveText || FAMILY_NAME_CHARSET,
  }
}
