// The shell: header, connectivity banner, sidebar (a drawer below 992px,
// Bootstrap's lg breakpoint), the stage, and the attribution footer. Catalog
// loading lives here so everything below can assume records exist. Global
// keyboard shortcuts live in one effect, per the house pattern.

import { useEffect, useRef, useState } from 'react'
import { useAppActions } from './context/AppContext.jsx'
import { FontManagerProvider, useFontManager } from './context/FontManagerContext.jsx'
import { CollectionsProvider } from './context/CollectionsContext.jsx'
import { ToastProvider } from './components/Toast/Toast.jsx'
import { useCatalog } from './hooks/useCatalog.js'
import useMediaQuery from './hooks/useMediaQuery.js'
import Header from './components/Header/Header.jsx'
import Banner from './components/Banner/Banner.jsx'
import Sidebar from './components/Sidebar/Sidebar.jsx'
import FontStage from './components/FontStage/FontStage.jsx'
import ShortcutsSheet from './components/ShortcutsSheet/ShortcutsSheet.jsx'
import './App.css'

const DRAWER_BREAKPOINT = '(max-width: 991.98px)'

function ConnectivityProbe() {
  const manager = useFontManager()
  const { setConnectivity } = useAppActions()

  useEffect(() => {
    let cancelled = false
    let lastStatus = 'ok'
    function probe() {
      manager.probeConnectivity().then((status) => {
        if (cancelled) return
        // Recovery forgives the families that failed while the network was
        // down; without this they stay 'Could not load' for the session.
        if (status === 'ok' && lastStatus !== 'ok') manager.resetRetries()
        lastStatus = status
        setConnectivity(status)
      })
    }
    probe()
    const goOnline = () => probe()
    const goOffline = () => setConnectivity('offline')
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      cancelled = true
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [manager, setConnectivity])

  return null
}

function focusCardByOffset(offset) {
  const cards = [...document.querySelectorAll('.font-card__open')]
  if (cards.length === 0) return
  const activeIndex = cards.indexOf(document.activeElement)
  if (activeIndex === -1) {
    cards[0].focus()
    return
  }
  const next = cards[activeIndex + offset]
  if (next) next.focus()
}

export default function App() {
  const catalog = useCatalog()
  const isDrawerLayout = useMediaQuery(DRAWER_BREAKPOINT)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const drawerOpenRef = useRef(drawerOpen)
  drawerOpenRef.current = drawerOpen

  // Leaving drawer widths closes the drawer; a desktop sidebar is not "open".
  useEffect(() => {
    if (!isDrawerLayout) setDrawerOpen(false)
  }, [isDrawerLayout])

  useEffect(() => {
    function onKeyDown(event) {
      // Never steal keys from a field the person is typing in.
      const target = event.target
      if (target.closest?.('input, select, textarea, [contenteditable]')) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // While any dialog is up, every shortcut belongs to that dialog's own
      // focus trap. Firing j/k/t/? from inside a modal moved focus to cards
      // hidden behind the opaque overlay, which also killed Escape (the
      // trap's listener never sees keys from outside its container).
      if (document.querySelector('[aria-modal="true"]')) return

      if (event.key === 't') {
        event.preventDefault()
        document.getElementById('preview-text-input')?.focus()
      } else if (event.key === '/') {
        event.preventDefault()
        // The name search is the only text control the sidebar renders (the
        // preview text lives in the header), so this selector is unambiguous.
        document.querySelector('.sidebar .control input[type="text"]')?.focus()
      } else if (event.key === '?') {
        event.preventDefault()
        setShortcutsOpen(true)
      } else if (event.key === 'j' || event.key === 'ArrowDown') {
        if (document.activeElement?.classList.contains('font-card__open') || event.key === 'j') {
          event.preventDefault()
          focusCardByOffset(1)
        }
      } else if (event.key === 'k') {
        event.preventDefault()
        focusCardByOffset(-1)
      } else if (event.key === 'Escape') {
        if (drawerOpenRef.current) setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <FontManagerProvider>
      <ToastProvider>
        <CollectionsProvider>
        <ConnectivityProbe />
        <div className="app">
          <Header
            showSidebarButton={isDrawerLayout}
            onToggleSidebar={() => setDrawerOpen((open) => !open)}
          />
          <Banner />
          <div className="app__body">
            {catalog.status === 'loading' && (
              <div className="app__notice">Loading the font catalog...</div>
            )}
            {catalog.status === 'error' && (
              <div className="app__notice">
                The font catalog could not load. Check the connection and reload the page.
              </div>
            )}
            {catalog.status === 'ready' && (
              <>
                {isDrawerLayout && drawerOpen && (
                  <div className="app__scrim" onClick={() => setDrawerOpen(false)} />
                )}
                <div
                  className={
                    isDrawerLayout && drawerOpen ? 'app__sidebar is-drawer-open' : 'app__sidebar'
                  }
                >
                  <Sidebar />
                </div>
                <FontStage records={catalog.records} probe={catalog.probe} />
              </>
            )}
          </div>
          <footer className="app__footer">
            <span>
              Not affiliated with Google. Font files are served by{' '}
              <a href="https://fonts.google.com" target="_blank" rel="noopener noreferrer">
                Google Fonts
              </a>
              ; every typeface belongs to its designers and foundries. See{' '}
              <a
                href="https://fonts.google.com/attribution"
                target="_blank"
                rel="noopener noreferrer"
              >
                attribution
              </a>{' '}
              for credits and licenses.
            </span>
          </footer>
        </div>
        {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
        </CollectionsProvider>
      </ToastProvider>
    </FontManagerProvider>
  )
}
