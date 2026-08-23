// The sidebar renders straight from the param registry: groups in GROUPS
// order, every visible param through the Control dispatcher. Adding a knob to
// params.js is the whole job; nothing here is per-control.

import { GROUPS, PARAM_REGISTRY } from '../../data/params.js'
import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import Control from '../controls/Control.jsx'
import ControlSection, { useSectionOpenState } from '../ControlSection/ControlSection.jsx'
import Presets from '../Presets/Presets.jsx'
import './Sidebar.css'

const OPEN_BY_DEFAULT = ['Preview', 'Weight', 'Filters']

// The Weight group mixes two sentences: how specimens are DRAWN (mode and
// slider) and which families are SHOWN (min weight, ink range). A divider
// with a sub-label keeps them from reading as one thing.
const FILTER_DIVIDER_BEFORE = 'minWeight'

export default function Sidebar({ categoryCounts }) {
  const { settings } = useAppState()
  const { updateParam, commit, setParam } = useAppActions()
  const { openState, toggleSection } = useSectionOpenState(GROUPS, OPEN_BY_DEFAULT)

  return (
    <aside className="sidebar" aria-label="Font controls and filters">
      <Presets />
      <div className="sidebar__sections">
        {GROUPS.map((group) => {
          const params = PARAM_REGISTRY.filter(
            (param) =>
              param.group === group &&
              !param.hidden &&
              param.surface !== 'bar' &&
              (!param.showIf || param.showIf(settings)),
          )
          if (params.length === 0) return null
          return (
            <ControlSection
              key={group}
              title={group}
              open={openState[group]}
              onToggle={() => toggleSection(group)}
            >
              {params.map((param) => (
                <div key={param.key} className="sidebar__control-slot">
                  {param.key === FILTER_DIVIDER_BEFORE && (
                    <p className="sidebar__filter-note">Only show fonts that...</p>
                  )}
                  <Control
                    param={param}
                    value={settings[param.key]}
                    updateParam={updateParam}
                    commit={commit}
                    setParam={setParam}
                    counts={param.key === 'category' ? categoryCounts : undefined}
                  />
                </div>
              ))}
            </ControlSection>
          )
        })}
      </div>
      {/* One child, so the inline space before the link survives the flex box
          that centres it. Same credit strip as the color palette site. */}
      <div className="sidebar__credit">
        <span>
          Made by{' '}
          <a href="https://adamculpepper.net" target="_blank" rel="noopener noreferrer">
            Adam Culpepper
          </a>
        </span>
      </div>
    </aside>
  )
}
