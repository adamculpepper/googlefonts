// The three controls that actually start a search: name, category, sort.
// They sit above the grid rather than inside the sidebar, because looking for
// a typeface is the point of the app and should not begin with opening a
// panel. Which controls live here is decided by the registry (surface: 'bar'),
// so a control has exactly one home and the two surfaces cannot drift.

import { PARAM_BY_KEY } from '../../data/params.js'
import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import Icon from '../Icon.jsx'
import './FilterBar.css'

// Short enough to sit in a row of pills. The registry keeps the full names for
// the chips and for anything that reads a value aloud.
const CATEGORY_PILL_LABELS = {
  'Sans Serif': 'Sans',
  Serif: 'Serif',
  Display: 'Display',
  Handwriting: 'Script',
  Monospace: 'Mono',
}

export default function FilterBar() {
  const { settings } = useAppState()
  const { updateParam, commit, setParam } = useAppActions()
  const searchParam = PARAM_BY_KEY.q
  const categoryParam = PARAM_BY_KEY.category
  const sortParam = PARAM_BY_KEY.sort
  const active = settings.category

  // Toggling stays in registry order rather than click order, so two people
  // who pick the same categories in a different sequence share one URL.
  function toggleCategory(value) {
    const next = active.includes(value)
      ? active.filter((entry) => entry !== value)
      : categoryParam.options
          .map((option) => option.value)
          .filter((option) => option === value || active.includes(option))
    setParam('category', next)
  }

  return (
    <div className="filter-bar">
      <div className="filter-bar__search">
        <Icon name="search" size={13} className="filter-bar__search-icon" />
        <input
          type="text"
          className="filter-bar__search-input"
          value={settings.q}
          maxLength={searchParam.maxLength}
          placeholder={searchParam.placeholder}
          aria-label={searchParam.label}
          onChange={(event) => updateParam('q', event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
              event.currentTarget.blur()
            }
          }}
        />
        {settings.q && (
          <button
            type="button"
            className="filter-bar__search-clear"
            aria-label="Clear the name search"
            title="Clear the name search"
            onClick={() => setParam('q', '')}
          >
            <Icon name="xmark" size={12} />
          </button>
        )}
      </div>

      <div className="filter-bar__categories" role="group" aria-label={categoryParam.label}>
        <button
          type="button"
          className={
            active.length === 0 ? 'filter-bar__pill is-active' : 'filter-bar__pill'
          }
          aria-pressed={active.length === 0}
          onClick={() => setParam('category', [])}
        >
          All
        </button>
        {categoryParam.options.map((option) => {
          const selected = active.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              className={selected ? 'filter-bar__pill is-active' : 'filter-bar__pill'}
              aria-pressed={selected}
              title={option.label}
              onClick={() => toggleCategory(option.value)}
            >
              {CATEGORY_PILL_LABELS[option.value] || option.label}
            </button>
          )
        })}
      </div>

      <label className="filter-bar__sort">
        <span className="filter-bar__sort-label">Sort</span>
        <select
          value={settings.sort}
          aria-label={sortParam.label}
          onChange={(event) => setParam('sort', event.target.value)}
        >
          {sortParam.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
