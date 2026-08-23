// The detail panel: one font, seen properly.
//
// The grid answers "which of these 1,942 fonts is worth a look". This answers
// "is this the one", which needs things a card cannot afford: every weight, the
// full character set, the axes, and the four snippets that put the font on
// somebody's site.
//
// It loads its own faces through fullFamilyLoader rather than the grid's font
// manager, and hands them back on close. See that file for why.
//
// Degrading is a feature. If the font never loads, the header, the facts and
// the embed blocks still render, because those are the parts a person came to
// copy and none of them need the typeface to be resident.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cssSnippet,
  fontsourceSnippet,
  googleFontsSpecimenUrl,
  importSnippet,
  linkSnippet,
  variableWeightRange,
} from '../../lib/embedSnippets.js'
import { loadFullFamily, releaseFullFamily } from '../../lib/fullFamilyLoader.js'
import { specimenTextFor } from '../../lib/textTransform.js'
import useCopyFlag from '../../hooks/useCopyFlag.js'
import useFocusTrap from '../../hooks/useFocusTrap.js'
import { useToast } from '../Toast/Toast.jsx'
import Icon from '../Icon.jsx'
import './DetailPanel.css'

const WEIGHT_NAMES = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
}

const WATERFALL_SIZES = [12, 16, 24, 36, 48, 72, 96]

const SPECIMEN_MIN_SIZE = 32
const SPECIMEN_MAX_SIZE = 120
const SPECIMEN_DEFAULT_SIZE = 64

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const NUMERALS = '0123456789'
// Euro, pound and yen are built from codepoints so this file stays ASCII: a
// currency sign pasted in literally is one bad re-encode away from a mojibake
// specimen, and this block exists to prove the font HAS these glyphs.
const CURRENCY = String.fromCodePoint(0x20ac, 0x00a3, 0x00a5)
const PUNCTUATION = `!?&@#%.,:;'"()[]$${CURRENCY}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The catalog stores dates as a YYYYMMDD integer, which is compact and sorts
// correctly but reads as a serial number.
function formatAdded(dateAdded) {
  const value = Number(dateAdded)
  if (!Number.isFinite(value) || value < 10000000) return null
  const year = Math.floor(value / 10000)
  const month = Math.floor(value / 100) % 100
  const day = value % 100
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${MONTHS[month - 1]} ${day}, ${year}`
}

function formatRank(rank) {
  const value = Number(rank)
  return Number.isFinite(value) && value > 0 ? `#${value}` : 'Not ranked'
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function sortedWeights(values) {
  if (!Array.isArray(values)) return []
  const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  return [...new Set(numbers)].sort((left, right) => left - right)
}

// One row per named weight for a static family; one row per 100 step inside
// the axis for a variable one. The range is the CAPPED range the loader
// actually fetched, so the ladder can never show a weight that was not loaded.
function ladderWeights(record, range) {
  if (range) {
    const first = Math.ceil(range.min / 100) * 100
    const last = Math.floor(range.max / 100) * 100
    const steps = []
    for (let weight = first; weight <= last; weight += 100) steps.push(weight)
    return steps.length > 0 ? steps : [range.min, range.max]
  }
  const roman = sortedWeights(record?.weights)
  if (roman.length > 0) return roman
  const italic = sortedWeights(record?.italics)
  return italic.length > 0 ? italic : [400]
}

// A slider step that suits the axis: slnt runs -10 to 0, GRAD runs -200 to 150,
// and one step of 1 is wrong for neither, but a two-unit axis needs finer.
function axisStep(axis) {
  return Number(axis.max) - Number(axis.min) <= 2 ? 0.01 : 1
}

function EmbedBlock({ label, code, caveat, caveatHref, caveatLinkText }) {
  const { copied, flagCopied } = useCopyFlag()
  const showToast = useToast()

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      flagCopied()
      showToast(`${label} copied`)
    } catch {
      showToast('Could not reach the clipboard')
    }
  }

  return (
    <div className="detail-panel__embed">
      <div className="detail-panel__embed-head">
        <h4 className="detail-panel__embed-label">{label}</h4>
        <button type="button" className="detail-panel__copy" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={13} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="detail-panel__code">
        <code>{code}</code>
      </pre>
      {caveat && (
        <p className="detail-panel__caveat">
          {caveat}{' '}
          <a href={caveatHref} target="_blank" rel="noopener noreferrer">
            {caveatLinkText}
          </a>
        </p>
      )}
    </div>
  )
}

export default function DetailPanel({ record, settings, onClose }) {
  const panelRef = useRef(null)
  const contentRef = useRef(null)
  const [load, setLoad] = useState({ status: 'loading', alias: null })
  const [specimenSize, setSpecimenSize] = useState(SPECIMEN_DEFAULT_SIZE)
  const [ladderItalic, setLadderItalic] = useState(Boolean(settings?.italic))
  // Only tags the user actually dragged live here. Everything else reads its
  // default, which is what keeps the CSS snippet honest: it names the axes that
  // were touched and stays quiet about the rest.
  const [movedAxes, setMovedAxes] = useState({})

  useFocusTrap({ containerRef: panelRef, onClose, active: true })

  useEffect(() => {
    let released = false
    let handle = null
    setLoad({ status: 'loading', alias: null })
    contentRef.current?.scrollTo({ top: 0 })

    loadFullFamily(record).then(
      (loaded) => {
        // Closed or switched families before the fetch came back: hand the
        // reference straight back rather than leaving it resident.
        if (released) {
          releaseFullFamily(loaded)
          return
        }
        handle = loaded
        setLoad({ status: 'ready', alias: loaded.alias })
      },
      () => {
        if (!released) setLoad({ status: 'error', alias: null })
      },
    )

    return () => {
      released = true
      if (handle) releaseFullFamily(handle)
    }
  }, [record])

  // A new family means a new set of axes, so the old positions cannot carry.
  useEffect(() => {
    setMovedAxes({})
    setLadderItalic(Boolean(settings?.italic))
    // settings.italic is read once per family on purpose: the ladder toggle is
    // the panel's own state after that, and syncing it live would fight the
    // person using it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record])

  const displayName = record.displayName || record.name
  const specimenUrl = googleFontsSpecimenUrl(record.name)
  // Rebuilt rather than passed through: specimenTextFor reads .text directly,
  // and a panel is not worth crashing over a settings object that arrived
  // half-formed.
  const specimenText = specimenTextFor(
    { text: settings?.text ?? '', case: settings?.case ?? 'as-typed' },
    displayName,
  )
  // Memoized because it is a fresh object each call and the ladder memo below
  // takes it as a dependency.
  const range = useMemo(() => variableWeightRange(record), [record])
  const italicWeights = sortedWeights(record.italics)
  const romanWeights = sortedWeights(record.weights)
  const hasItalics = italicWeights.length > 0
  const italicWanted = Boolean(settings?.italic) && hasItalics
  const weight = Number(settings?.weight) || 400
  const ready = load.status === 'ready'
  const failed = load.status === 'error'

  const rows = useMemo(() => ladderWeights(record, range), [record, range])

  // ital is the italic toggle's job, and an axis pinned to one value is not a
  // slider.
  const axes = useMemo(
    () =>
      (Array.isArray(record.axes) ? record.axes : []).filter(
        (axis) => axis.tag !== 'ital' && Number(axis.max) > Number(axis.min),
      ),
    [record],
  )

  // opsz follows the size slider until somebody drags it, because that is what
  // optical size means: the design adjusts to the size it is set at.
  function axisValue(axis) {
    const moved = movedAxes[axis.tag]
    if (Number.isFinite(Number(moved))) return Number(moved)
    if (axis.tag === 'opsz') return clamp(specimenSize, Number(axis.min), Number(axis.max))
    return Number(axis.defaultValue)
  }

  // The specimen shows every axis that is off its default, including an opsz
  // that is merely tracking the size slider. The CSS snippet is stricter and
  // takes movedAxes alone.
  const specimenVariations = axes
    .filter((axis) => axisValue(axis) !== Number(axis.defaultValue))
    .map((axis) => `'${axis.tag}' ${axisValue(axis)}`)
    .join(', ')

  const fontFamily = ready ? `"${load.alias}"` : undefined
  const bigSpecimenStyle = {
    fontFamily,
    fontWeight: weight,
    fontStyle: italicWanted ? 'italic' : 'normal',
    fontSize: `${specimenSize}px`,
    letterSpacing: settings?.tracking ? `${settings.tracking / 1000}em` : undefined,
    fontVariationSettings: specimenVariations || undefined,
  }

  const snippetState = useMemo(
    () => ({
      weight,
      italic: italicWanted,
      tracking: Number(settings?.tracking) || 0,
      movedAxes,
    }),
    [weight, italicWanted, settings?.tracking, movedAxes],
  )

  const fontsource = useMemo(() => fontsourceSnippet(record), [record])
  const snippets = useMemo(
    () => ({
      link: linkSnippet(record, snippetState),
      import: importSnippet(record, snippetState),
      css: cssSnippet(record, snippetState),
    }),
    [record, snippetState],
  )

  const addedText = formatAdded(record.dateAdded)
  const weightsText =
    romanWeights.length > 0
      ? `${romanWeights.length} ${romanWeights.length === 1 ? 'weight' : 'weights'}${hasItalics ? ' + italics' : ''}`
      : `${italicWeights.length} italic ${italicWeights.length === 1 ? 'weight' : 'weights'}`
  const subsetCount = Array.isArray(record.subsets) ? record.subsets.length : 0

  return (
    <aside
      className="detail-panel"
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName} details`}
    >
      <button
        type="button"
        className="detail-panel__close"
        aria-label={`Close ${displayName}`}
        onClick={onClose}
      >
        <Icon name="xmark" size={16} />
      </button>

      <div className="detail-panel__content" ref={contentRef}>
        <header className="detail-panel__header">
          <h2 className="detail-panel__title">{displayName}</h2>
          <p className="detail-panel__subtitle">
            <span>{record.category}</span>
            <a href={specimenUrl} target="_blank" rel="noopener noreferrer">
              Open on Google Fonts
              <Icon name="external" size={11} />
            </a>
          </p>
          {failed && (
            <p className="detail-panel__error">
              The full preview could not load. Everything below still applies.
            </p>
          )}
        </header>

        {!failed && (
          <>
            <section className="detail-panel__section">
              <div className="detail-panel__specimen">
                {ready ? (
                  <p className="detail-panel__specimen-text" style={bigSpecimenStyle}>
                    {specimenText}
                  </p>
                ) : (
                  <span
                    className="detail-panel__skeleton"
                    style={{ height: `${specimenSize}px` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <label className="detail-panel__size">
                <span className="detail-panel__size-label">Size</span>
                <input
                  type="range"
                  min={SPECIMEN_MIN_SIZE}
                  max={SPECIMEN_MAX_SIZE}
                  step={2}
                  value={specimenSize}
                  aria-label="Specimen size"
                  onChange={(event) => setSpecimenSize(Number(event.target.value))}
                />
                <output className="detail-panel__size-value">{specimenSize}px</output>
              </label>
            </section>

            <section className="detail-panel__section">
              <div className="detail-panel__section-head">
                <h3 className="detail-panel__section-title">Weights</h3>
                {hasItalics && (
                  <button
                    type="button"
                    className={ladderItalic ? 'detail-panel__toggle is-active' : 'detail-panel__toggle'}
                    aria-pressed={ladderItalic}
                    onClick={() => setLadderItalic((on) => !on)}
                  >
                    Italic
                  </button>
                )}
              </div>
              <ul className="detail-panel__ladder">
                {rows.map((row) => (
                  <li className="detail-panel__ladder-row" key={row}>
                    <span className="detail-panel__ladder-label">
                      {row} {WEIGHT_NAMES[row] || ''}
                    </span>
                    {ready ? (
                      <span
                        className="detail-panel__ladder-text"
                        style={{
                          fontFamily,
                          fontWeight: row,
                          fontStyle: ladderItalic ? 'italic' : 'normal',
                        }}
                      >
                        {specimenText}
                      </span>
                    ) : (
                      <span className="detail-panel__skeleton" aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {axes.length > 0 && (
              <section className="detail-panel__section">
                <div className="detail-panel__section-head">
                  <h3 className="detail-panel__section-title">Variable axes</h3>
                  <button
                    type="button"
                    className="detail-panel__toggle"
                    onClick={() => setMovedAxes({})}
                    disabled={Object.keys(movedAxes).length === 0}
                  >
                    <Icon name="reset" size={12} />
                    Reset
                  </button>
                </div>
                {axes.map((axis) => (
                  <label className="detail-panel__axis" key={axis.tag}>
                    <span className="detail-panel__axis-tag">{axis.tag}</span>
                    <input
                      type="range"
                      min={axis.min}
                      max={axis.max}
                      step={axisStep(axis)}
                      value={axisValue(axis)}
                      aria-label={`${axis.tag} axis`}
                      onChange={(event) =>
                        setMovedAxes((current) => ({ ...current, [axis.tag]: Number(event.target.value) }))
                      }
                    />
                    <output className="detail-panel__axis-value">{axisValue(axis)}</output>
                  </label>
                ))}
              </section>
            )}

            <section className="detail-panel__section">
              <h3 className="detail-panel__section-title">Sizes</h3>
              <ul className="detail-panel__waterfall">
                {WATERFALL_SIZES.map((size) => (
                  <li className="detail-panel__waterfall-row" key={size}>
                    <span className="detail-panel__waterfall-label">{size}</span>
                    {ready ? (
                      <span
                        className="detail-panel__waterfall-text"
                        style={{
                          fontFamily,
                          fontWeight: weight,
                          fontStyle: italicWanted ? 'italic' : 'normal',
                          fontSize: `${size}px`,
                        }}
                      >
                        {specimenText}
                      </span>
                    ) : (
                      <span className="detail-panel__skeleton" aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="detail-panel__section">
              <h3 className="detail-panel__section-title">Characters</h3>
              {[
                { label: 'Uppercase', characters: UPPERCASE },
                { label: 'Lowercase', characters: LOWERCASE },
                { label: 'Numerals', characters: NUMERALS },
                { label: 'Punctuation and currency', characters: PUNCTUATION },
              ].map((block) => (
                <div className="detail-panel__charset" key={block.label}>
                  <span className="detail-panel__charset-label">{block.label}</span>
                  {ready ? (
                    <p className="detail-panel__charset-text" style={{ fontFamily }}>
                      {block.characters}
                    </p>
                  ) : (
                    <span className="detail-panel__skeleton" aria-hidden="true" />
                  )}
                </div>
              ))}
            </section>
          </>
        )}

        <section className="detail-panel__section">
          <h3 className="detail-panel__section-title">Facts</h3>
          <dl className="detail-panel__facts">
            <div className="detail-panel__fact">
              <dt>Popularity</dt>
              <dd>{formatRank(record.popularity)}</dd>
            </div>
            <div className="detail-panel__fact">
              <dt>Trending</dt>
              <dd>{formatRank(record.trending)}</dd>
            </div>
            {addedText && (
              <div className="detail-panel__fact">
                <dt>Added</dt>
                <dd>{addedText}</dd>
              </div>
            )}
            <div className="detail-panel__fact">
              <dt>Weights</dt>
              <dd>{weightsText}</dd>
            </div>
            {record.blackness >= 0 && (
              <div className="detail-panel__fact">
                <dt>Ink density</dt>
                <dd>
                  {record.blackness}
                  <span className="detail-panel__fact-note">
                    {record.blacknessComparable
                      ? 'measured at the heaviest weight'
                      : 'measured at the heaviest weight, on its own script'}
                  </span>
                </dd>
              </div>
            )}
            <div className="detail-panel__fact">
              <dt>Writing systems</dt>
              <dd>{subsetCount} {subsetCount === 1 ? 'subset' : 'subsets'}</dd>
            </div>
            {/* Never a license NAME. The catalog does not carry one, so any
                specific claim here would be a guess about somebody's legal
                terms. The link goes where the real answer lives. */}
            <div className="detail-panel__fact">
              <dt>License</dt>
              <dd>
                <a href={specimenUrl} target="_blank" rel="noopener noreferrer">
                  See the license on Google Fonts
                  <Icon name="external" size={11} />
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="detail-panel__section">
          <h3 className="detail-panel__section-title">Use it</h3>
          <EmbedBlock label="Link" code={snippets.link} />
          <EmbedBlock label="@import" code={snippets.import} />
          <EmbedBlock
            label="npm"
            code={fontsource.code}
            caveat={fontsource.caveatText}
            caveatHref={fontsource.url}
            caveatLinkText={fontsource.packageName}
          />
          <EmbedBlock label="CSS" code={snippets.css} />
        </section>

        <p className="detail-panel__footnote">
          This typeface belongs to its designers and foundry. Font files are served by Google Fonts.
        </p>
      </div>
    </aside>
  )
}
