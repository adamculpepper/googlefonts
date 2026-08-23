// Turns glyph outlines into a single number: how much of the ink box a family
// actually fills.
//
// The pipeline is flatten, lay out, bound, fill. Curves become polylines, the
// glyphs are set side by side on a pen line using their real advances, the ink
// bounding box is taken across every contour, and a scanline nonzero-winding
// fill counts the covered fraction of that box.
//
// Measuring against the ink box rather than the em box is deliberate: it makes
// the number about stroke weight rather than about how much sidebearing and
// leading the designer left, so a compact face and an airy one with identical
// strokes score the same.

// Six segments per quadratic is well past the point where more segments move
// the ratio in the fourth decimal, and the fill grid quantises finer detail
// away regardless.
export const CURVE_SEGMENTS = 6
export const RASTER_WIDTH = 600
export const VERTICAL_SUPERSAMPLE = 2

function midpoint(first, second) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, onCurve: true }
}

// TrueType contours are quadratic B-splines with an unusual shorthand: two
// off-curve points in a row imply an on-curve point exactly between them, and a
// contour may start off-curve, in which case the implied midpoint of its last
// and first points is the real starting point.
export function flattenContour(contour, segments = CURVE_SEGMENTS) {
  if (!contour || contour.length === 0) return []
  if (contour.length === 1) return [{ x: contour[0].x, y: contour[0].y }]

  const firstOnCurveIndex = contour.findIndex((point) => point.onCurve)
  const start = firstOnCurveIndex >= 0
    ? contour[firstOnCurveIndex]
    : midpoint(contour[contour.length - 1], contour[0])

  // Walk the contour once, starting from the chosen start point and wrapping.
  const ordered = []
  const startIndex = firstOnCurveIndex >= 0 ? firstOnCurveIndex : -1
  for (let step = 1; step <= contour.length; step += 1) {
    const index = ((startIndex + step) % contour.length + contour.length) % contour.length
    ordered.push(contour[index])
  }

  const polygon = [{ x: start.x, y: start.y }]
  let current = start
  let pendingControl = null

  const lineTo = (point) => {
    polygon.push({ x: point.x, y: point.y })
    current = point
  }

  const quadraticTo = (control, end) => {
    for (let step = 1; step <= segments; step += 1) {
      const t = step / segments
      const inverse = 1 - t
      polygon.push({
        x: inverse * inverse * current.x + 2 * inverse * t * control.x + t * t * end.x,
        y: inverse * inverse * current.y + 2 * inverse * t * control.y + t * t * end.y,
      })
    }
    current = end
  }

  for (const point of ordered) {
    if (point.onCurve) {
      if (pendingControl === null) lineTo(point)
      else {
        quadraticTo(pendingControl, point)
        pendingControl = null
      }
      continue
    }
    if (pendingControl !== null) quadraticTo(pendingControl, midpoint(pendingControl, point))
    pendingControl = point
  }

  if (pendingControl !== null) quadraticTo(pendingControl, start)
  else if (current.x !== start.x || current.y !== start.y) lineTo(start)

  return polygon
}

// Sets the glyphs on one pen line, advancing by each glyph's real hmtx advance.
// `glyphs` is a list of `{ contours, advance }` in reading order.
export function layoutGlyphs(glyphs, segments = CURVE_SEGMENTS) {
  const polygons = []
  let penX = 0
  for (const glyph of glyphs) {
    for (const contour of glyph.contours) {
      const polygon = flattenContour(contour, segments)
      if (polygon.length < 3) continue
      polygons.push(polygon.map((point) => ({ x: point.x + penX, y: point.y })))
    }
    penX += glyph.advance
  }
  return polygons
}

export function inkBoundingBox(polygons) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const polygon of polygons) {
    for (const point of polygon) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

// Nonzero winding rather than even-odd, because counters in glyphs like 'O' and
// 'B' are wound the opposite way from their outer contour on purpose; even-odd
// would give the same answer here but would fill self-overlapping strokes wrong
// in script faces, where a stem crossing itself is common.
export function fillRatio(polygons, box, width = RASTER_WIDTH, supersample = VERTICAL_SUPERSAMPLE) {
  if (!box) return 0
  const columns = Math.max(1, Math.round(width))
  const rows = Math.max(1, Math.round((columns * box.height) / box.width))
  const scanlines = rows * supersample
  const columnWidth = box.width / columns

  const edges = []
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const from = polygon[index]
      const to = polygon[(index + 1) % polygon.length]
      // Horizontal edges never cross a scanline; skipping them here is what
      // keeps the half-open crossing rule below consistent.
      if (from.y !== to.y) edges.push({ from, to })
    }
  }
  if (edges.length === 0) return 0

  const crossings = []
  let filledSamples = 0

  for (let scanline = 0; scanline < scanlines; scanline += 1) {
    const y = box.minY + ((scanline + 0.5) / scanlines) * box.height
    crossings.length = 0
    for (const edge of edges) {
      const { from, to } = edge
      // Half-open in y so a vertex shared by two edges is counted exactly once.
      const risesThrough = from.y <= y && to.y > y
      const fallsThrough = to.y <= y && from.y > y
      if (!risesThrough && !fallsThrough) continue
      const t = (y - from.y) / (to.y - from.y)
      crossings.push({ x: from.x + t * (to.x - from.x), direction: risesThrough ? 1 : -1 })
    }
    if (crossings.length < 2) continue
    crossings.sort((left, right) => left.x - right.x)

    let winding = 0
    let spanStart = 0
    for (const crossing of crossings) {
      const wasInside = winding !== 0
      winding += crossing.direction
      const isInside = winding !== 0
      if (!wasInside && isInside) spanStart = crossing.x
      else if (wasInside && !isInside) {
        // Count the column centres that fall inside this span, which is the
        // same thing as rasterising the span onto the fixed-width grid.
        const firstColumn = Math.max(0, Math.ceil((spanStart - box.minX) / columnWidth - 0.5))
        const lastColumn = Math.min(columns - 1, Math.floor((crossing.x - box.minX) / columnWidth - 0.5))
        if (lastColumn >= firstColumn) filledSamples += lastColumn - firstColumn + 1
      }
    }
  }

  return filledSamples / (columns * scanlines)
}

// `glyphOutlines` is a list of `{ contours, advance }`. The result is the share
// of the ink bounding box that the glyphs actually cover, 0 to 1.
export function inkRatio(glyphOutlines) {
  const polygons = layoutGlyphs(glyphOutlines)
  if (polygons.length === 0) return 0
  const box = inkBoundingBox(polygons)
  if (!box) return 0
  return fillRatio(polygons, box)
}
