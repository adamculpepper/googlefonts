// A small read-only sfnt (TrueType) parser: table directory, head, maxp, hhea,
// hmtx, loca, cmap and glyf outlines.
//
// Why this exists at all: the catalog needs a measured ink ratio per family,
// and measuring ink means reading real outlines. Google's css2 endpoint hands
// back a raw TTF when asked with a non-browser User-Agent, so the whole job is
// a few hundred lines of stdlib JavaScript instead of woff2 decompression and a
// native canvas build. Only the tables listed above are read; everything else
// in the file is skipped.
//
// Every font this parser is pointed at is a Google-served subset of a dozen or
// so glyphs, so lookups stay on-demand rather than materialising cmap tables.

// A file that does not open with one of these is not a font. Google has served
// an HTML error page from a gstatic /l/font URL before (Noto Color Emoji), and
// feeding that to the glyph reader produces plausible nonsense rather than an
// error, so callers are expected to gate on this.
export const SFNT_MAGIC_NUMBERS = Object.freeze([
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO' — CFF outlines
  0x74727565, // 'true' — legacy Apple TrueType
  0x74746366, // 'ttcf' — TrueType collection
])

const MAXIMUM_COMPOSITE_DEPTH = 5

// Composite glyph flags, from the OpenType glyf table spec.
const ARG_1_AND_2_ARE_WORDS = 0x0001
const ARGS_ARE_XY_VALUES = 0x0002
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const WE_HAVE_A_TWO_BY_TWO = 0x0080

// Simple glyph point flags.
const POINT_ON_CURVE = 0x01
const X_SHORT_VECTOR = 0x02
const Y_SHORT_VECTOR = 0x04
const REPEAT_FLAG = 0x08
const X_IS_SAME_OR_POSITIVE = 0x10
const Y_IS_SAME_OR_POSITIVE = 0x20

function toDataView(source) {
  if (source instanceof DataView) return source
  if (source instanceof ArrayBuffer) return new DataView(source)
  if (ArrayBuffer.isView(source)) return new DataView(source.buffer, source.byteOffset, source.byteLength)
  throw new TypeError('sfnt source must be an ArrayBuffer, a DataView or a typed array')
}

export function readMagicNumber(source) {
  const view = toDataView(source)
  if (view.byteLength < 4) return null
  return view.getUint32(0, false)
}

export function isSfnt(source) {
  const magic = readMagicNumber(source)
  return magic !== null && SFNT_MAGIC_NUMBERS.includes(magic)
}

// F2Dot14 is a signed 16-bit fixed-point number with 14 fraction bits.
function readF2Dot14(view, offset) {
  return view.getInt16(offset, false) / 16384
}

function readTableDirectory(view) {
  const tables = new Map()
  const numTables = view.getUint16(4, false)
  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = 12 + index * 16
    if (recordOffset + 16 > view.byteLength) break
    const tag = String.fromCharCode(
      view.getUint8(recordOffset),
      view.getUint8(recordOffset + 1),
      view.getUint8(recordOffset + 2),
      view.getUint8(recordOffset + 3),
    )
    tables.set(tag, {
      offset: view.getUint32(recordOffset + 8, false),
      length: view.getUint32(recordOffset + 12, false),
    })
  }
  return tables
}

function readLocaTable(view, locaTable, numGlyphs, indexToLocFormat) {
  const offsets = new Uint32Array(numGlyphs + 1)
  if (!locaTable) return offsets
  for (let glyphId = 0; glyphId <= numGlyphs; glyphId += 1) {
    if (indexToLocFormat === 0) {
      const at = locaTable.offset + glyphId * 2
      if (at + 2 > view.byteLength) break
      // The short form stores half-offsets, so the real byte offset is doubled.
      offsets[glyphId] = view.getUint16(at, false) * 2
    } else {
      const at = locaTable.offset + glyphId * 4
      if (at + 4 > view.byteLength) break
      offsets[glyphId] = view.getUint32(at, false)
    }
  }
  return offsets
}

// Prefer a full Unicode cmap (format 12) over the BMP-only format 4, and prefer
// a Windows encoding over anything else, which is the order every shaping
// engine uses.
function selectCmapSubtable(view, cmapTable) {
  if (!cmapTable) return null
  const base = cmapTable.offset
  if (base + 4 > view.byteLength) return null
  const numSubtables = view.getUint16(base + 2, false)
  let best = null
  let bestScore = -1
  for (let index = 0; index < numSubtables; index += 1) {
    const recordOffset = base + 4 + index * 8
    if (recordOffset + 8 > view.byteLength) break
    const platformId = view.getUint16(recordOffset, false)
    const encodingId = view.getUint16(recordOffset + 2, false)
    const subtableOffset = base + view.getUint32(recordOffset + 4, false)
    if (subtableOffset + 2 > view.byteLength) continue
    const format = view.getUint16(subtableOffset, false)
    if (format !== 4 && format !== 12) continue
    let score = 0
    if (format === 12) score += 4
    if (platformId === 3 && (encodingId === 10 || encodingId === 1)) score += 2
    else if (platformId === 0) score += 1
    if (score > bestScore) {
      bestScore = score
      best = { format, offset: subtableOffset }
    }
  }
  return best
}

function lookupFormat4(view, subtableOffset, codepoint) {
  // Format 4 is BMP only; anything above U+FFFF is simply not in this table.
  if (codepoint > 0xffff) return 0
  const segCount = view.getUint16(subtableOffset + 6, false) / 2
  const endCodes = subtableOffset + 14
  const startCodes = endCodes + segCount * 2 + 2 // the +2 skips reservedPad
  const idDeltas = startCodes + segCount * 2
  const idRangeOffsets = idDeltas + segCount * 2

  for (let segment = 0; segment < segCount; segment += 1) {
    const endCode = view.getUint16(endCodes + segment * 2, false)
    if (codepoint > endCode) continue
    const startCode = view.getUint16(startCodes + segment * 2, false)
    if (codepoint < startCode) return 0
    const idDelta = view.getInt16(idDeltas + segment * 2, false)
    const idRangeOffset = view.getUint16(idRangeOffsets + segment * 2, false)
    if (idRangeOffset === 0) return (codepoint + idDelta) & 0xffff
    // idRangeOffset is a byte offset measured from its own slot, which is the
    // one genuinely strange thing about this table format.
    const glyphIndexAddress = idRangeOffsets + segment * 2 + idRangeOffset + (codepoint - startCode) * 2
    if (glyphIndexAddress + 2 > view.byteLength) return 0
    const glyphId = view.getUint16(glyphIndexAddress, false)
    return glyphId === 0 ? 0 : (glyphId + idDelta) & 0xffff
  }
  return 0
}

function lookupFormat12(view, subtableOffset, codepoint) {
  const groupCount = view.getUint32(subtableOffset + 12, false)
  let low = 0
  let high = groupCount - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const groupOffset = subtableOffset + 16 + middle * 12
    const startCharCode = view.getUint32(groupOffset, false)
    const endCharCode = view.getUint32(groupOffset + 4, false)
    if (codepoint < startCharCode) high = middle - 1
    else if (codepoint > endCharCode) low = middle + 1
    else return view.getUint32(groupOffset + 8, false) + (codepoint - startCharCode)
  }
  return 0
}

function readSimpleGlyph(view, glyphOffset, numberOfContours) {
  const endPointsOffset = glyphOffset + 10
  const endPoints = new Array(numberOfContours)
  for (let index = 0; index < numberOfContours; index += 1) {
    endPoints[index] = view.getUint16(endPointsOffset + index * 2, false)
  }
  const pointCount = numberOfContours === 0 ? 0 : endPoints[numberOfContours - 1] + 1
  if (pointCount === 0) return []

  const instructionLengthOffset = endPointsOffset + numberOfContours * 2
  const instructionLength = view.getUint16(instructionLengthOffset, false)
  let cursor = instructionLengthOffset + 2 + instructionLength

  const flags = new Uint8Array(pointCount)
  for (let index = 0; index < pointCount; ) {
    const flag = view.getUint8(cursor)
    cursor += 1
    flags[index] = flag
    index += 1
    if ((flag & REPEAT_FLAG) !== 0) {
      let repeats = view.getUint8(cursor)
      cursor += 1
      while (repeats > 0 && index < pointCount) {
        flags[index] = flag
        index += 1
        repeats -= 1
      }
    }
  }

  const xCoordinates = new Int32Array(pointCount)
  let x = 0
  for (let index = 0; index < pointCount; index += 1) {
    const flag = flags[index]
    if ((flag & X_SHORT_VECTOR) !== 0) {
      const delta = view.getUint8(cursor)
      cursor += 1
      x += (flag & X_IS_SAME_OR_POSITIVE) !== 0 ? delta : -delta
    } else if ((flag & X_IS_SAME_OR_POSITIVE) === 0) {
      x += view.getInt16(cursor, false)
      cursor += 2
    }
    // The remaining case — long vector, "same" bit set — means no change at all.
    xCoordinates[index] = x
  }

  const yCoordinates = new Int32Array(pointCount)
  let y = 0
  for (let index = 0; index < pointCount; index += 1) {
    const flag = flags[index]
    if ((flag & Y_SHORT_VECTOR) !== 0) {
      const delta = view.getUint8(cursor)
      cursor += 1
      y += (flag & Y_IS_SAME_OR_POSITIVE) !== 0 ? delta : -delta
    } else if ((flag & Y_IS_SAME_OR_POSITIVE) === 0) {
      y += view.getInt16(cursor, false)
      cursor += 2
    }
    yCoordinates[index] = y
  }

  const contours = []
  let pointIndex = 0
  for (let contourIndex = 0; contourIndex < numberOfContours; contourIndex += 1) {
    const lastPoint = endPoints[contourIndex]
    const contour = []
    for (; pointIndex <= lastPoint && pointIndex < pointCount; pointIndex += 1) {
      contour.push({
        x: xCoordinates[pointIndex],
        y: yCoordinates[pointIndex],
        onCurve: (flags[pointIndex] & POINT_ON_CURVE) !== 0,
      })
    }
    if (contour.length > 0) contours.push(contour)
  }
  return contours
}

// The component matrix is stored in the order xscale, scale01, scale10, yscale,
// which is a column-major 2x2 followed by the translation:
//   x' = xscale * x + scale10 * y + offsetX
//   y' = scale01 * x + yscale * y + offsetY
function transformContours(contours, transform) {
  const { xScale, scale01, scale10, yScale, offsetX, offsetY } = transform
  return contours.map((contour) => contour.map((point) => ({
    x: xScale * point.x + scale10 * point.y + offsetX,
    y: scale01 * point.x + yScale * point.y + offsetY,
    onCurve: point.onCurve,
  })))
}

export function parseSfnt(source) {
  const view = toDataView(source)
  const magic = readMagicNumber(view)
  if (magic === null || !SFNT_MAGIC_NUMBERS.includes(magic)) {
    throw new Error('buffer does not start with an sfnt magic number')
  }
  if (magic === 0x74746366) {
    throw new Error('TrueType collections are not supported; expected a single font')
  }

  const tables = readTableDirectory(view)
  const headTable = tables.get('head')
  const maxpTable = tables.get('maxp')
  const hheaTable = tables.get('hhea')
  const hmtxTable = tables.get('hmtx')
  const glyfTable = tables.get('glyf')
  const locaTable = tables.get('loca')
  const cmapTable = tables.get('cmap')

  if (!headTable || !maxpTable) throw new Error('font is missing the head or maxp table')

  const unitsPerEm = view.getUint16(headTable.offset + 18, false) || 1000
  const indexToLocFormat = view.getInt16(headTable.offset + 50, false)
  const numGlyphs = view.getUint16(maxpTable.offset + 4, false)
  const numberOfHMetrics = hheaTable ? view.getUint16(hheaTable.offset + 34, false) : 0
  const locaOffsets = readLocaTable(view, locaTable, numGlyphs, indexToLocFormat)
  const cmapSubtable = selectCmapSubtable(view, cmapTable)

  // CFF outlines live in a 'CFF ' table with a completely different curve model.
  // Every family sampled from Google Fonts on 2026-08-22 was glyf-flavoured,
  // colour fonts included, so rather than carry a second parser this reports the
  // shortfall honestly and the caller records the family as unmeasurable.
  const hasGlyfOutlines = Boolean(glyfTable && locaTable)

  function glyphIdForCodepoint(codepoint) {
    if (!cmapSubtable) return 0
    return cmapSubtable.format === 12
      ? lookupFormat12(view, cmapSubtable.offset, codepoint)
      : lookupFormat4(view, cmapSubtable.offset, codepoint)
  }

  function advanceWidth(glyphId) {
    if (!hmtxTable || numberOfHMetrics === 0) return unitsPerEm / 2
    // Monospaced tails: every glyph past numberOfHMetrics reuses the last
    // recorded advance and only carries its own left side bearing.
    const metricIndex = Math.min(glyphId, numberOfHMetrics - 1)
    const at = hmtxTable.offset + metricIndex * 4
    if (at + 2 > view.byteLength) return unitsPerEm / 2
    return view.getUint16(at, false)
  }

  function glyphOutline(glyphId, depth = 0) {
    if (!hasGlyfOutlines || glyphId < 0 || glyphId >= numGlyphs) return []
    const start = locaOffsets[glyphId]
    const end = locaOffsets[glyphId + 1]
    // Equal offsets are the standard encoding for a glyph with no outline at
    // all, which is how space and other blanks are stored.
    if (end <= start) return []
    const glyphOffset = glyfTable.offset + start
    if (glyphOffset + 10 > view.byteLength) return []

    const numberOfContours = view.getInt16(glyphOffset, false)
    if (numberOfContours >= 0) return readSimpleGlyph(view, glyphOffset, numberOfContours)
    if (depth >= MAXIMUM_COMPOSITE_DEPTH) return []

    const contours = []
    let cursor = glyphOffset + 10
    let hasMore = true
    while (hasMore) {
      const flags = view.getUint16(cursor, false)
      const componentGlyphId = view.getUint16(cursor + 2, false)
      cursor += 4
      hasMore = (flags & MORE_COMPONENTS) !== 0

      let argument1
      let argument2
      if ((flags & ARG_1_AND_2_ARE_WORDS) !== 0) {
        argument1 = view.getInt16(cursor, false)
        argument2 = view.getInt16(cursor + 2, false)
        cursor += 4
      } else {
        argument1 = view.getInt8(cursor)
        argument2 = view.getInt8(cursor + 1)
        cursor += 2
      }

      const transform = { xScale: 1, scale01: 0, scale10: 0, yScale: 1, offsetX: 0, offsetY: 0 }
      if ((flags & WE_HAVE_A_SCALE) !== 0) {
        transform.xScale = readF2Dot14(view, cursor)
        transform.yScale = transform.xScale
        cursor += 2
      } else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) !== 0) {
        transform.xScale = readF2Dot14(view, cursor)
        transform.yScale = readF2Dot14(view, cursor + 2)
        cursor += 4
      } else if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) {
        transform.xScale = readF2Dot14(view, cursor)
        transform.scale01 = readF2Dot14(view, cursor + 2)
        transform.scale10 = readF2Dot14(view, cursor + 4)
        transform.yScale = readF2Dot14(view, cursor + 6)
        cursor += 8
      }

      if ((flags & ARGS_ARE_XY_VALUES) !== 0) {
        transform.offsetX = argument1
        transform.offsetY = argument2
      }
      // The alternative reading of the arguments is point matching, where the
      // component is aligned by snapping one of its points onto a point of the
      // glyph built so far. It is vanishingly rare in shipping fonts and it
      // would only shift a component slightly, so it is left at no offset
      // rather than carrying the machinery to resolve it.

      const componentContours = glyphOutline(componentGlyphId, depth + 1)
      if (componentContours.length > 0) contours.push(...transformContours(componentContours, transform))
    }
    return contours
  }

  return {
    unitsPerEm,
    numGlyphs,
    numberOfHMetrics,
    hasGlyfOutlines,
    hasCharacterMap: Boolean(cmapSubtable),
    tableTags: [...tables.keys()],
    glyphIdForCodepoint,
    advanceWidth,
    glyphOutline,
  }
}
