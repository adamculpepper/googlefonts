// The catalog schema, in one place.
//
// public/data/fonts.json holds 1,942 families and is fetched by every visitor,
// so it is stored as tuples against shared enum tables rather than as objects
// with repeated key names. That is roughly a third of the bytes of the obvious
// shape, and gzip does not close the gap because it cannot dedupe across the
// whole file the way an enum index does.
//
// Both halves of the round trip live here so a slot can never be added on one
// side only: the build encodes through createCatalogBuilder, the frontend and
// the verify script decode through decodeCatalog.

export const SCHEMA_VERSION = 1

// The 17 tuple slots, in order. The verify script asserts the artifact's own
// `fields` array matches this exactly, so a reordering breaks loudly instead of
// silently shifting every family's data by one slot.
export const FIELDS = Object.freeze([
  'name', // exact family name, as css2 wants it
  'cat', // category enum index
  'stroke', // stroke enum index, or -1
  'cls', // classification enum indices
  'subs', // subset enum indices, "menu" stripped
  'wght', // roman weights, ascending
  'ital', // italic weights, ascending
  'axes', // [axisEnumIndex, min, max, default][]
  'pop', // popularity rank
  'trend', // trending rank
  'added', // date added, YYYYMMDD
  'mod', // last modified, YYYYMMDD
  'flags', // bitfield, see below
  'scr', // primary script enum index
  'black', // measured blackness 0-100, or -1
  'cov', // coverage mask palette index, or -1
  'disp', // display name when it differs from the family name, else 0
])

export const SLOT = Object.freeze(
  Object.fromEntries(FIELDS.map((field, index) => [field, index])),
)

export const ENUM_KEYS = Object.freeze(['cat', 'stroke', 'cls', 'subs', 'ax', 'scr'])

export const FLAG_NOTO = 1
export const FLAG_BRAND = 2
export const FLAG_VARIABLE = 4
export const FLAG_HAS_LATIN = 8
export const FLAG_COLRV0 = 16
export const FLAG_COLRV1 = 32
export const FLAG_OTSVG = 64
// Set when the family was measured on the shared Latin sample, so its blackness
// can be compared with another family's. Non-Latin families are measured on
// their own script and the number is only meaningful against itself.
export const FLAG_BLACKNESS_COMPARABLE = 128

export const NO_STROKE = -1
export const NO_BLACKNESS = -1
export const NO_COVERAGE = -1
export const NO_DISPLAY_NAME = 0

// The "menu" subset is Google's own name-rendering slice, not a language the
// family supports, and shipping it would put a meaningless option in the UI.
export const EXCLUDED_SUBSET = 'menu'

function createEnumTable() {
  const values = []
  const indexByValue = new Map()
  return {
    values,
    indexOf(value) {
      const existing = indexByValue.get(value)
      if (existing !== undefined) return existing
      const index = values.length
      values.push(value)
      indexByValue.set(value, index)
      return index
    },
  }
}

// Accumulates the enum tables and the deduplicated coverage-mask palette while
// families are added, then emits the finished document.
export function createCatalogBuilder() {
  const enums = {
    cat: createEnumTable(),
    stroke: createEnumTable(),
    cls: createEnumTable(),
    subs: createEnumTable(),
    ax: createEnumTable(),
    scr: createEnumTable(),
  }
  const masks = []
  const maskIndexByValue = new Map()
  const tuples = []

  function maskIndexOf(maskBase64) {
    if (!maskBase64) return NO_COVERAGE
    const existing = maskIndexByValue.get(maskBase64)
    if (existing !== undefined) return existing
    const index = masks.length
    masks.push(maskBase64)
    maskIndexByValue.set(maskBase64, index)
    return index
  }

  return {
    addFamily(family) {
      const tuple = new Array(FIELDS.length)
      tuple[SLOT.name] = family.name
      tuple[SLOT.cat] = enums.cat.indexOf(family.category)
      tuple[SLOT.stroke] = family.stroke ? enums.stroke.indexOf(family.stroke) : NO_STROKE
      // Classifications, subsets and axes are unordered sets upstream, and the
      // order genuinely varies between two fetches of the same endpoint
      // minutes apart: 18 families flip between ["Display","Symbols"] and
      // ["Symbols","Display"]. Sorting here is what keeps a refresh that
      // changed nothing from producing a diff.
      tuple[SLOT.cls] = [...(family.classifications || [])].sort()
        .map((value) => enums.cls.indexOf(value))
      tuple[SLOT.subs] = (family.subsets || [])
        .filter((subset) => subset !== EXCLUDED_SUBSET)
        .sort()
        .map((value) => enums.subs.indexOf(value))
      tuple[SLOT.wght] = family.weights
      tuple[SLOT.ital] = family.italics
      tuple[SLOT.axes] = [...(family.axes || [])]
        .sort((left, right) => (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0))
        .map((axis) => [
          enums.ax.indexOf(axis.tag),
          axis.min,
          axis.max,
          axis.defaultValue,
        ])
      tuple[SLOT.pop] = family.popularity
      tuple[SLOT.trend] = family.trending
      tuple[SLOT.added] = family.added
      tuple[SLOT.mod] = family.modified
      tuple[SLOT.flags] = family.flags
      // Most families report an empty primary script, so the empty string is a
      // real enum member here rather than a missing value.
      tuple[SLOT.scr] = enums.scr.indexOf(family.script || '')
      tuple[SLOT.black] = family.blackness
      tuple[SLOT.cov] = maskIndexOf(family.mask)
      tuple[SLOT.disp] = family.displayName && family.displayName !== family.name
        ? family.displayName
        : NO_DISPLAY_NAME
      tuples.push(tuple)
      return tuple
    },

    get maskCount() {
      return masks.length
    },

    build({ generated, source, algo, probe }) {
      return {
        v: SCHEMA_VERSION,
        generated,
        source,
        count: tuples.length,
        algo,
        enums: Object.fromEntries(ENUM_KEYS.map((key) => [key, enums[key].values])),
        probe,
        masks,
        fields: [...FIELDS],
        f: tuples,
      }
    },
  }
}

function decodeFlags(flags) {
  return {
    isNoto: (flags & FLAG_NOTO) !== 0,
    isBrandFont: (flags & FLAG_BRAND) !== 0,
    isVariable: (flags & FLAG_VARIABLE) !== 0,
    hasLatin: (flags & FLAG_HAS_LATIN) !== 0,
    hasColrV0: (flags & FLAG_COLRV0) !== 0,
    hasColrV1: (flags & FLAG_COLRV1) !== 0,
    hasOtSvg: (flags & FLAG_OTSVG) !== 0,
    blacknessComparable: (flags & FLAG_BLACKNESS_COMPARABLE) !== 0,
  }
}

export function decodeCatalog(document) {
  const { enums, masks = [], f: tuples = [] } = document
  return tuples.map((tuple) => {
    const flags = tuple[SLOT.flags]
    const maskIndex = tuple[SLOT.cov]
    const displayName = tuple[SLOT.disp]
    return {
      name: tuple[SLOT.name],
      displayName: displayName === NO_DISPLAY_NAME ? tuple[SLOT.name] : displayName,
      hasDistinctDisplayName: displayName !== NO_DISPLAY_NAME,
      category: enums.cat[tuple[SLOT.cat]],
      stroke: tuple[SLOT.stroke] === NO_STROKE ? null : enums.stroke[tuple[SLOT.stroke]],
      classifications: tuple[SLOT.cls].map((index) => enums.cls[index]),
      subsets: tuple[SLOT.subs].map((index) => enums.subs[index]),
      weights: tuple[SLOT.wght],
      italics: tuple[SLOT.ital],
      axes: tuple[SLOT.axes].map(([tagIndex, min, max, defaultValue]) => ({
        tag: enums.ax[tagIndex],
        min,
        max,
        defaultValue,
      })),
      popularity: tuple[SLOT.pop],
      trending: tuple[SLOT.trend],
      added: tuple[SLOT.added],
      modified: tuple[SLOT.mod],
      flags,
      ...decodeFlags(flags),
      script: enums.scr[tuple[SLOT.scr]],
      blackness: tuple[SLOT.black],
      mask: maskIndex === NO_COVERAGE ? null : masks[maskIndex],
    }
  })
}
