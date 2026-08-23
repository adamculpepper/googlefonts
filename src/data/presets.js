// Presets: named settings patches that turn a wall of controls into a handful
// of intents. Applying one merges the patch over the current settings as a
// single history entry, so undo steps back over the whole preset at once.
// Values here may only reference keys that exist in params.js.

export const PRESETS = [
  {
    id: 'browse',
    label: 'Browse',
    // Empty patch: the Reset path, kept as a preset so "back to the start" is
    // one click sitting next to the other intents.
    reset: true,
    patch: {},
  },
  {
    id: 'wordmark',
    label: 'Wordmark',
    patch: { columns: '2', size: 96, density: 'minimal', pageSize: '24' },
  },
  {
    id: 'logo-ready',
    label: 'Logo ready',
    patch: {
      minWeight: '700',
      hideNoto: true,
      latinOnly: true,
      sort: 'popularity',
      weightMode: 'thickest',
    },
  },
  {
    id: 'editorial-serif',
    label: 'Editorial serif',
    patch: { category: ['Serif'], sort: 'popularity', size: 56 },
  },
  {
    id: 'techy-mono',
    label: 'Techy mono',
    patch: { category: ['Monospace'], tracking: 0, case: 'as-typed' },
  },
  {
    id: 'handwriting',
    label: 'Handwriting',
    patch: { category: ['Handwriting', 'Display'], size: 64 },
  },
  {
    id: 'variable-only',
    label: 'Variable only',
    patch: { variableOnly: true, sort: 'weights-desc' },
  },
  {
    id: 'thickest-first',
    label: 'Thickest first',
    patch: { sort: 'blackness-desc', weightMode: 'thickest', density: 'detailed' },
  },
]
