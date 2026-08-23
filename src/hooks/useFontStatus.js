// Per-card subscription to the font manager. useSyncExternalStore means one
// face resolving re-renders exactly one card; nothing about font loading ever
// enters React state. The manager guarantees getStatus returns a stable
// reference between emits, which is what lets React bail out of re-renders.

import { useCallback, useSyncExternalStore } from 'react'
import { useFontManager } from '../context/FontManagerContext.jsx'

export function useFontStatus(fontKey) {
  const manager = useFontManager()

  const subscribe = useCallback(
    (callback) => manager.subscribe(fontKey, callback),
    [manager, fontKey],
  )
  const getSnapshot = useCallback(() => manager.getStatus(fontKey), [manager, fontKey])

  return useSyncExternalStore(subscribe, getSnapshot)
}
