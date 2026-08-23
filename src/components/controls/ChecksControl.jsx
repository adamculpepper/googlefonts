// Checkbox group for a param whose value is an array of option values. Real
// checkboxes inside a fieldset, so the group has one accessible name and a
// screen reader reads "3 of 5 checked" the way it would on any form.
//
// Empty means unrestricted, not empty: a category filter with nothing checked
// shows every category. The registry help text is where that gets said out
// loud, because the widget alone cannot express it.
export default function ChecksControl({ param, value, onChange, counts, disabled = false }) {
  const { label, options, help } = param
  const selected = Array.isArray(value) ? value : []

  function toggle(optionValue) {
    const turningOn = !selected.includes(optionValue)
    // Rebuilt in registry order rather than click order, so two people who
    // ticked the same boxes in a different sequence still land on the same
    // share URL.
    const next = options
      .map((option) => option.value)
      .filter((candidate) => (candidate === optionValue ? turningOn : selected.includes(candidate)))
    onChange(next)
  }

  return (
    <fieldset
      className={disabled ? 'control is-checks is-disabled' : 'control is-checks'}
      title={help || ''}
    >
      <legend className="label">{label}</legend>
      <div className="checks-group">
        {options.map((option) => {
          const count = counts?.[option.value]
          return (
            <label key={option.value} className="check-row">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                disabled={disabled}
                onChange={() => toggle(option.value)}
              />
              <span className="check-label">{option.label}</span>
              {count !== undefined && <span className="check-count">{count}</span>}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
