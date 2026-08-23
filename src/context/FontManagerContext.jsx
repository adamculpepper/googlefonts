// Provides the one font manager instance. A context rather than a module
// singleton so the Playwright harness and any future dev route can mount the
// app around a manager with a stubbed fetch.

import { createContext, useContext, useMemo } from 'react'
import { createFontManager } from '../lib/fontLoader.js'

const FontManagerContext = createContext(null)

export function FontManagerProvider({ manager: injected, children }) {
  const manager = useMemo(() => injected || createFontManager(), [injected])

  // Deliberately NOT destroyed on unmount. StrictMode's dev-time
  // mount-unmount-remount would destroy the memoized instance and then keep
  // using it, leaving every request silently ignored (this happened; the grid
  // froze at skeletons). The manager has document lifetime; destroy() exists
  // for tests and the harness, which own their instances.
  return <FontManagerContext.Provider value={manager}>{children}</FontManagerContext.Provider>
}

export function useFontManager() {
  const manager = useContext(FontManagerContext)
  if (!manager) throw new Error('useFontManager must be used within FontManagerProvider')
  return manager
}
