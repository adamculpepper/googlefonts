import { useEffect, useState } from 'react'

// Hands back `value` once it has held still for `delayMs`. Typing in the search
// field changes state on every keystroke, but re-filtering 1,900 families is
// not something to do per letter, so the expensive readers subscribe to this
// instead of to the raw value.
//
// The first render returns the value as it is, so a field that starts with
// content never flashes empty waiting for a tick that has not run yet. The
// cleanup drops the pending timer on the next change and on unmount, so a
// keystroke landing after the component closes cannot set state.
export default function useDebouncedValue(value, delayMs) {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
