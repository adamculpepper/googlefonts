// Pill group for short option sets where seeing all the choices beats a select.
//
// The param-level help hangs on the label, never on the wrapper: on the
// wrapper every button inherits the same tooltip, which is exactly useless on
// hover ("what does THIS one do?"). Options may carry their own `title`,
// which doubles as the accessible name when the visual label is a glyph
// (the case control's "AA" says nothing to a screen reader).
export default function SegmentedControl({ param, value, onChange, disabled = false }) {
  const { label, options, help } = param

  return (
    <div className={disabled ? 'control is-disabled' : 'control'}>
      <div className="head" title={help || ''}>
        <span className="label">{label}</span>
      </div>
      <div className="segmented-control" role="group" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              className={selected ? 'is-selected' : ''}
              aria-pressed={selected}
              aria-label={option.title || undefined}
              title={option.title || undefined}
              disabled={disabled}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
