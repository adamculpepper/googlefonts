# Google Fonts Browser — Plan (approved 2026-08-22)

## Context

Adam wants a new tool site: every Google Font on one page, each card rendering the visitor's own text (logo/wordmark use case), with pagination by default and a "show all" option. Controls for font size, grid size, weight filters (e.g. only 700+, or "thickest each family has"), plus every other useful way to slice the catalog. Project root: `C:\repos\googlefonts`. Repo: https://github.com/adamculpepper/googlefonts.git (created, presumably empty).

This builds on a prior web-session answer Adam screenshotted (included in his prompt). Core verdicts from it, now live-verified on 2026-08-22:

## Verified facts (live, 2026-08-22)

- `https://fonts.google.com/metadata/fonts` — keyless, returns 1,942 families with fields: `family, displayName, category, stroke, classifications, size, subsets, fonts (per-weight incl. italics), axes (variable min/max), designers, lastModified, dateAdded, popularity, trending, defaultSort, isNoto, colorCapabilities, primaryScript, primaryLanguage, isOpenSource, isBrandFont, languages`. 1,821 have latin subset; 555 variable; 212 Noto.
  - Consequence: NO API key needed anywhere (the web answer's Developer API step is unnecessary), and no cloning google/fonts for METADATA.pb — classification + stroke are already in this endpoint.
- `https://fonts.googleapis.com/css2?family=X:wght@700&text=AcmeCorp&display=block` — keyless, returns @font-face with a woff2 subsetted to exactly the requested characters (verified: unicode-range only covers the typed letters). This is the whole viability story: per-card payload drops from ~25KB to ~2KB.

## Rate limiting (Adam's question)

Not a real risk. No key, no published quota on css2/gstatic; they serve a huge fraction of the web. The true constraint is bytes and concurrency, solved by: `text=` subsetting, debounced input (300–500ms), charset-hash caching, families chunked ~20–30 per css2 URL, virtualization so only visible cards request fonts. Self-hosting v1 makes it WORSE (loses `text=`, ~30MB payload). Recommendation: Google CDN v1, optional v2 self-host path (R2 + hb-subset WASM) if independence/EU privacy ever matters.

## Decisions (LOCKED by Adam, 2026-08-22)

1. Font delivery: Google CDN + text= subsetting (v2 self-host path stays on the roadmap only)
2. Stack: Vite 5 + React 18, no TypeScript (house pattern)
3. Hosting: GitHub Pages via Actions + CNAME subdomain of adamculpepper.net — the exact color-palette pattern (deploy.yml copied verbatim incl. the `rm -f package-lock.json` npm/cli#4828 quirk, `base: './'`, `public/CNAME`). Default name googlefonts.adamculpepper.net unless Adam renames before DNS.
4. Design flow: build the real app directly, dedicated polish pass (impeccable) at the end

## Conventions report (from repo survey, condensed)

- C:\repos\googlefonts exists, EMPTY, not a git repo yet → git init + wire to remote
- Structure: folder-per-component with co-located .css; `controls/` flat with shared controls.css; `src/lib/` pure logic (no React, no clock, no Math.random); `src/styles/{variables,themes,global}.css` token system
- State: Context + useReducer in `src/context/AppContext.jsx`, throwing `useApp()` hook; live-vs-committed split for undo; theme via `data-theme` on html + localStorage + blocking `public/theme-boot.js`
- **Param registry** (`src/data/params.js`): single source of truth driving sidebar UI, defaults, and URL-share codec; `showIf` predicates; `Control.jsx` type-switch dispatcher; SliderControl = range + number pair
- Icons: FontAwesome npm trio funnelled through one `src/components/Icon.jsx` semantic-name map
- Analytics: gtag loader in index.html + `public/analytics.js` (file, never inline); NEW GA property needed
- Versioning: package.json = CHANGELOG.md top = `src/data/version.js`, enforced by `scripts/verify-*.mjs` fixtures
- README house structure (pitch → live demo → hero.png → what/features/getting started/how it works/structure/deploy/stack)
- Gaps to close in the new project: OG/Twitter/JSON-LD meta, robots.txt, sitemap.xml (all missing from prior repos)

## Architecture sketch (to be detailed by planners)

### Build-time data pipeline (FINAL — from planner 1, all claims live-verified 2026-08-22)

**Zero npm dependencies.** Node 22 stdlib only. Key verified tricks:
- css2 with a non-browser User-Agent returns **raw TTF** (magic `00 01 00 00`) — no woff2/brotli decoding, no node-canvas, no native builds. Undocumented behavior: build asserts sfnt magic + score anchors so a change breaks loudly.
- `fonts.google.com/metadata/fonts/{Family}` (per-family, HAS the `)]}'` guard; the list endpoint does NOT) returns exact per-codepoint `coverage` ranges → glyph coverage costs ZERO font downloads (~12s for all 1,942 at concurrency 8).
- Blackness: fetch each family's heaviest servable weight subsetted to `text=HAMBURGEFONTSIV` (~6KB avg, ~30s total, 11.2MB cache) → pure-JS glyf parser + scanline rasterizer (~120 lines, prototyped live; all sampled families incl. color fonts are glyf-flavored, zero CFF) → ink ratio in bbox → normalize `(ratio-0.05)/(0.75-0.05)` → 0–100, constants baked as `algo.blackness` (never percentile — stable across refreshes). Verified anchors: Anton .687 > Roboto 900 .545; Alfa Slab One .718; Raleway 100 .078.
- Weight ladder walk (900→100 ∩ available/axis range) resolves 1,942/1,942; css2 silent-failure mode = HTTP 200 EMPTY body (21 families hit it) → treat as ladder miss. Buda (300-only) and Molle (italic-only, `:ital,wght@1,400`) handled by ladder. Reject bodies not starting `00010000|OTTO|true|ttcf` (Noto Color Emoji served an HTML error page).
- `languages[]` is EMPTY for all families (kill that proxy idea); Material Symbols absent from metadata (no exclusion logic needed); color fonts (Nabla etc., 21 families) have normal glyf shells → measurable, flagged via colorCapabilities bits; per-file 4MB cap (Nabla 1.18MB outlier).

**Files:** `src/lib/font/{sfnt,raster,blackness}.js` + `src/lib/{coverage,catalog,weights}.js` (pure, shared with frontend + verify) · `scripts/lib/net.mjs` (pool/retry/cache) · `scripts/build-data.mjs` · `scripts/verify-data.mjs` · cache in gitignored `scripts/.cache/`.

**Output:** `public/data/fonts.json` — fetched at runtime (NOT bundled; parallel download, independent caching), preloaded via `<link rel="preload" as="fetch">`, cache-busted by `?v=` from bundled `src/data/catalog-meta.js`. Compact-array tuple schema (17 slots/family, enum palettes, dates as YYYYMMDD ints, flags bitfield: isNoto/isBrandFont/isVariable/hasLatin/COLR0/COLR1/OTSVG/blacknessComparable). Measured: ~199KB raw / 43KB gz; +coverage masks ≈ 290KB raw / 55KB gz. Coverage = 489-codepoint probe set (ASCII+Latin-1+Ext-A+typographic punctuation+Greek+Cyrillic) → 62-byte bitmasks, deduped palette (~970 unique). Frontend `testMask()` answers exactly within the probe; outside it falls back to subsets heuristic marked unverified.

**Scripts:** `npm run data:refresh` (incremental via lastModified+size diff; cold ~45s, no-change = 1 request; prints diff summary + histogram), `npm run data:verify` = 33 ordered checks (schema/shape/enums/weights/blackness anchors/coverage spot-checks incl. "Anton covers A–Z, not Ж"/dates/pure-logic unit tests), wired as `prebuild` so CI never touches Google. fonts.json committed; refresh is a manual ~monthly chore.

**Critical downstream implication for the frontend:** variable families should be requested WITHOUT a `:wght@` pin (css2 then serves the full variable font; weight set client-side via CSS `font-weight`) — intermediate pinned instances are derived, not probed, and Roboto Flex proves derivation can lie (axis to 1000, only 400 servable).

### Runtime font engine + grid (FINAL — from planner 2, css2 behavior live-probed 2026-08-22)

**Verified css2 facts that shape the design:**
- Hard cap **120 `family=` params per request** (121 → 403, independent of URL length; 4,987-char URL fine). Ship `MAX_FAMILIES_PER_REQUEST = 100` guard, `CHUNK_SIZE = 24` default.
- A bad family in a multi-family request is **silently dropped** (200 + other faces, NOT 400) → per-family verification against the parsed face map is mandatory; `response.ok` proves nothing per family. Mixed per-family weights in one URL work fine (no grouping by weight needed); response comes back **alphabetized**, parser keys by font-family value.
- css2 **lies about coverage** (returns a stub face with the requested unicode-range even when the font has none of those glyphs) → coverage needs catalog masks + runtime probe, never the response.
- Both origins send `ACAO: *` → **fetch() + programmatic FontFace, NOT `<link>` injection.** `document.fonts.delete()` is a no-op on CSS-connected faces, so the link path forecloses eviction entirely. fetch path buys: real HTTP status codes, per-family eviction, AbortController cancelation, no document-wide style recalc, and we only apply a family to a card after `face.load()` resolves — architecturally impossible to flash Arial.
- Google normalizes `text=` to sorted-unique itself → our sorted-unique charset produces byte-identical URLs = HTTP cache hits. CSS cached 24h private, woff2 24h public.
- Per-family payload for an 8-char wordmark: 1.5–5KB. VF full range ≈ 2x a single instance (Inter 3,348B vs 1,612B).

**Engine architecture:**
- **Generation aliasing:** faces registered as `gf_{slug}_{charsetHash}` (never real names) → old/new text generations are different fonts, atomic per-card swap via `--specimen-font`, no matching collisions, old generation safely deletable. **Swap then evict** (clear a family's old generation only after its new one is ready).
- **Omit unicodeRange** on constructed faces (deliberate): missing chars render as that font's .notdef tofu — the honest signal — and it powers the canvas coverage probe. Needs a "do not fix" comment.
- Staleness is safe by construction: chunk responses only ever write keys of their own charsetHash; cards subscribe to current-hash keys; no shared cell, no sequencing logic. Cancel in-flight chunks on supersede.
- Files: `src/lib/fontUrl.js` (pure: normalizeCharset, charsetHash, fontKey/fontAlias, resolveWeight per CSS font-matching spec incl. 400-prefers-500, familySpec, planChunks, buildCss2Url, parseFaces), `fontLoader.js` (createFontManager factory: request/subscribe/getStatus per useSyncExternalStore contract with FROZEN stable status refs, evictTo, probeConnectivity), `fontLru.js`, `fontCoverage.js` (offscreen-canvas notdef probe vs U+F8FF reference, requires reference ink else 'unknown'), `familySelect.js` + `searchIndex.js` (pure filter/sort/slice), `stateCodec.js` ported from color-palette.
- Eviction: LRU keyed by fontKey, `maxLiveFaces = 240` + `maxLiveBytes = 3MB` (whichever first), never evict the load window, stale generations first; `document.fonts.size` is the free deterministic gate; dev assert `delete()` returns true.
- Failure modes: chunk 4xx/5xx → retry once then split-in-half (isolates poison family); dropped family → 'dropped' immediately, card says "No 700 weight; nearest is 500"; boot-time canary distinguishes ad-blocker vs offline (different banner copy + retry policy); 403 backoff.
- Coverage layers: (1) catalog probe masks (data pipeline ships 489-codepoint masks — supersedes the engine planner's ASCII-bitmap escalation, resolved) filter BEFORE requesting; (2) runtime canvas probe at load for outside-probe chars.

**Grid:**
- `@tanstack/react-virtual` v3, one virtual item = one ROW of N uniform cards. **Deterministic row height** (specimen box = fontSize x 1.5, no wrap, clip with fade + fit-to-width option) → estimateSize exact, zero measurement churn. MUST call `virtualizer.measure()` in useLayoutEffect on rowHeight/columns change (cache doesn't self-invalidate — classic overlap bug). Scroll anchoring: keep top family on columns/size change via ref + scrollToIndex.
- Pagination + show-all are one FontGrid fed a pre-sliced array; mode switches preserve position (paged→all lands on same families via scrollToIndex; all→paged computes page from top index); filter/sort change resets page 0.
- Memoization: font-load status NEVER in React state (per-card useSyncExternalStore, one face resolve = one card render); split state/actions contexts (keystroke re-renders input only); memo'd FontCard with primitive props only; fontKeys computed once per settings change in FontGrid. Card states via `data-state` attr: loading-first (skeleton, name in UI font), loading-regenerating (old text in old font + edge shimmer — grid never blanks), ready, unsupported (missing chars named), error.
- Load window: virtualizer range + 4 buffer rows, ordered center-out, gated on `isScrolling` false + 120ms trailing; text change bypasses the scroll gate. Debounce 350ms; URL hash written on COMMIT (blur/Enter — one undo entry per word), not per keystroke.

**Cross-planner reconciliations (my calls):**
1. Variable families: request full `wght@min..max` range ONCE (~2x bytes but the weight slider then costs zero network, and pinned intermediate instances are unreliable — Roboto Flex serves only 400 of its 100..1000 axis). Static families: one snapped instance. Weight set client-side via font-weight/font-variation-settings.
2. display=block + our own skeletons INTERNALLY (never swap); export snippets for users' own sites use display=swap (correct there). The feature spec's stray "swap on every request" line is overridden.
3. Param registry: feature-spec planner's registry (groups Presets/Preview/Weight/Filters/Language/Sort/Layout, pageSize default 48, columns select with auto) governs UX; engine planner's mechanics (hidden flag, split contexts, reducer action list, page-reset-in-reducer) govern implementation.
4. Two-line specimen (v1.x) stays deterministic: two fixed boxes, no measureElement ever.

Perf budget (verify-perf.mjs, Playwright + CDP, house PASS/FAIL style): boot→first specimen <1.2s cold; debounce→first specimen <700ms p50 warm; keystroke→paint <16ms; 4s show-all scroll: no frame >50ms; DOM nodes <3,000; `document.fonts.size` ≤250 after full-catalog scroll; JS heap <80MB post-GC; full scroll ≈81 css2 requests, <12MB gstatic. Scenario E FIRST: block fonts.googleapis.com → banner appears and NO card ever computes a non-gf_* font — the automated no-Arial guarantee.

**Shell/UI conventions:** FontAwesome via npm through Icon.jsx chokepoint, analytics via public/analytics.js (new GA property), theme-boot.js, no BEM propagation beyond house style, native nesting for states.

### Conventions to honor
- App at repo root; LF-only (.gitattributes from day one to avoid the CRLF mess seen in other repos)
- PLAN.md saved to project root on approval, original prompt verbatim as appendix
- Craft skills: impeccable at UI design/polish time (M5 pass). **humanizer on ALL reader-facing text at write time, not as a deferred sweep** (Adam's direction, re-emphasized 2026-08-22): UI microcopy, help strings on every registry param, chips, banners, empty/error states, the attribution footer, detail-panel copy, README, meta descriptions, CHANGELOG entries. Two-pass audit (text scan + structural pass) before ship per the global method. dataviz N/A (no charts).
- No commits unless Adam asks; never push

## Feature spec (from planner 3, condensed — locked highlights)

**Governing rules:** every control is a `PARAM_REGISTRY` entry; no control ships that the catalog can't power; any default-ON filter must show as a removable chip in the results bar (three default on: hide Noto, Latin only, supports-my-text); render controls vs list filters are never conflated; one primary action per card (open detail); uniform card height per configuration (makes virtualization honest).

**Sidebar groups:** Presets / Preview / Weight / Filters / Language / Sort / Layout.
- Preview: text (empty = family name as specimen; presets menu: pangram, alphabet, numerals...), case (Title done in JS, not CSS), size 12–160 + quick chips, tracking (/1000em), italic, fit-to-width (v1.x), optional 2nd line (v1.x)
- Weight (the hard IA, solved): `weightMode` segmented Set/Thickest/Lightest owns rendering; `weight` slider (shown only in Set; variable = exact clamped value, static = snap nearest, card notes "700 requested, drawn at 500"); below a divider, list filters: `minWeight` (Any/500+/…/900, variable axis counts via toggle), blackness min/max. Bridge via results-bar chip ("482 fonts don't have 700. Hide them") — never auto-coupled
- Filters: name search, category checks with live counts, classification/stroke (top-8 + expander, v1.x), variable-only, has-italic, hide-Noto (default ON), color-only (v1.x), favorites-only (v1.x)
- Language: latinOnly default ON (~120 hidden), script select, supportsText default ON (subset-level check, honest help text; no-op for ASCII)
- Sort: popularity (default), trending, newest, name A-Z/Z-A, thickest/lightest ink (measured blackness), most weights, random (hidden shuffleSeed param → reproducible shared links)
- Layout: columns auto/1–6 (auto derives track width from font size), pageSize 24/48/96/192/All, density Minimal/Normal/Detailed, previewInk (invert specimen independent of app theme), hidden `page` param in URL

**Card:** specimen (aria-hidden), name row in UI font (never its own font), badges by density (category, "14 weights + italics", VF axes, New <12mo, rank only when sorted by it), blackness meter at Detailed, plain-text substitution notes, skeleton until FontFace resolves (display=block internally — NEVER swap; export snippets for users' sites DO use display=swap, which is correct there). Actions: pin (p), favorite (f, v1.x), copy CSS (c), weight nudge ([ ]), open on Google Fonts. Body click = detail panel.

**Compare tray:** bottom dock, max 8 pins, pins carry resolved weight/italic, packed into URL (`roboto:700:i,...`, defensively decoded), mirrored to localStorage; Compare overlay (rows share text/settings, per-row solo/nudge), Print sheet (v1.x), Copy-all-embeds, A/B wipe with 2 pins (v1.x, clip-path).

**Favorites + lists (v1, per Adam's direction 2026-08-22 — localStorage ONLY, never in the URL):**
- Star on every card (`f` key) and in the detail panel toggles the built-in Favorites list.
- "Save to list" action (card overflow + detail panel): checklist of the user's lists plus "New list". A font can live in many lists.
- Storage: `gf-favorites` (array of slugs) and `gf-lists` (array of `{id, name, families[]}`) under the `gf-` namespace, defensively decoded (unknown slugs dropped on load, so a catalog refresh never crashes a list).
- Viewing: a `list` select in the Filters group — All fonts / ★ Favorites / each user list. Selecting one filters the grid to it and shows a removable chip like any other filter. Zero-state for an empty list explains stars and lists in one sentence.
- Manage lists dialog: create, rename, delete (with confirm), per-list counts.
- Device-local by design: the share dialog says in one line that lists don't travel with the link. Pins remain the shareable unit; "pin all from this list" is v1.x. Export/import of lists as a small JSON file is v1.x.

**Attribution + rights (v1, per Adam's direction — every surface):**
- Persistent site footer: not affiliated with Google; font files served by Google Fonts; every typeface belongs to its designers and foundries; link to fonts.google.com and to fonts.google.com/attribution. Short, plain, always visible (not buried in a dialog).
- Every card and the detail panel link back to that family's own page on fonts.google.com (already specced; this is the load-bearing link-back).
- Detail panel metadata shows the designers' names from the catalog and a license line that LINKS OUT ("License: see this font on Google Fonts") — license type is not in the catalog, so the app never claims OFL/Apache for a specific family (honesty rule already in the spec).
- README carries the same attribution section; OG/meta description never implies the fonts are ours.

**Detail panel:** drawer, deep-linkable (`detail` param), big specimen, full weight ladder (drops text= there), variable-axis sliders (opsz auto-set to display size), waterfall, character set, metadata, similar fonts (v1.x: category+stroke+classification+blackness distance), embed blocks: <link> (with preconnects), @import, @fontsource npm (name derived by convention + "check on npm" caveat), CSS snippet reflecting current UI state.

**Priorities:** ~20 items v1 (core grid/controls/filters/sorts, results bar with chips, detail panel, embeds, pin tray, permalinks, keyboard nav, empty/error states, OG meta); v1.x: fit-to-width, shuffle, 2nd line, recently-viewed, favorites, classification filters, similar fonts, print sheet, per-card nudge, A/B wipe, sticky mini input, designer search; v2: language combobox, compare-vs-uploaded-font, runtime glyph coverage, pairing heuristic, PNG export, stylistic sets (needs pipeline GSUB field).

**Responsive (Bootstrap breakpoints):** xl+: 320px sticky sidebar + sticky results bar; <992px (md): sidebar becomes drawer behind Filters button w/ active-count badge; sm: 2 cols, preview input moves below header; xs: 1 col, stepper size control, tray collapses to count button/bottom sheet. Show-all mode swaps pagination for back-to-top.

**A11y:** role=list grid, roving tabindex, card button carries the meta as accessible name, aria-live result count (debounced), focus-trapped dialogs, fieldset/legend for check groups, reduced-motion strips all animation, 44px hit targets, hostile-input URL decoding, no color-only status.

## Milestones (final build order)

**M0 — Repo + plan.** git init in C:\repos\googlefonts (exists, empty), wire remote https://github.com/adamculpepper/googlefonts.git, master branch, `.gitattributes` (`* text=auto eol=lf`) day one. Save PLAN.md to project root with the original prompt verbatim as appendix (global rule). No commits/pushes unless Adam asks.

**M1 — Scaffold + data.** Vite 5 + React 18 (`type: module`, only vite + plugin-react devDeps), `src/styles/{variables,themes,global}.css` tokens, `public/theme-boot.js`, App shell (Header/Sidebar/FontStage). Port from color-palette: stateCodec.js, Control dispatcher + control components (has TextControl/SegmentedControl), Icon.jsx, ControlSection, verify-script conventions. Data pipeline: `src/lib/{catalog,coverage,weights}.js` + `src/lib/font/{sfnt,raster,blackness}.js` + `scripts/{build-data,verify-data}.mjs` + `scripts/lib/net.mjs` → committed `public/data/fonts.json` (~290KB raw/55KB gz), 33 verify checks green, first full run prints the blackness histogram to tune the 0.05/0.75 normalization constants once, then freeze as algo v1.

**M2 — Engine core (the risky heart, in strict order).** (1) `fontUrl.js` pure + `verify-fonturl.mjs` green BEFORE any network code (resolveWeight against a spec table). (2) `fontLoader.js` against a stub fetch: state machine, frozen-status contract, LRU, abort-on-supersede. (3) Real fetch + `verify-css2-contract.mjs` run once to pin the 120-cap/silent-drop/CORS facts. (4) FontCard standalone dev route, all 5 data-states. (5) FontGrid/FontStage virtualized with a fake instant manager (proves virtualization + memoization alone). (6) Integrate real manager — run scenario E (blocked-origin, never-a-system-font) FIRST. (7) Coverage probe, then catalog-mask layer. (8) Eviction on, `document.fonts.size` verified. (9) Pagination/mode-switch/scroll restoration last.

**M3 — Controls + filters (v1 feature tier).** Full param registry per feature spec: Preview group (text/case/size+chips/tracking/italic), Weight group with the render-vs-filter divider + results-bar bridge chips, Filters (search/category with live counts/variable-only/has-italic/hide-Noto), Language (latinOnly/supportsText with honest chips), Sort (popularity default, blackness, random+seed), Layout (columns auto/1–6, pageSize, density, previewInk). Results bar: count + removable chips for every active filter (non-negotiable for the 3 default-ON filters). Presets slot. Sidebar→drawer at <992px.

**M4 — Decide + share (v1 tier).** Detail panel (big specimen, full weight ladder without text=, variable-axis sliders with opsz auto-set, waterfall, charset, metadata incl. designers + link-out license line, 4 embed blocks with copy). Pin/compare tray (max 8, URL-packed + localStorage, compare overlay, copy-all-embeds). **Favorites + lists** (star + save-to-list + list filter + manage dialog, localStorage only, `f` key). Permalink button. Keyboard nav (j/k, p, f, c, [, ], Enter, Esc, /, ?) + shortcuts sheet. Empty/zero-results/error states. **Attribution footer** (not affiliated with Google; typefaces belong to their designers and foundries; links to fonts.google.com and /attribution) + per-card/panel link-backs.

**M5 — Ship.** impeccable polish pass on the real app + a11y pass (roving tabindex, aria-live count, focus traps, reduced-motion, 44px targets). Head: OG/Twitter/JSON-LD, robots.txt, sitemap.xml (gaps the sibling repos never closed). Analytics: gtag loader + public/analytics.js with the new GA property Adam creates. README (humanizer pass) + CHANGELOG + src/data/version.js three-way sync + verify scripts wired to prebuild. Deploy: copy color-palette `.github/workflows/deploy.yml` (branch master, node 20, the rm-package-lock npm/cli#4828 quirk), `base: './'`, `public/CNAME` = googlefonts.adamculpepper.net (Adam can rename before DNS). verify-perf.mjs full budget run; tune CHUNK_SIZE/MAX_LIVE_FACES/debounce against measured numbers.

**Backlog (not v1):** v1.x — fit-to-width, shuffle, second specimen line, recently-viewed, list export/import + pin-all-from-list, classification/stroke filters, similar fonts, print specimen sheet, per-card weight nudge, A/B wipe, sticky mini input, designer search, coverage shards. v2 — language combobox, compare-vs-uploaded-font, runtime glyph-exact coverage, pairing heuristic, PNG export, stylistic sets (needs GSUB pipeline field), self-host + own subsetter (R2 + hb-subset) if independence/EU privacy ever matters.

## Verification

- `npm run data:verify` — 33 offline checks incl. blackness anchors (Anton > Roboto 900) and coverage spot-checks (Anton covers A–Z, not Ж; Noto Sans covers Ж); wired as prebuild so CI never touches Google.
- `scripts/verify-fonturl.mjs` — pure-layer unit tests (weight snap spec table, charset canonicalization, chunk caps, alphabetized parseFaces).
- `scripts/verify-css2-contract.mjs` — live-endpoint asserts of every measured css2 fact (manual/nightly, not CI-blocking); early warning when Google moves the 120 cap.
- `scripts/verify-perf.mjs` — Playwright + CDP scenarios A–E against the perf budget table; scenario E (never a system font) is the product guarantee.
- Manual E2E: type "Ångström Café" → supportsText chip appears and non-covering families drop; weight 700 with "hide them" chip; show-all full scroll with Task Manager native-memory check (the one genuine unknown: whether `document.fonts.delete()` frees native font cache — if not, tighten maxLiveBytes and lean on HTTP cache re-fetch); Lighthouse; network tab shows only subsetted `/l/font` requests.
- Known risks carried consciously: Safari pass needed (FontFace descriptors, TextMetrics precision → coverage degrades to 'unknown'); 120-cap and rate limits are undocumented (guards + contract script); fixed-height single-line specimen is a deliberate tradeoff (fit-to-width + clip affordance cover long text).

## Appendix: original prompt (verbatim)

> We're going to make a new project. It'll be a website that has all the google fonts on the page (paginated by default, but allowing an option to show them all).
>
> This tool will mostly be used to allow people to see all the Google Fonts at the same time and scroll down the page until they find the right one for their text. Imagine someone looking to build a new logo for "Company Name" so they'd put that text, all the blocks would update the text to that and each Google Font would run down the page
>
> I want options for font size, grid side, font options, filters for knocking out fonts that don't have certain weights (like I only want to see fonts in the 700+ weight or the thickest weight each font has, etc.) and anything else you can think of for slicing up and displaying the fonts in a way that helps someone view them easier and pick a font best for their design.
>
> I'm concerned about rate limiting when trying to use that many fonts at once? Should we self host the files instead? Give me all your thoughts. I also talked to you on the web before - I've included your answer as a screenshot.
>
> the project files can be added here: C:\repos\googlefonts
> and this is the repo I've made for us: https://github.com/adamculpepper/googlefonts.git

Follow-up direction, given before plan approval (verbatim):

> add an option to favorite(star) fonts and create lists - localStorage only
> be sure to link back to the fonts and give all the disclaimers the rights, etc. are owned by Google Fonts/the foundries, designers, etc.
> make sure we're humanizing everything.

## Post-review deferred findings (adversarial review, 2026-08-22)

Five confirmed findings were fixed the same day (dialog-blind global shortcuts, container-bound Escape dying, tabbable closed drawer, superseded generations stuck loading, retry counts never forgiven). These remain open, reviewed and consciously deferred:

- Save-to-list popover dies if the grid scrolls its card out of the virtualizer mid-task (focus dropped to body)
- Card hover actions invisible on touchscreen laptops with a fine primary pointer (pointer: coarse does not match)
- j after a mouse scroll focuses the first MOUNTED card (up to 3 overscan rows above the viewport), scrolling backward
- Closing the detail panel does not remove the detail slug from undo history entries made while it was open
- List filter set can go stale while the Filters section is collapsed (re-resolve effect lives inside it)
- The / shortcut does nothing when the Filters section is collapsed or the drawer is closed
- probeCoverage 'partial' results are stored but not surfaced on the card
- Detail panel overlaps the connectivity banner; panel has aria-modal but no scrim (grid stays clickable behind it)
