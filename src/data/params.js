// PARAM_REGISTRY is the single source of truth for every knob. It drives:
//   - the sidebar controls UI
//   - default values
//   - the share-URL codec (diff against defaults)
//   - the active-filter chips in the results bar
//
// Each entry: { key, group, type, label, default, min, max, step, unit, options,
//   maxLength, placeholder, showIf, hidden, filter, help }
// type: 'slider' | 'select' | 'segmented' | 'toggle' | 'text' | 'checks'
//
// hidden — lives in state, history and the share URL, but is never rendered in
//          the sidebar (the grid, tray and detail panel own it).
// filter — marks keys that change WHICH families are shown rather than how they
//          are drawn. The reducer resets the page to 1 when one of these moves,
//          because keeping page 7 of a result set that no longer exists is
//          incoherent.
// showIf — removed from the sidebar entirely while the predicate is false.
// surface — 'bar' moves a control out of the sidebar and into the filter bar
//           above the grid. Finding a font starts with name, category and
//           sort, so those three sit in the open rather than three clicks
//           deep. Each control still has exactly one home.
//
// Three filters default ON (hideNoto, latinOnly, supportsText). The results bar
// MUST surface each as a removable chip; a default that silently hides hundreds
// of families and never says so is this app's worst possible failure mode.

export const GROUPS = ['Preview', 'Weight', 'Filters', 'Language', 'Sort', 'Layout']

const inSetWeightMode = (settings) => settings.weightMode === 'set'
const hasMinWeight = (settings) => settings.minWeight !== 'any'

export const PARAM_REGISTRY = [
  // ---- Preview ----
  {
    // hidden: the header renders this input itself (it is the control people
    // touch most, so it lives above the grid, not buried in the sidebar).
    key: 'text', group: 'Preview', type: 'text', label: 'Preview text',
    default: '', maxLength: 60, placeholder: 'Custom text',
    filter: true, hidden: true,
    help: 'Every font on the page draws this text. Leave it empty and each card shows its own font name instead.',
  },
  {
    key: 'case', group: 'Preview', type: 'segmented', label: 'Case',
    default: 'as-typed',
    // Per-option titles: the visual labels are glyphs, so hover and screen
    // readers need the real case name per segment.
    options: [
      { value: 'as-typed', label: 'Aa', title: 'As typed' },
      { value: 'upper', label: 'AA', title: 'UPPERCASE' },
      { value: 'lower', label: 'aa', title: 'lowercase' },
      { value: 'title', label: 'Aa Bb', title: 'Title Case' },
    ],
    help: 'Applies to the preview only, not to what you copy later.',
  },
  {
    key: 'size', group: 'Preview', type: 'slider', label: 'Font size',
    default: 44, min: 12, max: 160, step: 2, unit: 'px',
  },
  {
    key: 'tracking', group: 'Preview', type: 'slider', label: 'Letter spacing',
    default: 0, min: -40, max: 120, step: 5,
    help: 'Measured in thousandths of the font size, so it scales with the size slider.',
  },
  {
    key: 'italic', group: 'Preview', type: 'toggle', label: 'Italic',
    default: false,
    help: 'Fonts with no italic stay upright and say so on the card.',
  },

  // ---- Weight ----
  // weightMode + weight decide how every specimen is DRAWN. minWeight and the
  // blackness pair decide which families are SHOWN. The sidebar renders a
  // divider between the two halves so they read as different sentences, and the
  // bridge between them is a suggestion chip in the results bar, never an
  // automatic coupling.
  {
    key: 'weightMode', group: 'Weight', type: 'segmented', label: 'Draw at',
    default: 'set',
    options: [
      { value: 'set', label: 'Set weight' },
      { value: 'thickest', label: 'Thickest' },
      { value: 'lightest', label: 'Lightest' },
    ],
    help: 'Set draws every font at one weight. Thickest and Lightest draw each font at its own extreme.',
  },
  {
    key: 'weight', group: 'Weight', type: 'slider', label: 'Weight',
    default: 400, min: 100, max: 900, step: 50,
    showIf: inSetWeightMode,
    help: 'Fonts without this exact weight are drawn at their nearest one, and the card says which.',
  },
  {
    key: 'minWeight', group: 'Weight', type: 'select', label: 'Must have weight',
    default: 'any', filter: true,
    options: [
      { value: 'any', label: 'Any' },
      { value: '500', label: '500 or bolder' },
      { value: '600', label: '600 or bolder' },
      { value: '700', label: '700 or bolder' },
      { value: '800', label: '800 or bolder' },
      { value: '900', label: '900' },
    ],
    help: 'Hides families that never get as bold as you need.',
  },
  {
    key: 'axisCountsForMin', group: 'Weight', type: 'toggle', label: 'Count variable range',
    default: true, filter: true, showIf: hasMinWeight,
    help: 'On: a variable font whose weight range reaches the mark counts, even without a named bold style.',
  },
  {
    key: 'blacknessMin', group: 'Weight', type: 'slider', label: 'Ink density, at least',
    default: 0, min: 0, max: 100, step: 5, filter: true,
    help: 'Measured ink coverage of each family at its heaviest weight, not the declared number. 0 is hairline, 100 is nearly solid.',
  },
  {
    key: 'blacknessMax', group: 'Weight', type: 'slider', label: 'Ink density, at most',
    default: 100, min: 0, max: 100, step: 5, filter: true,
  },

  // ---- Filters ----
  {
    key: 'q', group: 'Filters', type: 'text', label: 'Search by name',
    default: '', maxLength: 40, placeholder: 'Poppins, Lato...', filter: true, surface: 'bar',
  },
  {
    key: 'category', group: 'Filters', type: 'checks', label: 'Category',
    default: [], filter: true, surface: 'bar',
    options: [
      { value: 'Sans Serif', label: 'Sans serif' },
      { value: 'Serif', label: 'Serif' },
      { value: 'Display', label: 'Display' },
      { value: 'Handwriting', label: 'Handwriting' },
      { value: 'Monospace', label: 'Monospace' },
    ],
    help: 'Nothing checked means all categories.',
  },
  {
    key: 'variableOnly', group: 'Filters', type: 'toggle', label: 'Variable fonts only',
    default: false, filter: true,
    help: 'Fonts with an adjustable weight or width axis instead of fixed steps.',
  },
  {
    key: 'hasItalic', group: 'Filters', type: 'toggle', label: 'Has italic',
    default: false, filter: true,
  },
  {
    key: 'hideNoto', group: 'Filters', type: 'toggle', label: 'Hide Noto fonts',
    default: true, filter: true,
    help: 'The 212 Noto families exist to cover every writing system, not to be picked for a logo. Turn this off to see them.',
  },

  // ---- Language ----
  {
    key: 'latinOnly', group: 'Language', type: 'toggle', label: 'Latin-script fonts only',
    default: true, filter: true,
    help: 'Hides the 121 families that carry no Latin characters at all. A font built for another script still shows when it also ships Latin, which most do.',
  },
  {
    key: 'supportsText', group: 'Language', type: 'toggle', label: 'Must support my text',
    default: true, filter: true,
    help: 'Hides fonts missing characters you typed. Common characters are checked against the real character list of each font; rarer ones are allowed through rather than guessed at.',
  },

  // ---- Sort ----
  {
    key: 'sort', group: 'Sort', type: 'select', label: 'Sort by',
    default: 'popularity', filter: true, surface: 'bar',
    options: [
      { value: 'popularity', label: 'Most popular' },
      { value: 'trending', label: 'Trending' },
      { value: 'newest', label: 'Newest' },
      { value: 'name-az', label: 'Name A to Z' },
      { value: 'name-za', label: 'Name Z to A' },
      { value: 'blackness-desc', label: 'Thickest ink first' },
      { value: 'blackness-asc', label: 'Lightest ink first' },
      { value: 'weights-desc', label: 'Most weights' },
      { value: 'random', label: 'Random' },
    ],
    help: 'Thickest ink ranks by measured darkness at the heaviest weight of each family, which is not the same as the declared weight number.',
  },
  {
    // Never rendered: the Shuffle button rerolls it. Living in the registry
    // puts the seed in the share URL, so a random order someone liked is
    // reproducible from their link.
    key: 'shuffleSeed', group: 'Sort', type: 'slider', label: 'Shuffle seed',
    default: 1, min: 1, max: 2147483647, step: 1, hidden: true,
  },

  // ---- Layout ----
  {
    key: 'columns', group: 'Layout', type: 'select', label: 'Columns',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '3', label: '3' },
      { value: '4', label: '4' },
      { value: '5', label: '5' },
      { value: '6', label: '6' },
    ],
    help: 'Auto picks a column count from the font size, so bigger text naturally gets fewer, wider columns.',
  },
  {
    key: 'pageSize', group: 'Layout', type: 'select', label: 'Fonts per page',
    default: '48', filter: true,
    options: [
      { value: '24', label: '24' },
      { value: '48', label: '48' },
      { value: '96', label: '96' },
      { value: '192', label: '192' },
      { value: 'all', label: 'Show all' },
    ],
    help: 'Show all puts the entire catalog on one endless page. Still fast; only what you can see is actually rendered.',
  },
  {
    key: 'density', group: 'Layout', type: 'segmented', label: 'Card details',
    default: 'normal',
    options: [
      { value: 'minimal', label: 'Minimal' },
      { value: 'normal', label: 'Normal' },
      { value: 'detailed', label: 'Detailed' },
    ],
  },
  {
    key: 'previewInk', group: 'Layout', type: 'select', label: 'Specimen colors',
    default: 'theme',
    options: [
      { value: 'theme', label: 'Match theme' },
      { value: 'dark-on-light', label: 'Dark on light' },
      { value: 'light-on-dark', label: 'Light on dark' },
    ],
    help: 'Judge the type on a white card while the app stays dark, or the other way around.',
  },
  {
    // In the URL so a shared link lands on the page its sender was looking at.
    // Clamped against the live result count where it is consumed.
    key: 'page', group: 'Layout', type: 'slider', label: 'Page',
    default: 1, min: 1, max: 999, step: 1, hidden: true,
  },

  // ---- Hidden state that rides the share URL ----
  {
    // Pinned compare tray, packed as "roboto:700,lora:400:i". Decoded
    // defensively where it is consumed: unknown slugs dropped, weights clamped
    // to the family's real range, list truncated at the tray limit.
    key: 'pinned', group: 'Layout', type: 'text', label: 'Pinned fonts',
    default: '', maxLength: 240, hidden: true,
  },
  {
    // Slug of the family whose detail panel is open, so a link can land
    // straight on one font's page.
    key: 'detail', group: 'Layout', type: 'text', label: 'Open font',
    default: '', maxLength: 60, hidden: true,
  },
]

export const PARAM_BY_KEY = Object.fromEntries(PARAM_REGISTRY.map((param) => [param.key, param]))

// Keys whose change invalidates the current page number. 'text' is handled at
// commit time instead (typing fires per keystroke; resetting the page on every
// letter would thrash scroll position mid-thought).
export const PAGE_RESET_KEYS = new Set(
  PARAM_REGISTRY.filter((param) => param.filter && param.key !== 'text').map((param) => param.key),
)

export function getDefaults() {
  const defaults = {}
  for (const param of PARAM_REGISTRY) {
    defaults[param.key] = Array.isArray(param.default) ? [...param.default] : param.default
  }
  return defaults
}

// Decimal precision implied by a step (0.05 -> 2), for clean rounding.
export function stepPrecision(step) {
  if (!step || Number.isInteger(step)) return 0
  const text = String(step)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}
