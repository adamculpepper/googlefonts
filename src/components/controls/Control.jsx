import ChecksControl from './ChecksControl.jsx'
import SegmentedControl from './SegmentedControl.jsx'
import SelectControl from './SelectControl.jsx'
import SliderControl from './SliderControl.jsx'
import TextControl from './TextControl.jsx'
import ToggleControl from './ToggleControl.jsx'
import './controls.css'

// Dispatches a registry entry to its control. Continuous inputs update live and
// commit when the gesture ends; discrete inputs update and commit at once.
//
// `counts` is forwarded only because the checks control can show a per-option
// result count. Every other type ignores it, so callers that have no counts to
// give simply leave it off.
export default function Control({
  param,
  value,
  updateParam,
  commit,
  setParam,
  counts,
  disabled = false,
}) {
  const onChange = (next) => updateParam(param.key, next)
  const onCommit = () => commit()
  const onSet = (next) => setParam(param.key, next)

  switch (param.type) {
    case 'slider':
      return (
        <SliderControl
          param={param}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          disabled={disabled}
        />
      )
    case 'select':
      return <SelectControl param={param} value={value} onChange={onSet} disabled={disabled} />
    case 'segmented':
      return <SegmentedControl param={param} value={value} onChange={onSet} disabled={disabled} />
    case 'toggle':
      return <ToggleControl param={param} value={value} onChange={onSet} disabled={disabled} />
    case 'checks':
      return (
        <ChecksControl
          param={param}
          value={value}
          onChange={onSet}
          counts={counts}
          disabled={disabled}
        />
      )
    case 'text':
      return (
        <TextControl
          param={param}
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          disabled={disabled}
        />
      )
    default:
      return null
  }
}
