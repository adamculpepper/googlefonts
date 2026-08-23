// Fetches and decodes public/data/fonts.json once per session. The promise is
// cached at module level so StrictMode's double-mount (and any future second
// consumer) never fetches twice.
//
// Decoded records are adapted here to the shape the engine layer documents
// (slug, dateAdded, primaryScript); this adapter is the single seam between
// the catalog schema and everything downstream.

import { useEffect, useState } from 'react'
import { decodeCatalog } from '../lib/catalog.js'
import { PROBE } from '../lib/coverage.js'
import { familySlug } from '../lib/fontUrl.js'
import { BUILD_STAMP, CATALOG_URL, EXPECTED_COUNT, SCHEMA_VERSION } from '../data/catalog-meta.js'

let catalogPromise = null

function adaptRecord(decoded) {
  return {
    ...decoded,
    slug: familySlug(decoded.name),
    dateAdded: decoded.added,
    primaryScript: decoded.script,
  }
}

async function loadCatalog() {
  const response = await fetch(`${CATALOG_URL}?v=${SCHEMA_VERSION}.${BUILD_STAMP}`)
  if (!response.ok) throw new Error(`catalog fetch failed with ${response.status}`)
  const json = await response.json()
  if (json.v !== SCHEMA_VERSION) {
    throw new Error(`catalog schema ${json.v} does not match the app's ${SCHEMA_VERSION}`)
  }
  const records = decodeCatalog(json).map(adaptRecord)
  if (records.length < EXPECTED_COUNT * 0.9) {
    // A truncated file decodes fine and then quietly shows a tenth of the
    // catalog; better to fail loudly than to browse a stump.
    throw new Error(`catalog holds ${records.length} families, far below ${EXPECTED_COUNT}`)
  }
  return { records, probe: json.probe || PROBE, generated: json.generated }
}

export function useCatalog() {
  const [state, setState] = useState({ status: 'loading', records: [], probe: PROBE })

  useEffect(() => {
    let cancelled = false
    if (!catalogPromise) catalogPromise = loadCatalog()
    catalogPromise.then(
      (catalog) => {
        if (!cancelled) setState({ status: 'ready', ...catalog })
      },
      () => {
        // Allow a retry on remount rather than caching the failure forever.
        catalogPromise = null
        if (!cancelled) setState({ status: 'error', records: [], probe: PROBE })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
