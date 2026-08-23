// App state lives here as two contexts, not one. The live settings object
// changes on every keystroke and slider tick; the actions object never changes
// at all. Splitting them means a component that only dispatches (every control,
// every card action) never re-renders because someone typed a letter, which is
// the difference between a grid that feels instant and one that stutters while
// you type.
//
// Font LOAD state is deliberately absent: it lives in the font manager and
// reaches cards through useSyncExternalStore, so one face resolving re-renders
// exactly one card instead of the whole tree.

import { createContext, useContext, useEffect, useMemo, useReducer } from 'react'
import { PAGE_RESET_KEYS, getDefaults } from '../data/params.js'
import { readHashSettings, writeHashSettings } from '../lib/stateCodec.js'
import { STORAGE_KEYS, readStoredString, writeStoredString } from '../lib/storage.js'

const MAX_HISTORY = 30

function initialTheme() {
  const stored = readStoredString(STORAGE_KEYS.theme)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function initState() {
  // A share link boots the app straight into its view. The hash is untrusted,
  // so the codec hands back a fully validated settings object or nothing.
  const settings = readHashSettings() || getDefaults()
  return {
    settings,
    committed: settings,
    past: [],
    future: [],
    theme: initialTheme(),
    // Which saved list the grid is filtered to: null, 'favorites', or a list
    // id. Transient by design: lists live in this browser's storage, so a
    // share URL carrying a list filter would open broken for everyone else.
    listFilter: null,
    // 'ok' | 'blocked' | 'offline' — drives the banner, set by the manager's
    // connectivity probe. Never in history.
    connectivity: 'ok',
  }
}

const sameSettings = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function withHistory(state, nextSettings) {
  return {
    ...state,
    settings: nextSettings,
    committed: nextSettings,
    past: [...state.past, state.committed].slice(-MAX_HISTORY),
    future: [],
  }
}

// Filter and sort changes invalidate the page number: page 7 of a result set
// that no longer exists is nonsense. Doing it inside the reducer keeps the
// reset in the same state transition (and the same undo entry) as the change
// that caused it, instead of a trailing effect that fires one render later.
function withPageReset(settings, key) {
  if (!PAGE_RESET_KEYS.has(key) || settings.page === 1) return settings
  return { ...settings, page: 1 }
}

function reducer(state, action) {
  switch (action.type) {
    case 'UPDATE_PARAM':
      return {
        ...state,
        settings: withPageReset({ ...state.settings, [action.key]: action.value }, action.key),
      }

    case 'COMMIT': {
      if (sameSettings(state.settings, state.committed)) return state
      // Preview text commits on blur or Enter, so the page reset for a changed
      // text lands here rather than on every keystroke.
      const settings =
        state.settings.text !== state.committed.text && state.settings.page !== 1
          ? { ...state.settings, page: 1 }
          : state.settings
      return {
        ...state,
        settings,
        committed: settings,
        past: [...state.past, state.committed].slice(-MAX_HISTORY),
        future: [],
      }
    }

    case 'SET_SETTINGS':
      return withHistory(state, action.settings)

    case 'RESET':
      return withHistory(state, getDefaults())

    case 'UNDO': {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        ...state,
        settings: previous,
        committed: previous,
        past: state.past.slice(0, -1),
        future: [state.committed, ...state.future].slice(0, MAX_HISTORY),
      }
    }

    case 'REDO': {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        ...state,
        settings: next,
        committed: next,
        past: [...state.past, state.committed].slice(-MAX_HISTORY),
        future: state.future.slice(1),
      }
    }

    // View state that should mirror to the URL (deep links) without becoming
    // an undo step: opening the detail panel is navigation, not an edit.
    case 'SET_PARAM_QUIET': {
      const settings = { ...state.settings, [action.key]: action.value }
      return {
        ...state,
        settings,
        committed: { ...state.committed, [action.key]: action.value },
      }
    }

    case 'SET_THEME':
      return { ...state, theme: action.theme }

    // Transient view state: never history, never the URL.
    case 'SET_LIST_FILTER':
      return {
        ...state,
        listFilter: action.listFilter,
        settings: state.settings.page === 1 ? state.settings : { ...state.settings, page: 1 },
        committed: state.committed.page === 1 ? state.committed : { ...state.committed, page: 1 },
      }

    case 'SET_CONNECTIVITY':
      return state.connectivity === action.status ? state : { ...state, connectivity: action.status }

    default:
      return state
  }
}

const AppStateContext = createContext(null)
const AppActionsContext = createContext(null)

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState)

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme
    writeStoredString(STORAGE_KEYS.theme, state.theme)
  }, [state.theme])

  // The URL mirrors committed settings only: mid-drag and mid-typing values
  // stay out of it, so one gesture is one replaceState.
  useEffect(() => {
    writeHashSettings(state.committed)
  }, [state.committed])

  // The pinned mirror lives here, on committed state, so Undo, Redo, Reset
  // and presets keep localStorage honest; mirroring only inside the tray's
  // own write path left stale pins that the boot seeder replayed next load.
  useEffect(() => {
    writeStoredString(STORAGE_KEYS.pinned, state.committed.pinned)
  }, [state.committed.pinned])

  // Built once. Stable identity is the entire point: dispatch never changes,
  // so neither does this object, so consumers of the actions context never
  // re-render from state churn. toggleTheme reads the DOM attribute (stamped
  // by the theme effect above) instead of closing over state.theme, which
  // would force this memo to rebuild on every theme flip.
  const actions = useMemo(
    () => ({
      updateParam: (key, value) => dispatch({ type: 'UPDATE_PARAM', key, value }),
      commit: () => dispatch({ type: 'COMMIT' }),
      setParam: (key, value) => {
        dispatch({ type: 'UPDATE_PARAM', key, value })
        dispatch({ type: 'COMMIT' })
      },
      setParamQuiet: (key, value) => dispatch({ type: 'SET_PARAM_QUIET', key, value }),
      setSettings: (settings) => dispatch({ type: 'SET_SETTINGS', settings }),
      reset: () => dispatch({ type: 'RESET' }),
      undo: () => dispatch({ type: 'UNDO' }),
      redo: () => dispatch({ type: 'REDO' }),
      setTheme: (theme) => dispatch({ type: 'SET_THEME', theme }),
      toggleTheme: () => {
        const current = document.documentElement.dataset.theme
        dispatch({ type: 'SET_THEME', theme: current === 'dark' ? 'light' : 'dark' })
      },
      setListFilter: (listFilter) => dispatch({ type: 'SET_LIST_FILTER', listFilter }),
      setConnectivity: (status) => dispatch({ type: 'SET_CONNECTIVITY', status }),
    }),
    [],
  )

  const stateValue = useMemo(
    () => ({
      ...state,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state],
  )

  return (
    <AppStateContext.Provider value={stateValue}>
      <AppActionsContext.Provider value={actions}>{children}</AppActionsContext.Provider>
    </AppStateContext.Provider>
  )
}

export function useAppState() {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useAppState must be used within AppProvider')
  return context
}

export function useAppActions() {
  const context = useContext(AppActionsContext)
  if (!context) throw new Error('useAppActions must be used within AppProvider')
  return context
}

// Convenience for components that genuinely need both.
export function useApp() {
  return { ...useAppState(), ...useAppActions() }
}
