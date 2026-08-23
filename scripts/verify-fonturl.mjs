// Engine fixture for the pure layer: URL building, response parsing, the face
// cache and the filter/sort/slice pipeline, all exercised end to end with no
// dev server and no network. This runs BEFORE any loading code is written, so
// the risky parts of the engine are pinned by something that fails loudly.
//   node scripts/verify-fonturl.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CSS2_ENDPOINT,
  DEFAULT_CHUNK_SIZE,
  MAX_FAMILIES_PER_REQUEST,
  buildCss2Url,
  charsetHash,
  familySlug,
  familySpec,
  fontAlias,
  fontKey,
  normalizeCharset,
  parseFaces,
  planChunks,
  resolveWeight,
} from '../src/lib/fontUrl.js'
import { createLru } from '../src/lib/fontLru.js'
import {
  FLAGS,
  filterFamilies,
  mulberry32,
  sliceForView,
  sortFamilies,
} from '../src/lib/familySelect.js'
import { buildSearchIndex, foldText, matchesQuery } from '../src/lib/searchIndex.js'

const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib')

let failures = 0
let checks = 0

function section(title) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
}

function check(label, passed, detail = '') {
  checks += 1
  if (!passed) failures += 1
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

function throws(run) {
  try {
    run()
    return false
  } catch {
    return true
  }
}

// 1. familySlug ---------------------------------------------------------------
section('1. familySlug')

const SLUG_CASES = [
  ['Alfa Slab One', 'alfa-slab-one'],
  ['Roboto', 'roboto'],
  ['M PLUS 1p', 'm-plus-1p'],
  ['  Press Start 2P  ', 'press-start-2p'],
  ['Noto Sans JP', 'noto-sans-jp'],
  ['Gruppo!!', 'gruppo'],
  ['Ma  Shan   Zheng', 'ma-shan-zheng'],
  ['Crème Brûlée', 'cr-me-br-l-e'],
  ['', ''],
]
for (const [input, expected] of SLUG_CASES) {
  check(`"${input}" slugs to "${expected}"`, familySlug(input) === expected, familySlug(input))
}
check('a missing name slugs to an empty string', familySlug(undefined) === '' && familySlug(null) === '')

// 2. normalizeCharset ---------------------------------------------------------
section('2. normalizeCharset')

const sortedDedup = normalizeCharset('cab')
console.log(`  "cab"          ${JSON.stringify(sortedDedup)}`)
console.log(`  "aA\\n\\tb U+1F600" ${JSON.stringify(normalizeCharset('aA\n\tb\u{1F600}'))}`)

check('sorted ascending and deduped', JSON.stringify(sortedDedup) === JSON.stringify([97, 98, 99]))
check('repeats collapse', JSON.stringify(normalizeCharset('aabbcc')) === JSON.stringify([97, 98, 99]))
check('anagrams normalize to the same array', JSON.stringify(normalizeCharset('abc')) === JSON.stringify(sortedDedup))
check(
  'an astral pair survives as one codepoint',
  JSON.stringify(normalizeCharset('\u{1F600}')) === JSON.stringify([0x1f600]),
  JSON.stringify(normalizeCharset('\u{1F600}')),
)
// Written as escapes rather than as literal bytes, so this file stays plain
// text: one raw NUL in a source file makes every tool treat it as binary.
const CONTROL_SAMPLE = '\u0000\u0007\n\tA\u007f\u0085\u009f'
check(
  'C0, DEL and C1 controls are stripped',
  JSON.stringify(normalizeCharset(CONTROL_SAMPLE)) === JSON.stringify([65]),
  JSON.stringify(normalizeCharset(CONTROL_SAMPLE)),
)
check('the space is kept', JSON.stringify(normalizeCharset('a b')) === JSON.stringify([32, 97, 98]))
check('empty and non-string inputs give an empty charset',
  normalizeCharset('').length === 0 && normalizeCharset(null).length === 0 && normalizeCharset(42).length === 0)

// 3. charsetHash --------------------------------------------------------------
section('3. charsetHash')

// Pinned to the byte: the hash names every font alias on the page, so a change
// to the mixing function silently invalidates every cached URL in the wild.
const HAMBURG_HASH = '89up'
const EMPTY_HASH = 'ntfp'
const hamburg = charsetHash(normalizeCharset('Hamburgefonstiv'))
console.log(`  "Hamburgefonstiv"  ${hamburg}`)
console.log(`  empty charset      ${charsetHash([])}`)

check('a known charset hashes to its pinned value', hamburg === HAMBURG_HASH, hamburg)
check('an empty charset still hashes', charsetHash([]) === EMPTY_HASH, charsetHash([]))
check(
  'canonical input buys order independence',
  charsetHash(normalizeCharset('cab')) === charsetHash(normalizeCharset('abc')),
  charsetHash(normalizeCharset('cab')),
)
check('different charsets hash differently', charsetHash(normalizeCharset('abc')) !== charsetHash(normalizeCharset('abd')))
check(
  'every hash is exactly 4 base36 characters',
  ['', 'a', 'Hello world', '\u{1F600}\u{1F601}', 'The quick brown fox jumps over the lazy dog', 'Ω'.repeat(40)]
    .every((text) => /^[0-9a-z]{4}$/.test(charsetHash(normalizeCharset(text)))),
)
check('hashing is repeatable within a run', charsetHash(normalizeCharset('Grumpy wizards')) === charsetHash(normalizeCharset('Grumpy wizards')))

// 4. fontKey and fontAlias ----------------------------------------------------
section('4. Keys and aliases')

const romanKey = fontKey({ name: 'Roboto', weightSpec: '700', italic: false, charsetHash: '7ka3' })
const italicKey = fontKey({ name: 'Roboto', weightSpec: '700', italic: true, charsetHash: '7ka3' })
const variableKey = fontKey({ name: 'Inter', weightSpec: '100..900', italic: false, charsetHash: '7ka3' })
console.log(`  ${romanKey}   ${italicKey}   ${variableKey}`)

check('a static roman key reads as planned', romanKey === 'Roboto|700|0|7ka3', romanKey)
check('italic flips the third field', italicKey === 'Roboto|700|1|7ka3', italicKey)
check('a variable key carries the whole range', variableKey === 'Inter|100..900|0|7ka3', variableKey)
check('two weights of one family are two keys', romanKey !== fontKey({ name: 'Roboto', weightSpec: '400', italic: false, charsetHash: '7ka3' }))
check('a new text generation is a new key', romanKey !== fontKey({ name: 'Roboto', weightSpec: '700', italic: false, charsetHash: 'zzzz' }))

check('an alias never uses the real family name', fontAlias('Roboto', '7ka3') === 'gf_roboto_7ka3', fontAlias('Roboto', '7ka3'))
check('an alias slugs a multi-word family', fontAlias('Alfa Slab One', '7ka3') === 'gf_alfa-slab-one_7ka3', fontAlias('Alfa Slab One', '7ka3'))
check(
  'the alias is per family and generation, not per weight',
  fontAlias('Roboto', '7ka3') === fontAlias('Roboto', '7ka3')
    && fontAlias('Roboto', '7ka3') !== fontAlias('Roboto', 'zzzz'),
)

// 5. resolveWeight ------------------------------------------------------------
section('5. resolveWeight against the CSS font matching table')

const STATIC_TWO = { weights: [400, 700], italics: [400, 700], axes: [] }
const VARIABLE_INTER = { weights: [400], italics: [400], axes: [{ tag: 'wght', min: 100, max: 900, def: 400 }] }
const MOLLE = { weights: [], italics: [400], axes: [] }

const WEIGHT_TABLE = [
  [STATIC_TWO, 500, 400, 'desired 500 takes 400 before anything above 500'],
  [STATIC_TWO, 300, 400, 'desired below 400 with nothing below it climbs'],
  [STATIC_TWO, 900, 700, 'desired above 500 with nothing above it descends'],
  [STATIC_TWO, 400, 400, 'an exact hit stays put'],
  [STATIC_TWO, 700, 700, 'an exact hit at the top stays put'],
  [{ weights: [300], italics: [], axes: [] }, 400, 300, 'a single weight is the only answer'],
  [{ weights: [300, 500], italics: [], axes: [] }, 400, 500, 'desired 400 prefers 500 over 300'],
  [{ weights: [300, 600], italics: [], axes: [] }, 500, 300, 'desired 500 prefers below 400 over above 500'],
  [{ weights: [200, 900], italics: [], axes: [] }, 100, 200, 'desired 100 climbs when nothing sits below'],
  [{ weights: [100, 200], italics: [], axes: [] }, 900, 200, 'desired 900 descends when nothing sits above'],
]
for (const [family, requested, expected, why] of WEIGHT_TABLE) {
  const resolved = resolveWeight(family, requested, false)
  check(
    `[${family.weights.join(',')}] wants ${requested} and gets ${expected}`,
    resolved.cssWeight === expected && resolved.weightSpec === String(expected),
    `${resolved.weightSpec} (${why})`,
  )
}

const exactHit = resolveWeight(STATIC_TWO, 700, false)
const snapped = resolveWeight(STATIC_TWO, 500, false)
check('exact is true only when nothing moved', exactHit.exact === true && snapped.exact === false)

const variableWide = resolveWeight(VARIABLE_INTER, 950, false)
const variableMid = resolveWeight(VARIABLE_INTER, 450, false)
const variableLow = resolveWeight(VARIABLE_INTER, 50, false)
console.log(`  variable 950 -> ${variableWide.weightSpec} drawn at ${variableWide.cssWeight}`)

check(
  'a variable family is requested as its whole range',
  variableWide.weightSpec === '100..900' && variableWide.variable === true,
  variableWide.weightSpec,
)
check('950 clamps to 900 and reports itself inexact', variableWide.cssWeight === 900 && variableWide.exact === false)
check('an in-range weight is continuous and exact', variableMid.cssWeight === 450 && variableMid.exact === true)
check('below the axis minimum clamps up', variableLow.cssWeight === 100 && variableLow.exact === false)
check(
  'an axis reaching past 900 is still requested capped at 900',
  resolveWeight({ weights: [], italics: [], axes: [{ tag: 'wght', min: 100, max: 1000 }] }, 900, false).weightSpec === '100..900',
)

const molleUpright = resolveWeight(MOLLE, 400, false)
const molleItalic = resolveWeight(MOLLE, 400, true)
console.log(`  Molle asked upright -> italic ${molleUpright.italic}, roman available ${molleUpright.romanAvailable}`)

check(
  'an italic-only family serves italic even when italic was not asked for',
  molleUpright.italic === true && molleUpright.romanAvailable === false && molleUpright.cssWeight === 400,
)
check('an italic-only family asked for italic agrees', molleItalic.italic === true && molleItalic.italicAvailable === true)

const noItalic = resolveWeight({ weights: [400, 700], italics: [], axes: [] }, 700, true)
check(
  'italic wanted with no italic falls back upright and says so',
  noItalic.italic === false && noItalic.italicAvailable === false && noItalic.cssWeight === 700,
)
check(
  'italic snapping uses the italic weight list, not the roman one',
  resolveWeight({ weights: [400, 700], italics: [400], axes: [] }, 700, true).cssWeight === 400,
)
check(
  'a family with no weights at all resolves to 400 rather than throwing',
  resolveWeight({ weights: [], italics: [], axes: [] }, 700, false).cssWeight === 400,
)

// 6. familySpec ---------------------------------------------------------------
section('6. familySpec, all four shapes')

const staticRoman = familySpec('Roboto', resolveWeight(STATIC_TWO, 700, false))
const staticItalic = familySpec('Roboto', resolveWeight(STATIC_TWO, 700, true))
const variableRoman = familySpec('Inter', resolveWeight(VARIABLE_INTER, 400, false))
const variableItalic = familySpec('Inter', resolveWeight(VARIABLE_INTER, 400, true))
const italicOnly = familySpec('Molle', resolveWeight(MOLLE, 400, true))
const spacedName = familySpec('Alfa Slab One', resolveWeight({ weights: [400], italics: [], axes: [] }, 400, false))
for (const spec of [staticRoman, staticItalic, variableRoman, variableItalic, italicOnly, spacedName]) {
  console.log(`  ${spec}`)
}

check('static roman', staticRoman === 'Roboto:wght@700', staticRoman)
check('static italic asks for the italic instance alone', staticItalic === 'Roboto:ital,wght@1,700', staticItalic)
check('variable roman', variableRoman === 'Inter:wght@100..900', variableRoman)
check('variable italic asks for both axis positions', variableItalic === 'Inter:ital,wght@0,100..900;1,100..900', variableItalic)
check('an italic-only family never asks for a roman it lacks', italicOnly === 'Molle:ital,wght@1,400', italicOnly)
check('spaces become plus signs', spacedName === 'Alfa+Slab+One:wght@400', spacedName)

// 7. planChunks ---------------------------------------------------------------
section('7. planChunks')

const PRIORITY = ['Zeta', 'Yankee', 'Alpha', 'Mu', 'Bravo']
const candidates = PRIORITY.map((name) => ({
  name,
  key: `${name}|400|0|aaaa`,
  alias: fontAlias(name, 'aaaa'),
  resolved: resolveWeight({ weights: [400], italics: [], axes: [] }, 400, false),
}))
const plan = planChunks(candidates, { chunkSize: 2 })
for (const chunk of plan) console.log(`  ${chunk.id}  ${chunk.specs.join(' ')}`)

check('the plan splits at the requested size', plan.length === 3 && plan[0].families.length === 2)
check(
  'chunk boundaries follow priority order, not the alphabet',
  plan[0].families.map((entry) => entry.name).sort().join() === 'Yankee,Zeta',
  plan[0].families.map((entry) => entry.name).join(' '),
)
check(
  'families are alphabetical inside a chunk',
  plan[0].families.map((entry) => entry.name).join() === 'Yankee,Zeta'
    && plan[1].families.map((entry) => entry.name).join() === 'Alpha,Mu',
)
check('specs line up with families', plan.every((chunk) => chunk.specs.length === chunk.families.length
  && chunk.specs.every((spec, index) => spec.startsWith(chunk.families[index].name))))
check('every chunk id is unique', new Set(plan.map((chunk) => chunk.id)).size === plan.length)
check(
  'the same plan built twice has the same ids',
  planChunks(candidates, { chunkSize: 2 }).map((chunk) => chunk.id).join() === plan.map((chunk) => chunk.id).join(),
)
check(
  'a chunk id changes when its contents change',
  planChunks(candidates.slice(1), { chunkSize: 2 })[0].id !== plan[0].id,
)
check('an empty candidate list plans nothing', planChunks([], { chunkSize: 24 }).length === 0)
check('the default chunk size is the planned 24', DEFAULT_CHUNK_SIZE === 24 && MAX_FAMILIES_PER_REQUEST === 100)
check(
  'a chunk size over the per-request cap throws',
  throws(() => planChunks(candidates, { chunkSize: 101 })),
)
check(
  'a lowered cap is honoured too',
  throws(() => planChunks(candidates, { chunkSize: 24, maxPerRequest: 10 })),
)
check('a chunk size below 1 throws', throws(() => planChunks(candidates, { chunkSize: 0 })))

const wide = planChunks(
  Array.from({ length: 250 }, (unused, index) => ({
    name: `Family ${String(index).padStart(3, '0')}`,
    key: `k${index}`,
    resolved: resolveWeight({ weights: [400], italics: [], axes: [] }, 400, false),
  })),
  { chunkSize: MAX_FAMILIES_PER_REQUEST },
)
check(
  'a full-width plan never exceeds the cap in one chunk',
  wide.length === 3 && wide.every((chunk) => chunk.families.length <= MAX_FAMILIES_PER_REQUEST),
  `${wide.length} chunks of ${wide.map((chunk) => chunk.families.length).join('/')}`,
)

// 8. buildCss2Url -------------------------------------------------------------
section('8. buildCss2Url')

const twoFamilies = buildCss2Url(['Roboto:wght@700', 'Alfa+Slab+One:wght@400'], normalizeCharset('Hi there'))
const noText = buildCss2Url(['Inter:wght@100..900'], [])
console.log(`  ${twoFamilies}`)
console.log(`  ${noText}`)

check('the endpoint is css2', twoFamilies.startsWith(`${CSS2_ENDPOINT}?`))
check('display=block is always last and never swap', twoFamilies.endsWith('&display=block') && noText.endsWith('&display=block'))
check(
  'families are sorted into a canonical order',
  twoFamilies.indexOf('family=Alfa+Slab+One') < twoFamilies.indexOf('family=Roboto'),
)
check(
  'input order does not change the URL',
  buildCss2Url(['Alfa+Slab+One:wght@400', 'Roboto:wght@700'], normalizeCharset('Hi there')) === twoFamilies,
)
check(
  'the same word typed in another order gives the byte-identical URL',
  buildCss2Url(['Roboto:wght@700'], normalizeCharset('abc')) === buildCss2Url(['Roboto:wght@700'], normalizeCharset('cba')),
)
check('a duplicated spec is sent once', buildCss2Url(['Roboto:wght@700', 'Roboto:wght@700'], []).split('family=').length === 2)
check('text is percent-encoded', twoFamilies.includes('&text=%20Hehirt&'), twoFamilies.split('&text=')[1])
check(
  'an astral character is percent-encoded as UTF-8',
  buildCss2Url(['Roboto:wght@400'], normalizeCharset('\u{1F600}')).includes('text=%F0%9F%98%80'),
)
check('an empty charset omits text= entirely', !noText.includes('text='), noText)
check('an empty spec list still builds a legal URL', buildCss2Url([], []) === `${CSS2_ENDPOINT}?display=block`)
check(
  'more families than the cap throws rather than earning a 403',
  throws(() => buildCss2Url(Array.from({ length: 101 }, (unused, index) => `F${index}:wght@400`), [])),
)

// 9. parseFaces ---------------------------------------------------------------
section('9. parseFaces')

// The real response shape, alphabetized by family the way css2 returns it.
// Molle was requested alongside these two and is absent, which is exactly how
// a silently dropped family arrives: 200, no error, no faces.
const RESPONSE = `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=inter-roman&skey=a1b2&v=v13) format('woff2');
  unicode-range: U+41, U+43, U+63, U+65, U+6d, U+6f-70, U+72;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 100 900;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=inter-italic&skey=a1b3&v=v13) format('woff2');
  unicode-range: U+41, U+43, U+63, U+65, U+6d, U+6f-70, U+72;
}
/* latin */
@font-face {
  font-family: 'Playfair Display';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url(https://fonts.gstatic.com/l/font?kit=abc123&skey=f3b6&v=v40) format('woff2');
  unicode-range: U+41, U+43, U+63, U+65, U+6d, U+6f-70, U+72;
}
`
const REQUESTED = ['Inter', 'Playfair Display', 'Molle']
const faces = parseFaces(RESPONSE)
const dropped = REQUESTED.filter((name) => !faces.has(name))
console.log(`  parsed  ${[...faces.keys()].map((name) => `${name} x${faces.get(name).length}`).join(', ')}`)
console.log(`  dropped ${dropped.join(', ') || 'none'}`)

check('faces are keyed by the font-family value', [...faces.keys()].join() === 'Inter,Playfair Display', [...faces.keys()].join())
check('quotes are stripped from the family name', faces.has('Playfair Display'))
check('every block of one family is collected', faces.get('Inter').length === 2)
check('a static face keeps its weight as written', faces.get('Playfair Display')[0].weight === '700')
check(
  'a static weight parses to a degenerate range',
  faces.get('Playfair Display')[0].weightRange.min === 700 && faces.get('Playfair Display')[0].weightRange.max === 700,
)
check('a variable face keeps the raw range string', faces.get('Inter')[0].weight === '100 900', faces.get('Inter')[0].weight)
check(
  'a variable range parses to min and max',
  faces.get('Inter')[0].weightRange.min === 100 && faces.get('Inter')[0].weightRange.max === 900,
)
check('font-style is read per block', faces.get('Inter')[0].style === 'normal' && faces.get('Inter')[1].style === 'italic')
check('src survives whole', faces.get('Playfair Display')[0].src.includes('kit=abc123') && faces.get('Playfair Display')[0].src.includes("format('woff2')"))
check('unicode-range survives whole', faces.get('Playfair Display')[0].unicodeRange === 'U+41, U+43, U+63, U+65, U+6d, U+6f-70, U+72')
check('a requested family that was dropped is simply absent', dropped.join() === 'Molle', dropped.join())

const ODD = `@font-face{font-style:italic;src:url(data:font/woff2;base64,d09GMgABAAA=) format("woff2");font-family:"Odd Family";font-weight:  200   }`
const oddFaces = parseFaces(ODD)
check('declaration order and missing whitespace are tolerated', oddFaces.has('Odd Family'), [...oddFaces.keys()].join())
check(
  'a semicolon inside url() does not cut the src in half',
  oddFaces.get('Odd Family')[0].src.includes('base64,d09GMgABAAA=') && oddFaces.get('Odd Family')[0].src.includes('format("woff2")'),
  oddFaces.get('Odd Family')[0].src,
)
check('a missing trailing semicolon still yields the last declaration', oddFaces.get('Odd Family')[0].weight === '200')
check('a face with no font-weight defaults to 400', parseFaces('@font-face { font-family: X; }').get('X')[0].weight === '400')
check(
  'junk never throws',
  parseFaces('not css at all {{{ @font-face').size === 0
    && parseFaces('').size === 0
    && parseFaces(null).size === 0
    && parseFaces(undefined).size === 0,
)
check('a block with no family is skipped rather than keyed on empty', parseFaces('@font-face { font-weight: 700; }').size === 0)

// 10. The face LRU ------------------------------------------------------------
section('10. fontLru')

const GENERATION = 'new1'
const lru = createLru({ maxEntries: 3, maxBytes: 100 })
lru.set('a', { generation: GENERATION }, 20)
lru.set('b', { generation: GENERATION }, 20)
lru.set('c', { generation: GENERATION }, 20)
console.log(`  keys ${lru.keys().join(' ')}  size ${lru.size}  bytes ${lru.bytes}`)

check('keys come back least recently used first', lru.keys().join() === 'a,b,c')
check('bytes are totalled', lru.bytes === 60 && lru.size === 3)
check('get returns the value and touches it', Boolean(lru.get('a')) && lru.keys().join() === 'b,c,a', lru.keys().join())
check('touch moves an entry to the end', lru.touch('b') && lru.keys().join() === 'c,a,b', lru.keys().join())
check('touching a key that is not there is false', lru.touch('zzz') === false)
check('delete removes the entry and its bytes', lru.delete('c') && lru.size === 2 && lru.bytes === 40)
check('deleting twice is false the second time', lru.delete('c') === false)
check('evict is a no-op while under both ceilings', lru.evict(new Set(), GENERATION).length === 0)

const replaced = createLru({ maxEntries: 5, maxBytes: 1000 })
replaced.set('x', { generation: GENERATION }, 10)
replaced.set('y', { generation: GENERATION }, 10)
replaced.set('x', { generation: GENERATION }, 30)
check('replacing a key updates its bytes and its recency', replaced.bytes === 40 && replaced.keys().join() === 'y,x', `${replaced.bytes} ${replaced.keys().join()}`)

const byEntries = createLru({ maxEntries: 3, maxBytes: Infinity })
for (const key of ['a', 'b', 'c', 'd']) byEntries.set(key, { generation: GENERATION }, 10)
const entryEvicted = byEntries.evict(new Set(), GENERATION)
check(
  'the entry ceiling evicts the least recently used',
  entryEvicted.map((entry) => entry.key).join() === 'a' && byEntries.keys().join() === 'b,c,d',
  byEntries.keys().join(),
)

const byBytes = createLru({ maxEntries: Infinity, maxBytes: 100 })
for (const key of ['a', 'b', 'c']) byBytes.set(key, { generation: GENERATION }, 40)
const byteEvicted = byBytes.evict(new Set(), GENERATION)
check(
  'the byte ceiling evicts until it fits',
  byteEvicted.map((entry) => entry.key).join() === 'a' && byBytes.bytes === 80,
  `${byBytes.bytes} bytes left`,
)

// The stale entry is deliberately NOT the oldest, so plain LRU would evict a
// different one and the generation rule is the only thing that can pass this.
const byGeneration = createLru({ maxEntries: 3, maxBytes: Infinity })
byGeneration.set('b', { generation: GENERATION }, 10)
byGeneration.set('c', { generation: GENERATION }, 10)
byGeneration.set('stale', { generation: 'old0' }, 10)
byGeneration.set('d', { generation: GENERATION }, 10)
const generationEvicted = byGeneration.evict(new Set(), GENERATION)
console.log(`  generation-first evicted ${generationEvicted.map((entry) => entry.key).join(' ')}, kept ${byGeneration.keys().join(' ')}`)

check(
  'an old generation is evicted before the least recently used',
  generationEvicted.map((entry) => entry.key).join() === 'stale' && byGeneration.has('b'),
  byGeneration.keys().join(),
)
check(
  'without a current generation the same cache falls back to plain LRU',
  (() => {
    const plain = createLru({ maxEntries: 3 })
    plain.set('b', { generation: GENERATION }, 10)
    plain.set('c', { generation: GENERATION }, 10)
    plain.set('stale', { generation: 'old0' }, 10)
    plain.set('d', { generation: GENERATION }, 10)
    return plain.evict(new Set()).map((entry) => entry.key).join() === 'b'
  })(),
)

const kept = createLru({ maxEntries: 1, maxBytes: Infinity })
for (const key of ['a', 'b', 'c']) kept.set(key, { generation: GENERATION }, 10)
const keptEvicted = kept.evict(new Set(['a', 'b', 'c']), GENERATION)
check(
  'nothing in the keep set is ever evicted, even while over budget',
  keptEvicted.length === 0 && kept.size === 3,
  `${kept.size} entries against a ceiling of 1`,
)
const partlyKept = createLru({ maxEntries: 1, maxBytes: Infinity })
for (const key of ['a', 'b', 'c']) partlyKept.set(key, { generation: GENERATION }, 10)
check(
  'eviction works around the keep set rather than stopping at it',
  partlyKept.evict(new Set(['a']), GENERATION).map((entry) => entry.key).join() === 'b,c' && partlyKept.keys().join() === 'a',
  partlyKept.keys().join(),
)
check(
  'an evicted entry carries its key and value back to the caller',
  entryEvicted[0].key === 'a' && typeof entryEvicted[0].value === 'object',
)

// 11. filterFamilies ----------------------------------------------------------
section('11. filterFamilies')

const LATIN = FLAGS.HAS_LATIN
const CATALOG = [
  {
    name: 'Roboto', slug: 'roboto', displayName: '', category: 'Sans Serif', classifications: ['sans-serif'],
    subsets: ['latin'], weights: [100, 300, 400, 500, 700, 900], italics: [100, 300, 400, 500, 700, 900], axes: [],
    popularity: 1, trending: 40, dateAdded: 20110907, flags: LATIN, primaryScript: 'latin', blackness: 55,
  },
  {
    name: 'Inter', slug: 'inter', displayName: '', category: 'Sans Serif', classifications: ['sans-serif'],
    subsets: ['latin'], weights: [400], italics: [], axes: [{ tag: 'wght', min: 100, max: 900, def: 400 }],
    popularity: 12, trending: 3, dateAdded: 20201201, flags: LATIN | FLAGS.VARIABLE, primaryScript: 'latin', blackness: 48,
  },
  {
    name: 'Anton', slug: 'anton', displayName: '', category: 'Display', classifications: ['display'],
    subsets: ['latin'], weights: [400], italics: [], axes: [],
    popularity: 30, trending: 2, dateAdded: 20120101, flags: LATIN, primaryScript: 'latin', blackness: 69,
  },
  {
    name: 'Molle', slug: 'molle', displayName: '', category: 'Handwriting', classifications: ['handwriting'],
    subsets: ['latin'], weights: [], italics: [400], axes: [],
    popularity: 900, trending: 800, dateAdded: 20130101, flags: LATIN, primaryScript: 'latin', blackness: -1,
  },
  {
    name: 'Noto Sans JP', slug: 'noto-sans-jp', displayName: 'Noto Sans Japanese', category: 'Sans Serif',
    classifications: ['sans-serif'], subsets: ['japanese', 'latin'], weights: [400, 700], italics: [], axes: [],
    popularity: 40, trending: 100, dateAdded: 20140101, flags: FLAGS.NOTO | LATIN, primaryScript: 'japanese', blackness: 50,
  },
  {
    // Empty primaryScript with the Latin flag set: the lenient branch keeps it.
    name: 'Raleway', slug: 'raleway', displayName: '', category: 'Sans Serif', classifications: ['sans-serif'],
    subsets: ['latin'], weights: [100, 400, 800], italics: [100, 400], axes: [],
    popularity: 20, trending: 60, dateAdded: 20100101, flags: LATIN, primaryScript: '', blackness: 8,
  },
  {
    // Empty primaryScript and no Latin flag: nothing says Latin, so it goes.
    name: 'Amiri', slug: 'amiri', displayName: '', category: 'Serif', classifications: ['serif'],
    subsets: ['arabic'], weights: [400, 700], italics: [400], axes: [],
    popularity: 300, trending: 500, dateAdded: 20150101, flags: 0, primaryScript: '', blackness: 45,
  },
  {
    name: 'Crème Brûlée', slug: 'creme-brulee', displayName: '', category: 'Display', classifications: ['display'],
    subsets: ['latin'], weights: [400], italics: [], axes: [],
    popularity: 700, trending: 900, dateAdded: 20160101, flags: LATIN, primaryScript: 'latin', blackness: -1,
  },
]
const NO_FILTERS = {
  q: '', category: [], variableOnly: false, hasItalic: false, hideNoto: false, latinOnly: false,
  supportsText: false, minWeight: 'any', axisCountsForMin: true, blacknessMin: 0, blacknessMax: 100, listSlugs: null,
}
const slugsOf = (records) => records.map((record) => record.slug).join(',')
const filterBy = (overrides) => filterFamilies(CATALOG, { ...NO_FILTERS, ...overrides })

check('no filters keeps the whole catalog', filterBy({}).length === CATALOG.length)
check('a name substring matches case-insensitively', slugsOf(filterBy({ q: 'ROBO' })) === 'roboto', slugsOf(filterBy({ q: 'ROBO' })))
check(
  'diacritics fold on both sides of the comparison',
  slugsOf(filterBy({ q: 'creme brulee' })) === 'creme-brulee' && slugsOf(filterBy({ q: 'BRÛLÉE' })) === 'creme-brulee',
  slugsOf(filterBy({ q: 'creme brulee' })),
)
check('a display name is searchable too', slugsOf(filterBy({ q: 'japanese' })) === 'noto-sans-jp', slugsOf(filterBy({ q: 'japanese' })))
check('a query that matches nothing returns nothing', filterBy({ q: 'zzzzz' }).length === 0)
check('an empty category list means every category', filterBy({ category: [] }).length === CATALOG.length)
check('a category list keeps only those categories', slugsOf(filterBy({ category: ['Display'] })) === 'anton,creme-brulee', slugsOf(filterBy({ category: ['Display'] })))
check('several categories are a union', filterBy({ category: ['Display', 'Serif'] }).length === 3)
check('hideNoto drops the Noto flag', !slugsOf(filterBy({ hideNoto: true })).includes('noto-sans-jp'))
check('variableOnly keeps the variable family', slugsOf(filterBy({ variableOnly: true })) === 'inter')
check('hasItalic keeps only families with an italic', slugsOf(filterBy({ hasItalic: true })) === 'roboto,molle,raleway,amiri', slugsOf(filterBy({ hasItalic: true })))
check(
  'latinOnly keeps every family carrying Latin, whatever script it is filed under',
  slugsOf(filterBy({ latinOnly: true })) === 'roboto,inter,anton,molle,noto-sans-jp,raleway,creme-brulee',
  slugsOf(filterBy({ latinOnly: true })),
)
// The filter asks whether a family HAS Latin, not whether Latin is the script
// it was filed under. Google files Poppins under Deva and Cairo under Arab;
// both carry a full Latin set and both are ordinary picks for a Latin wordmark.
// Reading the recorded script here hid 388 usable families, Poppins at rank 8
// among them. A family that is filed elsewhere but ships Latin stays.
check(
  'a family filed under another script still passes when it carries Latin',
  slugsOf(filterBy({ latinOnly: true })).includes('noto-sans-jp'),
)
// Hiding it is hideNoto's job, and that check sits a few lines above.
check('latinOnly drops a family with neither a script nor the flag', !slugsOf(filterBy({ latinOnly: true })).includes('amiri'))
check('listSlugs narrows to the listed slugs', slugsOf(filterBy({ listSlugs: new Set(['anton', 'inter']) })) === 'inter,anton')
check('an empty listSlugs set hides everything', filterBy({ listSlugs: new Set() }).length === 0)

check(
  'minWeight 700 keeps families that reach it statically',
  slugsOf(filterBy({ minWeight: '700' })) === 'roboto,inter,noto-sans-jp,raleway,amiri',
  slugsOf(filterBy({ minWeight: '700' })),
)
check(
  'a variable axis counts toward the minimum when the toggle is on',
  slugsOf(filterBy({ minWeight: '900' })).includes('inter'),
  slugsOf(filterBy({ minWeight: '900' })),
)
check(
  'the same axis stops counting when the toggle is off',
  !slugsOf(filterBy({ minWeight: '900', axisCountsForMin: false })).includes('inter'),
  slugsOf(filterBy({ minWeight: '900', axisCountsForMin: false })),
)
check('minWeight any is no filter at all', filterBy({ minWeight: 'any' }).length === CATALOG.length)
check('an italic-only weight counts toward the minimum', slugsOf(filterBy({ minWeight: '500', listSlugs: new Set(['amiri']) })) === 'amiri')

check(
  'a narrowed blackness range keeps the families inside it',
  slugsOf(filterBy({ blacknessMin: 50, blacknessMax: 100 })).includes('anton')
    && !slugsOf(filterBy({ blacknessMin: 50, blacknessMax: 100 })).includes('raleway'),
  slugsOf(filterBy({ blacknessMin: 50, blacknessMax: 100 })),
)
check(
  'unmeasured blackness passes a narrowed range at both ends',
  slugsOf(filterBy({ blacknessMin: 60, blacknessMax: 100 })).includes('molle')
    && slugsOf(filterBy({ blacknessMin: 0, blacknessMax: 10 })).includes('creme-brulee'),
  slugsOf(filterBy({ blacknessMin: 60, blacknessMax: 100 })),
)

let coverageCalls = 0
const coversText = (record) => {
  coverageCalls += 1
  if (record.slug === 'molle') return null
  return record.slug !== 'anton'
}
coverageCalls = 0
const covered = filterFamilies(CATALOG, { ...NO_FILTERS, supportsText: true }, coversText)
check('supportsText drops a family that provably cannot draw the text', !slugsOf(covered).includes('anton'))
check('unknown coverage keeps the family', slugsOf(covered).includes('molle'))
check('the coverage callback ran once per surviving candidate', coverageCalls === CATALOG.length, `${coverageCalls} calls`)
coverageCalls = 0
filterFamilies(CATALOG, { ...NO_FILTERS, supportsText: false }, coversText)
check('the coverage callback is not called at all when the filter is off', coverageCalls === 0)
coverageCalls = 0
filterFamilies(CATALOG, { ...NO_FILTERS, supportsText: true, category: ['Display'] }, coversText)
check('coverage is asked last, only about families that survived the cheap filters', coverageCalls === 2, `${coverageCalls} calls`)

check('an empty catalog filters to an empty array', filterFamilies([], NO_FILTERS).length === 0)
check('a missing inputs bag does not throw', filterFamilies(CATALOG).length === CATALOG.length)

// 12. sortFamilies ------------------------------------------------------------
section('12. sortFamilies')

const sortedBy = (sort, seed) => sortFamilies(CATALOG, sort, seed).map((record) => record.slug).join(',')
console.log(`  popularity  ${sortedBy('popularity')}`)
console.log(`  trending    ${sortedBy('trending')}`)
console.log(`  newest      ${sortedBy('newest')}`)
console.log(`  blackness   ${sortedBy('blackness-desc')}`)

check('popularity ranks 1 first', sortedBy('popularity').startsWith('roboto,inter,raleway,anton'), sortedBy('popularity'))
check('trending ranks 1 first', sortedBy('trending').startsWith('anton,inter'), sortedBy('trending'))
check('newest sorts by date descending', sortedBy('newest').startsWith('inter,creme-brulee,amiri'), sortedBy('newest'))
check('name A to Z folds accents into the alphabet', sortedBy('name-az') === 'amiri,anton,creme-brulee,inter,molle,noto-sans-jp,raleway,roboto', sortedBy('name-az'))
check('name Z to A is the exact reverse', sortedBy('name-za') === sortedBy('name-az').split(',').reverse().join(','))
// The two unmeasured families tie at the losing end and then break by
// popularity rank, which is why Creme Brulee (700) precedes Molle (900) in
// both directions rather than mirroring with the rest of the list.
check(
  'thickest ink first, with unmeasured families last',
  sortedBy('blackness-desc') === 'anton,roboto,noto-sans-jp,inter,amiri,raleway,creme-brulee,molle',
  sortedBy('blackness-desc'),
)
check(
  'lightest ink first also leaves unmeasured families last',
  sortedBy('blackness-asc') === 'raleway,amiri,inter,noto-sans-jp,roboto,anton,creme-brulee,molle',
  sortedBy('blackness-asc'),
)
check(
  'the unmeasured pair sits last in both directions rather than flipping ends',
  sortedBy('blackness-desc').endsWith('creme-brulee,molle') && sortedBy('blackness-asc').endsWith('creme-brulee,molle'),
)
check(
  'most weights first, ties broken by popularity',
  sortedBy('weights-desc') === 'roboto,raleway,amiri,noto-sans-jp,inter,anton,creme-brulee,molle',
  sortedBy('weights-desc'),
)
check('an unknown sort falls back to popularity', sortedBy('not-a-sort') === sortedBy('popularity'))
check(
  'sorting never reorders the caller array',
  (() => {
    const before = CATALOG.map((record) => record.slug).join()
    sortFamilies(CATALOG, 'name-za', 1)
    return CATALOG.map((record) => record.slug).join() === before
  })(),
)
check(
  'a re-sort of an already sorted list does not jiggle',
  sortFamilies(sortFamilies(CATALOG, 'weights-desc', 1), 'weights-desc', 1).map((record) => record.slug).join(',')
    === sortedBy('weights-desc'),
)

const seven = sortedBy('random', 7)
console.log(`  random(7)   ${seven}`)
console.log(`  random(8)   ${sortedBy('random', 8)}`)
check('the same seed gives the same order every time', sortedBy('random', 7) === seven)
check('a different seed gives a different order', sortedBy('random', 8) !== seven, sortedBy('random', 8))
check(
  'a shuffle keeps every family exactly once',
  seven.split(',').sort().join() === CATALOG.map((record) => record.slug).sort().join(),
)
check(
  'mulberry32 is a stable stream for a seed',
  (() => {
    const first = mulberry32(42)
    const second = mulberry32(42)
    return [0, 1, 2, 3].every(() => first() === second())
  })(),
)
check('an empty list sorts to an empty list', sortFamilies([], 'popularity').length === 0)
check('a one-item list is returned as a copy', sortFamilies([CATALOG[0]], 'random', 3).length === 1)

// 13. sliceForView ------------------------------------------------------------
section('13. sliceForView')

const twentyFour = Array.from({ length: 60 }, (unused, index) => ({ slug: `f${index}` }))
const firstPage = sliceForView(twentyFour, '24', 1)
const lastPage = sliceForView(twentyFour, '24', 3)
const overshoot = sliceForView(twentyFour, '24', 99)
console.log(`  60 records at 24 per page  ${firstPage.pageCount} pages, page 99 clamps to ${overshoot.clampedPage}`)

check('a full page is the page size', firstPage.pageRecords.length === 24 && firstPage.clampedPage === 1)
check('the page count rounds up', firstPage.pageCount === 3)
check('the last page holds the remainder', lastPage.pageRecords.length === 12 && lastPage.pageRecords[0].slug === 'f48')
check('a page past the end clamps to the last page', overshoot.clampedPage === 3 && overshoot.pageRecords.length === 12)
check('page zero and negative pages clamp to 1', sliceForView(twentyFour, '24', 0).clampedPage === 1 && sliceForView(twentyFour, '24', -5).clampedPage === 1)
check('show all is one page of everything', sliceForView(twentyFour, 'all', 1).pageRecords.length === 60 && sliceForView(twentyFour, 'all', 4).clampedPage === 1)
check('an empty result set is still one page', sliceForView([], '24', 3).pageCount === 1 && sliceForView([], '24', 3).pageRecords.length === 0)
check('an unreadable page size shows everything rather than nothing', sliceForView(twentyFour, 'nonsense', 2).pageRecords.length === 60)
check('a non-array input is handled', sliceForView(null, '24', 1).pageRecords.length === 0)

// 14. The search index --------------------------------------------------------
section('14. searchIndex')

const index = buildSearchIndex(CATALOG)
check('the index holds one entry per slug', index.size === CATALOG.length)
check('a query matches through the index by slug', matchesQuery(index, 'creme-brulee', 'BRULEE') === true)
check('a query that does not match is false', matchesQuery(index, 'creme-brulee', 'roboto') === false)
check('an unknown slug matches nothing', matchesQuery(index, 'not-a-slug', 'a') === false)
check('an empty query matches everything', matchesQuery(index, 'roboto', '') === true)
check('folding strips marks and lowercases', foldText('Crème  Brûlée') === 'creme brulee', foldText('Crème  Brûlée'))
check('folding a non-string is an empty string', foldText(null) === '' && foldText(undefined) === '')

// 15. Purity ------------------------------------------------------------------
section('15. Purity of the engine layer')

// Comments are stripped before scanning, so a module can explain WHY it avoids
// the browser without failing its own check for saying the word.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const OWNED_MODULES = ['fontUrl.js', 'fontLru.js', 'familySelect.js', 'searchIndex.js']
const IMPURE = /Math\.random|Date\.now|new Date\(|\bdocument\b|\bwindow\b|\bnavigator\b|\bfetch\s*\(|localStorage|sessionStorage|require\s*\(/
const impureModules = OWNED_MODULES.filter((file) => IMPURE.test(stripComments(readFileSync(join(LIB_DIR, file), 'utf8'))))
check('no clock, randomness, DOM or network in the engine modules', impureModules.length === 0, impureModules.join(' '))

const importPattern = /^import\s[\s\S]*?from\s+'([^']+)'/gm
const foreignImports = OWNED_MODULES.flatMap((file) => {
  const source = readFileSync(join(LIB_DIR, file), 'utf8')
  return [...source.matchAll(importPattern)].map((match) => match[1]).filter((specifier) => !specifier.startsWith('.'))
})
check('the engine modules import nothing outside their own folder', foreignImports.length === 0, foreignImports.join(' '))

check(
  'the same inputs build the same URL twice in a row',
  buildCss2Url(['Roboto:wght@700', 'Inter:wght@100..900'], normalizeCharset('Specimen'))
    === buildCss2Url(['Inter:wght@100..900', 'Roboto:wght@700'], normalizeCharset('Specimen')),
)

// -----------------------------------------------------------------------------
console.log(`\n${failures ? 'FAILED' : 'OK'}  ${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
