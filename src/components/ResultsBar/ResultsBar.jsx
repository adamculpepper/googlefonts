// The results bar is the safety net for every active filter, especially the
// three that default ON. Each one renders as a removable chip here, so the
// grid can never be silently narrowed: what is hiding fonts is always visible
// exactly where the count is.

import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import { PARAM_BY_KEY } from '../../data/params.js'
import Icon from '../Icon.jsx'
import './ResultsBar.css'

function formatCount(value) {
  return value.toLocaleString('en-US')
}

// Each chip: what it says, when it is active, and the neutral value that
// removes it. Removal always goes through setParam so it commits and lands in
// history like any other change.
function buildChips(settings, effectiveText) {
  const chips = []
  if (settings.q) {
    chips.push({ key: 'q', label: `Name: "${settings.q}"`, reset: ['q', ''] })
  }
  for (const category of settings.category) {
    const option = PARAM_BY_KEY.category.options.find((entry) => entry.value === category)
    chips.push({
      key: `category-${category}`,
      label: option ? option.label : category,
      reset: ['category', settings.category.filter((value) => value !== category)],
    })
  }
  if (settings.minWeight !== 'any') {
    chips.push({
      key: 'minWeight',
      label: `Has ${settings.minWeight}${settings.minWeight === '900' ? '' : '+'}`,
      reset: ['minWeight', 'any'],
    })
  }
  if (settings.blacknessMin > 0 || settings.blacknessMax < 100) {
    chips.push({
      key: 'blackness',
      label: `Ink ${settings.blacknessMin} to ${settings.blacknessMax}`,
      reset: [
        ['blacknessMin', 0],
        ['blacknessMax', 100],
      ],
    })
  }
  if (settings.variableOnly) {
    chips.push({ key: 'variableOnly', label: 'Variable only', reset: ['variableOnly', false] })
  }
  if (settings.hasItalic) {
    chips.push({ key: 'hasItalic', label: 'Has italic', reset: ['hasItalic', false] })
  }
  if (settings.hideNoto) {
    chips.push({ key: 'hideNoto', label: 'Noto hidden', reset: ['hideNoto', false] })
  }
  if (settings.latinOnly) {
    chips.push({ key: 'latinOnly', label: 'Latin only', reset: ['latinOnly', false] })
  }
  if (settings.supportsText && effectiveText) {
    chips.push({ key: 'supportsText', label: 'Supports your text', reset: ['supportsText', false] })
  }
  return chips
}

export default function ResultsBar({ shownStart, shownEnd, filteredCount, effectiveText }) {
  const { settings, canUndo, canRedo } = useAppState()
  const { setParam, setSettings, undo, redo, reset } = useAppActions()
  const chips = buildChips(settings, effectiveText)

  function removeChip(chip) {
    if (Array.isArray(chip.reset[0])) {
      // A chip backed by two params (the ink range) clears both in one entry.
      const next = { ...settings }
      for (const [key, value] of chip.reset) next[key] = value
      setSettings({ ...next, page: 1 })
      return
    }
    setParam(chip.reset[0], chip.reset[1])
  }

  const range =
    filteredCount === 0
      ? 'No fonts match'
      : shownStart === 1 && shownEnd === filteredCount
        ? `${formatCount(filteredCount)} fonts`
        : `${formatCount(shownStart)} to ${formatCount(shownEnd)} of ${formatCount(filteredCount)} fonts`

  return (
    <div className="results-bar">
      <span className="results-bar__count" role="status" aria-live="polite">
        {range}
      </span>
      {chips.length > 0 && (
        <ul className="results-bar__chips" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key} className="results-bar__chip">
              <span>{chip.label}</span>
              <button
                type="button"
                className="results-bar__chip-remove"
                aria-label={`Remove filter: ${chip.label}`}
                onClick={() => removeChip(chip)}
              >
                <Icon name="xmark" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Labeled on desktop, icon-only below the tablet breakpoint (the CSS
          hides the label spans); aria-labels carry the name either way. */}
      <div className="results-bar__actions">
        <button
          type="button"
          className="results-bar__action"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={undo}
        >
          <Icon name="undo" size={13} />
          <span className="results-bar__action-label">Undo</span>
        </button>
        <button
          type="button"
          className="results-bar__action"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={redo}
        >
          <Icon name="redo" size={13} />
          <span className="results-bar__action-label">Redo</span>
        </button>
        <button
          type="button"
          className="results-bar__action"
          aria-label="Reset all controls and filters"
          onClick={reset}
        >
          <Icon name="reset" size={13} />
          <span className="results-bar__action-label">Reset all</span>
        </button>
      </div>
    </div>
  )
}
