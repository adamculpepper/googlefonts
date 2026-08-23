// The compare tray: a fixed strip along the bottom of the viewport holding
// every pinned family, plus the three things a pinned set is for (compare them
// side by side, copy one embed that covers all of them, clear them).
//
// It renders nothing at all when nothing is pinned, so it costs a browsing
// session with no pins exactly zero pixels. The parent reserves its space with
// the .has-compare-tray class rather than a permanent gutter; see the height
// token and that class in CompareTray.css.
//
// No app state is touched here. The pinned list lives in the `pinned` param,
// which the parent owns; this component takes the decoded list and reports
// intent back up.

import { useMemo } from 'react'
import { CSS2_ENDPOINT, familySpec, resolveWeight } from '../../lib/fontUrl.js'
import { findRecord } from '../../lib/pinnedCodec.js'
import useCopyFlag from '../../hooks/useCopyFlag.js'
import { useToast } from '../Toast/Toast.jsx'
import Icon from '../Icon.jsx'
import './CompareTray.css'

// The generic family every embed rule ends on, so a page still reads while the
// webfont is in flight.
const CSS_FALLBACK_BY_CATEGORY = {
  'Sans Serif': 'sans-serif',
  Serif: 'serif',
  Display: 'serif',
  Handwriting: 'cursive',
  Monospace: 'monospace',
}

function weightLabel(resolved) {
  return resolved.italic ? `${resolved.cssWeight} italic` : String(resolved.cssWeight)
}

// One row of tray data per pin: the record it points at and the weight it will
// really be served at. Pins whose family is missing from the catalog are
// skipped rather than rendered as a blank chip.
function buildRows(pins, records) {
  const list = Array.isArray(pins) ? pins : []
  const rows = []
  for (const pin of list) {
    const record = findRecord(records, pin.slug)
    if (!record) continue
    rows.push({ pin, record, resolved: resolveWeight(record, pin.weight, pin.italic) })
  }
  return rows
}

// The combined embed: one css2 stylesheet covering every pinned family, then
// one ordinary CSS rule per family so the snippet is usable the moment it is
// pasted rather than being a link with nothing to apply it.
//
// display=swap here, deliberately unlike the app's own loader, which uses
// display=block so a card never flashes a fallback face. A visitor to someone
// else's site is better served by readable fallback text than by an invisible
// heading, so the snippet we hand out swaps.
//
// familySpec builds each fragment because its shapes are the live-probed ones:
// an invalid spec is dropped SILENTLY by css2, which would hand someone an
// embed that half works and says nothing about it.
export function buildEmbed(rows) {
  const specs = [...new Set(rows.map((row) => familySpec(row.record.name, row.resolved)))].sort()
  const url = `${CSS2_ENDPOINT}?${specs.map((spec) => `family=${spec}`).join('&')}&display=swap`

  const rules = rows.map((row) => {
    const fallback = CSS_FALLBACK_BY_CATEGORY[row.record.category] || 'sans-serif'
    const style = row.resolved.italic ? '\n  font-style: italic;' : ''
    return `.font-${row.record.slug} {\n  font-family: '${row.record.name}', ${fallback};\n  font-weight: ${row.resolved.cssWeight};${style}\n}`
  })

  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${url}">`,
    '',
    rules.join('\n\n'),
  ].join('\n')
}

const noop = () => {}

export default function CompareTray({
  pins,
  records,
  onUnpin = noop,
  onClear = noop,
  onOpenCompare = noop,
}) {
  const showToast = useToast()
  const { copied, flagCopied } = useCopyFlag()
  const rows = useMemo(() => buildRows(pins, records), [pins, records])

  if (rows.length === 0) return null

  async function copyEmbeds() {
    try {
      await navigator.clipboard.writeText(buildEmbed(rows))
      flagCopied()
      showToast(rows.length === 1 ? 'Embed copied' : `Embed for ${rows.length} fonts copied`)
    } catch {
      showToast('Could not reach the clipboard')
    }
  }

  return (
    <div className="compare-tray" role="region" aria-label="Pinned fonts">
      <span className="compare-tray__count">{rows.length} pinned</span>

      <ul className="compare-tray__chips">
        {rows.map((row) => {
          const name = row.record.displayName || row.record.name
          return (
            <li key={row.pin.slug} className="compare-tray__chip">
              <span className="compare-tray__chip-name">{name}</span>
              <span className="compare-tray__chip-weight">{weightLabel(row.resolved)}</span>
              <button
                type="button"
                className="compare-tray__chip-remove"
                aria-label={`Unpin ${name}`}
                onClick={() => onUnpin(row.pin.slug)}
              >
                <Icon name="xmark" size={11} />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="compare-tray__actions">
        <button type="button" className="button is-primary" onClick={onOpenCompare}>
          Compare
        </button>
        <button
          type="button"
          className="button"
          aria-label="Copy embeds for every pinned font"
          onClick={copyEmbeds}
        >
          <Icon name={copied ? 'check' : 'copy'} size={13} />
          {/* Labelled span, not a bare string: on a phone the label is hidden
              and the aria-label above is what is left to read. */}
          <span className="compare-tray__action-label">{copied ? 'Copied' : 'Copy embeds'}</span>
        </button>
        <button type="button" className="button" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}
