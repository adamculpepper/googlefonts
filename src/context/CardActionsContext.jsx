// Stable handler bundle for card actions. Cards are memoized on primitive
// props, so their handlers cannot arrive as fresh closures per render; they
// come from this context (one object, stable identity) and receive the family
// slug explicitly. FontStage provides the real handlers; the no-op default
// keeps a standalone card (dev routes, tests) from crashing.

import { createContext, useContext } from 'react'

const noop = () => {}

export const CARD_ACTION_DEFAULTS = Object.freeze({
  openDetail: noop,
  togglePin: noop,
  toggleFavorite: noop,
  copyCss: noop,
  isPinned: () => false,
  isFavorite: () => false,
})

const CardActionsContext = createContext(CARD_ACTION_DEFAULTS)

export function CardActionsProvider({ actions, children }) {
  return <CardActionsContext.Provider value={actions}>{children}</CardActionsContext.Provider>
}

export function useCardActions() {
  return useContext(CardActionsContext)
}
