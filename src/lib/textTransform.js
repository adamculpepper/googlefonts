// Case transforms for the specimen text, done in JS rather than CSS
// text-transform. CSS capitalize turns "ACME corp" into "ACME Corp" because it
// only touches first letters; people picking a wordmark expect real title
// case. Whatever transform is applied here is also what feeds the css2 text=
// parameter, so the downloaded subset always matches what the cards render.

export function applyCase(text, mode) {
  switch (mode) {
    case 'upper':
      return text.toUpperCase()
    case 'lower':
      return text.toLowerCase()
    case 'title':
      return text
        .split(' ')
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
        .join(' ')
    default:
      return text
  }
}

// The charset requested when the preview text is empty and every card renders
// its own family name instead. A per-card charset would give every scroll
// position a different cache generation and refetch the world; this fixed set
// covers every Google Fonts family name (they are ASCII letters, digits and
// spaces) and stays one stable generation.
export const FAMILY_NAME_CHARSET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '

// What the font manager should actually request for the current settings.
export function effectiveRequestText(settings) {
  const typed = settings.text.trim()
  return typed ? applyCase(typed, settings.case) : FAMILY_NAME_CHARSET
}

// What a card should draw: the transformed preview text, or its own family
// name when nothing is typed.
export function specimenTextFor(settings, familyDisplayName) {
  const typed = settings.text.trim()
  return typed ? applyCase(typed, settings.case) : familyDisplayName
}
