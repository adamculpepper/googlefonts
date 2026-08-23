// The presets row above the sidebar groups: pick a starting point, then tune.

import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import { PRESETS } from '../../data/presets.js'
import './Presets.css'

export default function Presets() {
  const { settings } = useAppState()
  const { setSettings, reset } = useAppActions()

  function applyPreset(preset) {
    if (preset.reset) {
      reset()
      return
    }
    setSettings({ ...settings, ...preset.patch, page: 1 })
  }

  return (
    <div className="presets" aria-label="Starting points">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="presets__button"
          onClick={() => applyPreset(preset)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
