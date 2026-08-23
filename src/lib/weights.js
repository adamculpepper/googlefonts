// Which weights a family can actually be served at, and in what order to ask.
//
// The catalog's metadata says which weights exist, but "exists in the metadata"
// and "css2 will serve it" are not the same claim. Roboto Flex declares a wght
// axis running 100 to 1000 and css2 serves exactly one instance of it, 400;
// every other pin comes back as an HTTP 200 with an empty body. So the build
// walks a ladder from heaviest to lightest and takes the first weight that
// actually produces a font file.

export const STANDARD_WEIGHT_LADDER = Object.freeze([900, 800, 700, 600, 500, 400, 300, 200, 100])

// Nothing above 900 is worth probing even on a 1000-max axis: css2 declines the
// derived instances, and 900 is the heaviest weight CSS names.
export const HEAVIEST_LADDER_WEIGHT = 900

export const REGULAR_WEIGHT = 400

function toWeightNumber(key) {
  const numeric = Number.parseInt(key, 10)
  return Number.isInteger(numeric) ? numeric : null
}

function ascending(values) {
  return [...new Set(values)].sort((left, right) => left - right)
}

export function findWeightAxis(familyRecord) {
  return (familyRecord.axes || []).find((axis) => axis.tag === 'wght') || null
}

export function isVariable(familyRecord) {
  return (familyRecord.axes || []).length > 0
}

// Reads the metadata `fonts` map, whose keys look like "400" for roman and
// "700i" for italic, into two ascending weight lists.
export function servableWeights(familyRecord) {
  const roman = []
  const italic = []
  for (const key of Object.keys(familyRecord.fonts || {})) {
    const isItalic = key.endsWith('i')
    const weight = toWeightNumber(isItalic ? key.slice(0, -1) : key)
    if (weight === null) continue
    if (isItalic) italic.push(weight)
    else roman.push(weight)
  }
  return { roman: ascending(roman), italic: ascending(italic) }
}

// The order to probe css2 in, heaviest first, so the measured ink ratio is the
// heaviest the family can draw. Each rung is `{ weight, italic }`.
export function weightLadder(familyRecord) {
  const { roman, italic } = servableWeights(familyRecord)
  const weightAxis = findWeightAxis(familyRecord)

  if (weightAxis) {
    const lowest = weightAxis.min
    const highest = Math.min(weightAxis.max, HEAVIEST_LADDER_WEIGHT)
    const rungs = STANDARD_WEIGHT_LADDER
      .filter((weight) => weight >= lowest && weight <= highest)
      .map((weight) => ({ weight, italic: false }))
    // A variable family whose axis range falls entirely between two standard
    // stops would otherwise produce an empty ladder.
    if (rungs.length > 0) return rungs
    return [{ weight: Math.round(weightAxis.defaultValue ?? REGULAR_WEIGHT), italic: false }]
  }

  if (roman.length > 0) {
    return [...roman].reverse().map((weight) => ({ weight, italic: false }))
  }

  // Italic-only families such as Molle have no roman face at all, and a bare
  // request for one is an HTTP 400 rather than a silent miss.
  if (italic.length > 0) {
    return [...italic].reverse().map((weight) => ({ weight, italic: true }))
  }

  return [{ weight: REGULAR_WEIGHT, italic: false }]
}

// The ladder walk itself: `isServable` answers whether a rung really produced a
// font. It may return a promise, so the build passes a network probe and the
// verify script passes a lookup table, and both exercise the same walk.
export async function resolveLadder(ladder, isServable) {
  for (const rung of ladder) {
    if (await isServable(rung)) return rung
  }
  return null
}

// The css2 `family=` fragment for one weight, unencoded: "Anton:wght@400", or
// "Molle:ital,wght@1,400" for an italic face.
export function cssSpecFor(familyName, weight, italic = false) {
  return italic ? `${familyName}:ital,wght@1,${weight}` : `${familyName}:wght@${weight}`
}

// The same fragment ready to drop into a query string. Only the family name is
// percent-encoded, because the colon, comma and at sign are css2's own
// delimiters and encoding them makes the endpoint reject the request.
export function cssFamilyParam(familyName, weight, italic = false) {
  return cssSpecFor(encodeURIComponent(familyName), weight, italic)
}
