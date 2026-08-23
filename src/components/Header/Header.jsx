// The header owns the preview text input: it is the control people touch
// most, so it sits above the grid rather than inside the sidebar. Typing
// updates live settings only (each keystroke is cheap because state and
// actions are split contexts); the commit lands on blur or Enter so one word
// is one undo entry and one URL write.

import { useAppActions, useAppState } from '../../context/AppContext.jsx'
import { PARAM_BY_KEY } from '../../data/params.js'
import { VERSION } from '../../data/version.js'
import { shareUrl } from '../../lib/stateCodec.js'
import useCopyFlag from '../../hooks/useCopyFlag.js'
import Icon from '../Icon.jsx'
import CollectionsMenu from '../CollectionsMenu/CollectionsMenu.jsx'
import './Header.css'

function randomSeed() {
  // Entropy generated in the UI layer only (house rule: lib code never reads
  // a random source), then stored like any other setting so the order a user
  // liked survives in their share link.
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return (buffer[0] % 2147483646) + 1
}

export default function Header({ onToggleSidebar, showSidebarButton }) {
  const { settings, committed, theme, canUndo, canRedo } = useAppState()
  const { updateParam, commit, setParam, setSettings, toggleTheme, undo, redo, reset } =
    useAppActions()
  const { copied: shareCopied, flagCopied: markShareCopied } = useCopyFlag()
  const textParam = PARAM_BY_KEY.text

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl(committed))
      markShareCopied()
    } catch {
      /* Clipboard blocked: the URL bar already holds the same link. */
    }
  }

  function shuffle() {
    // One history entry: new seed and the random sort land together.
    setSettings({ ...settings, sort: 'random', shuffleSeed: randomSeed(), page: 1 })
  }

  return (
    <header className="header">
      {showSidebarButton && (
        <button
          type="button"
          className="header__button"
          aria-label="Open filters"
          title="Filters"
          onClick={onToggleSidebar}
        >
          <Icon name="filter" size={16} />
        </button>
      )}
      <a className="header__brand" href="./">
        <span className="header__brand-mark" aria-hidden="true">Aa</span>
        <span className="header__brand-name">Google Fonts Browser</span>
        {/* The build suffix is stamped by the deploy workflow (github.run_number),
            so every deploy carries a fresh number with no file to bump; a local
            build shows the bare version. */}
        <span className="header__version">
          v{VERSION}
          {import.meta.env.VITE_BUILD ? `.${import.meta.env.VITE_BUILD}` : ''}
        </span>
      </a>
      <div className="header__preview">
        <input
          id="preview-text-input"
          className="header__preview-input"
          type="text"
          value={settings.text}
          maxLength={textParam.maxLength}
          placeholder={textParam.placeholder}
          aria-label="Preview text, drawn by every font on the page"
          onChange={(event) => updateParam('text', event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
              event.currentTarget.blur()
            }
          }}
        />
        {settings.text && (
          <button
            type="button"
            className="header__preview-clear"
            aria-label="Clear preview text"
            title="Clear preview text"
            onClick={() => setParam('text', '')}
          >
            <Icon name="xmark" size={14} />
          </button>
        )}
      </div>
      <div className="header__tools">
        <CollectionsMenu />
        <span className="header__tools-divider" aria-hidden="true" />
        {/* History sits with the other app-wide actions rather than in the bar
            that reports on the grid. Labelled on desktop, icons on narrow
            screens, and Reset all keeps a glyph of its own so it can never be
            mistaken for Undo. */}
        <button
          type="button"
          className="header__action"
          aria-label="Undo"
          title="Undo"
          disabled={!canUndo}
          onClick={undo}
        >
          <Icon name="undo" size={13} />
          <span className="header__action-label">Undo</span>
        </button>
        <button
          type="button"
          className="header__action"
          aria-label="Redo"
          title="Redo"
          disabled={!canRedo}
          onClick={redo}
        >
          <Icon name="redo" size={13} />
          <span className="header__action-label">Redo</span>
        </button>
        <button
          type="button"
          className="header__action"
          aria-label="Reset all controls and filters"
          title="Reset all controls and filters"
          onClick={reset}
        >
          <Icon name="reset" size={13} />
          <span className="header__action-label">Reset all</span>
        </button>
        <span className="header__tools-divider" aria-hidden="true" />
        <button
          type="button"
          className="header__button header__shuffle"
          aria-label="Shuffle the order"
          title="Shuffle the order"
          onClick={shuffle}
        >
          <Icon name="shuffle" size={16} />
        </button>
        <button
          type="button"
          className="header__button"
          aria-label={shareCopied ? 'Link copied' : 'Copy a link to this view'}
          title={shareCopied ? 'Link copied' : 'Copy a link to this view'}
          onClick={copyShareLink}
        >
          <Icon name={shareCopied ? 'check' : 'share'} size={16} />
        </button>
        <button
          type="button"
          className="header__button"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggleTheme}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
      </div>
    </header>
  )
}
