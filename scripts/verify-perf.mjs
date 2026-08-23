// Performance fixture: drives the real app in a real Chrome against the running
// dev server and measures the budgets the plan pins down. Nothing here is a
// unit test; every number is read off the running product (CDP metrics, the
// browser's own long-task observer, document.fonts) so the numbers are the ones
// a visitor would live with.
//   node scripts/verify-perf.mjs            (expects a dev server on :5199)
//   PERF_URL=http://localhost:4173/ node scripts/verify-perf.mjs
//
// Notes for whoever edits this next:
//
// - The dev server is NOT started or stopped here. A missing server is a hard
//   stop, not a failing check: an unmeasured budget must never read as a pass.
//
// - Timings are taken INSIDE the page by a MutationObserver installed before
//   any app code runs, not by polling from node. Poll intervals are tens of
//   milliseconds and would be baked into every measurement.
//
// - Dev-server budgets are looser than the plan's production budgets on
//   purpose (unbundled modules, no minification, React in development). The
//   production figure is printed as detail so the gap stays visible.
import { createRequire } from 'node:module'

const require = createRequire('C:/repos/playwright-tests/')
const { chromium } = require('@playwright/test')

const APP_URL = process.env.PERF_URL || 'http://localhost:5199/'
const TYPED_TEXT = 'Acme Corp'
const VIEWPORT = { width: 1440, height: 900 }

// Budgets. Dev-server figures where the plan's number is a production figure.
const BOOT_BUDGET_MS = 2500
const BOOT_PROD_BUDGET_MS = 1200
const TYPE_BUDGET_MS = 2000
const TYPE_PROD_BUDGET_MS = 1500
const TYPE_REQUEST_BUDGET = 4
const NODE_BUDGET = 3000
const FONT_SET_BUDGET = 250
const HEAP_BUDGET_MB = 80
const CSS2_BUDGET = 130
const LONGTASK_BUDGET_MS = 400

const SCROLL_STEP_PX = 600
const SCROLL_TARGET_PX = 60000
const SAMPLE_EVERY_STEPS = 20
const CONTINUOUS_SCROLL_MS = 4000

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

function note(text) {
  console.log(`        ${text}`)
}

const ms = (value) => `${Math.round(value)}ms`
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`
const kb = (bytes) => `${(bytes / 1024).toFixed(0)}KB`

// Installed before any app script. Everything it records is a page-clock
// timestamp, so no node-side round trip lands inside a measurement.
function installPerfProbe() {
  const perf = {
    firstReady: null,
    lastInput: null,
    typeTarget: null,
    typeHit: null,
    longTasks: [],
    phases: [{ name: 'boot', at: 0 }],
  }
  window.__perf = perf

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perf.longTasks.push({ start: entry.startTime, duration: entry.duration })
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    perf.longTaskObserverFailed = true
  }

  function scan() {
    if (perf.firstReady === null && document.querySelector('.font-card[data-state="ready"]')) {
      perf.firstReady = performance.now()
    }
    if (perf.typeTarget !== null && perf.typeHit === null) {
      const specimens = document.querySelectorAll('.font-card__text')
      for (let index = 0; index < specimens.length; index += 1) {
        if (specimens[index].textContent === perf.typeTarget) {
          perf.typeHit = performance.now()
          break
        }
      }
    }
  }

  function start() {
    if (!document.documentElement) return
    new MutationObserver(scan).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-state'],
    })
    document.addEventListener(
      'input',
      (event) => {
        if (event.target && event.target.id === 'preview-text-input') {
          perf.lastInput = performance.now()
        }
      },
      true,
    )
  }

  if (document.documentElement) start()
  else document.addEventListener('readystatechange', start, { once: true })
}

async function main() {
  // Preflight. An unreachable server is a stop, not a FAIL line.
  try {
    const response = await fetch(APP_URL, { method: 'GET' })
    if (!response.ok) throw new Error(`responded ${response.status}`)
  } catch (error) {
    console.log(`\nSTOPPED  the dev server at ${APP_URL} is unreachable (${error.message}).`)
    console.log('         Start it yourself and re-run; this fixture never starts or stops it.')
    process.exit(2)
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: VIEWPORT })
  const page = await context.newPage()
  await page.addInitScript(installPerfProbe)

  // Every css2 request and every gstatic byte the page pulls, for the whole run.
  const css2Requests = []
  const gstatic = { count: 0, bytes: 0, unsized: 0 }
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('fonts.googleapis.com/css2')) css2Requests.push({ url, at: Date.now() })
  })
  page.on('response', (response) => {
    const url = response.url()
    if (!url.includes('fonts.gstatic.com')) return
    const length = Number(response.headers()['content-length'] || 0)
    gstatic.count += 1
    if (length) gstatic.bytes += length
    else gstatic.unsized += 1
  })

  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('HeapProfiler.enable')

  async function metrics() {
    const result = await cdp.send('Performance.getMetrics')
    const byName = {}
    for (const entry of result.metrics) byName[entry.name] = entry.value
    return byName
  }

  const measured = {}

  // Long tasks are only actionable once you know which interaction produced
  // them, so every phase boundary is stamped on the page clock and the tasks
  // are bucketed against those stamps at the end of the run.
  const mark = (name) =>
    page.evaluate((phase) => {
      window.__perf.phases.push({ name: phase, at: performance.now() })
    }, name)

  try {
    // A. Boot ---------------------------------------------------------------
    section('A. Boot to the first ready specimen')
    try {
      await page.goto(APP_URL, { waitUntil: 'commit' })
      await page.waitForFunction(
        () => window.__perf && window.__perf.firstReady !== null,
        null,
        { timeout: 30000 },
      )
      const bootMs = await page.evaluate(() => window.__perf.firstReady)
      measured.bootMs = bootMs

      await page.waitForTimeout(1200)
      const bootState = await page.evaluate(() => ({
        ready: document.querySelectorAll('.font-card[data-state="ready"]').length,
        cards: document.querySelectorAll('.font-card').length,
        count: (document.querySelector('.results-bar__count') || {}).textContent || '',
        fonts: document.fonts.size,
      }))
      const bootMetrics = await metrics()

      note(`first ready specimen at ${ms(bootMs)} from navigation start`)
      note(`after 1.2s settle: ${bootState.ready}/${bootState.cards} cards ready, results bar reads "${bootState.count}"`)
      note(`document.fonts.size ${bootState.fonts}, DOM nodes ${bootMetrics.Nodes}, heap ${mb(bootMetrics.JSHeapUsedSize)}`)
      note(`css2 requests during boot ${css2Requests.length}, gstatic ${gstatic.count} files / ${kb(gstatic.bytes)}`)

      check(
        `boot to first ready specimen under ${ms(BOOT_BUDGET_MS)} on the dev server`,
        bootMs < BOOT_BUDGET_MS,
        `${ms(bootMs)}  (production budget is ${ms(BOOT_PROD_BUDGET_MS)}; this is an unbundled dev build)`,
      )
      check(
        'the catalog really mounted a full grid, not one lucky card',
        bootState.cards >= 12 && bootState.ready >= 12,
        `${bootState.ready} ready of ${bootState.cards} mounted`,
      )
    } catch (error) {
      check('boot completes and paints a ready specimen', false, error.message)
    }

    // B. Typing -------------------------------------------------------------
    section('B. Typing to the first redrawn specimen')
    try {
      const input = page.locator('#preview-text-input')
      await input.click()
      await input.fill('')
      await page.waitForTimeout(900)
      await mark('typing')

      await page.evaluate((target) => {
        window.__perf.typeTarget = target
        window.__perf.typeHit = null
        window.__perf.lastInput = null
      }, TYPED_TEXT)

      const typeStartedAt = Date.now()
      await input.type(TYPED_TEXT, { delay: 40 })
      await page.waitForFunction(() => window.__perf.typeHit !== null, null, { timeout: 20000 })
      const hitAt = Date.now()

      const typing = await page.evaluate(() => ({
        lastInput: window.__perf.lastInput,
        typeHit: window.__perf.typeHit,
      }))
      const typeMs = typing.typeHit - typing.lastInput
      measured.typeMs = typeMs

      const duringTyping = css2Requests.filter(
        (request) => request.at >= typeStartedAt && request.at <= hitAt,
      ).length
      await page.waitForTimeout(1200)
      const afterSettle = css2Requests.filter((request) => request.at >= typeStartedAt).length
      measured.typeRequests = duringTyping

      const drawn = await page.evaluate((target) => {
        const specimens = [...document.querySelectorAll('.font-card__text')]
        return {
          total: specimens.length,
          onTarget: specimens.filter((element) => element.textContent === target).length,
          ready: document.querySelectorAll('.font-card[data-state="ready"]').length,
        }
      }, TYPED_TEXT)

      note(`last keystroke to first "${TYPED_TEXT}" specimen: ${ms(typeMs)}`)
      note(`the app debounces text 350ms then the load window 120ms, so ~470ms of that is deliberate`)
      note(`css2 requests: ${duringTyping} while typing, ${afterSettle} including the 1.2s settle after`)
      note(`${drawn.onTarget}/${drawn.total} mounted specimens redrawn, ${drawn.ready} cards ready`)

      check(
        `debounce to first redrawn specimen under ${ms(TYPE_BUDGET_MS)}`,
        typeMs < TYPE_BUDGET_MS,
        `${ms(typeMs)}  (production budget is ${ms(TYPE_PROD_BUDGET_MS)})`,
      )
      check(
        `the debounce collapses 9 keystrokes into at most ${TYPE_REQUEST_BUDGET} css2 requests`,
        duringTyping <= TYPE_REQUEST_BUDGET,
        `${duringTyping} requests for ${TYPED_TEXT.length} keystrokes`,
      )
      check(
        'the whole visible page redraws, not just the card that won the race',
        drawn.total > 0 && drawn.onTarget === drawn.total,
        `${drawn.onTarget}/${drawn.total} on the new text`,
      )
    } catch (error) {
      check('typing redraws the specimens', false, error.message)
    }

    // C. Show-all deep scroll ------------------------------------------------
    section('C. Show all, scrolled deep')
    try {
      await mark('show-all switch')
      const layoutHeader = page
        .locator('button.section-header:has(.section-title:text-is("Layout"))')
        .first()
      if ((await layoutHeader.getAttribute('aria-expanded')) !== 'true') await layoutHeader.click()
      const pageSize = page.locator('.control:has(label:text-is("Fonts per page")) select').first()
      await pageSize.selectOption('all')
      await page.waitForFunction(
        () => {
          const element = document.querySelector('.results-bar__count')
          if (!element) return false
          const text = element.textContent || ''
          return / fonts$/.test(text) && !/ of /.test(text)
        },
        null,
        { timeout: 15000 },
      )
      const showAllCount = await page.evaluate(
        () => document.querySelector('.results-bar__count').textContent,
      )
      const geometry = await page.evaluate(() => {
        const stage = document.querySelector('.font-stage')
        return { scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight }
      })
      note(`results bar reads "${showAllCount}", scroller is ${geometry.scrollHeight.toLocaleString('en-US')}px tall`)

      await mark('stepped scroll')
      const css2AtScrollStart = css2Requests.length
      const gstaticAtScrollStart = gstatic.bytes
      const samples = []
      let steps = 0
      let reachedBottom = false

      // Two readings of "DOM size", because they answer different questions.
      // CDP's Nodes counter is renderer-wide and includes detached nodes that
      // JS still references, so it climbs with uncollected garbage. The
      // TreeWalker count is what is actually in the document right now, which
      // is what a virtualization budget is about. Both are reported; the
      // budget is asserted against both, once live and once after a forced GC.
      async function takeSample(at, direction) {
        await page.waitForTimeout(400)
        const sampled = await metrics()
        const live = await page.evaluate(() => {
          const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL)
          let liveNodes = 1
          while (walker.nextNode()) liveNodes += 1
          return {
            liveNodes,
            fonts: document.fonts.size,
            cards: document.querySelectorAll('.font-card').length,
            ready: document.querySelectorAll('.font-card[data-state="ready"]').length,
          }
        })
        samples.push({
          at: Math.round(at),
          direction,
          nodes: sampled.Nodes,
          liveNodes: live.liveNodes,
          heap: sampled.JSHeapUsedSize,
          fonts: live.fonts,
          cards: live.cards,
          ready: live.ready,
          css2: css2Requests.length - css2AtScrollStart,
          gstatic: gstatic.bytes - gstaticAtScrollStart,
        })
      }

      // One pass down to the bottom (or the 60,000px target) and one back up.
      // The return pass is the real eviction test: every family on the way up
      // was evicted on the way down and has to be re-requested and re-evicted.
      async function sweep(direction, maxSteps) {
        let taken = 0
        while (taken < maxSteps) {
          const position = await page.evaluate((stepPx) => {
            const stage = document.querySelector('.font-stage')
            stage.scrollTop = stage.scrollTop + stepPx
            return { top: stage.scrollTop, max: stage.scrollHeight - stage.clientHeight }
          }, direction === 'down' ? SCROLL_STEP_PX : -SCROLL_STEP_PX)
          taken += 1
          steps += 1
          await page.waitForTimeout(30)
          const atEnd =
            direction === 'down' ? position.top >= position.max - 1 : position.top <= 1
          if (taken % SAMPLE_EVERY_STEPS === 0 || atEnd) await takeSample(position.top, direction)
          if (atEnd) return { atEnd: true, top: position.top }
        }
        const top = await page.evaluate(() => document.querySelector('.font-stage').scrollTop)
        return { atEnd: false, top }
      }

      const descent = await sweep('down', Math.ceil(SCROLL_TARGET_PX / SCROLL_STEP_PX))
      reachedBottom = descent.atEnd
      const deepest = samples[samples.length - 1]

      await page.waitForTimeout(1200)
      await cdp.send('HeapProfiler.collectGarbage')
      await page.waitForTimeout(600)
      const afterGc = await metrics()
      const afterGcNodes = await page.evaluate(() => {
        const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL)
        let liveNodes = 1
        while (walker.nextNode()) liveNodes += 1
        return liveNodes
      })
      measured.heapAfterGc = afterGc.JSHeapUsedSize

      await sweep('up', Math.ceil(SCROLL_TARGET_PX / SCROLL_STEP_PX))

      // Eviction runs on requestIdleCallback after a chunk settles, so a
      // reading taken mid-burst catches the overshoot before the sweep. This
      // second reading separates "the ceiling is too high" from "the sweep had
      // not run yet", which is the difference between two different fixes.
      await page.waitForTimeout(2500)
      const settled = await page.evaluate(() => document.fonts.size)
      measured.settledFonts = settled

      console.log('       dir  scrollTop   cdpNodes  liveNodes    heap  fonts  cards  ready  css2   gstatic')
      for (const sample of samples) {
        console.log(
          `    ${sample.direction.padStart(6)}` +
            `${String(sample.at).padStart(11)}` +
            `${String(sample.nodes).padStart(11)}` +
            `${String(sample.liveNodes).padStart(11)}` +
            `${mb(sample.heap).padStart(8)}` +
            `${String(sample.fonts).padStart(7)}` +
            `${String(sample.cards).padStart(7)}` +
            `${String(sample.ready).padStart(7)}` +
            `${String(sample.css2).padStart(6)}` +
            `${kb(sample.gstatic).padStart(10)}`,
        )
      }

      const worstNodes = Math.max(...samples.map((sample) => sample.nodes))
      const worstLiveNodes = Math.max(...samples.map((sample) => sample.liveNodes))
      const worstFonts = Math.max(...samples.map((sample) => sample.fonts))
      const worstCards = Math.max(...samples.map((sample) => sample.cards))
      measured.worstNodes = worstNodes
      measured.worstLiveNodes = worstLiveNodes
      measured.worstFonts = worstFonts
      measured.finalFonts = samples[samples.length - 1].fonts
      measured.scrollCss2 = samples[samples.length - 1].css2
      measured.gstaticBytes = gstatic.bytes

      note(
        `${steps} steps of ${SCROLL_STEP_PX}px, down to ${deepest.at.toLocaleString('en-US')}px` +
          `${reachedBottom ? ' (hit the bottom)' : ''} and back up`,
      )
      note(`at most ${worstCards} cards mounted at once out of the whole show-all list`)
      note(
        `CDP node counter peaked at ${worstNodes}; the document itself peaked at ${worstLiveNodes} nodes ` +
          `(CDP counts detached nodes JS still holds, the document count does not)`,
      )
      note(
        `after a forced GC at the bottom: ${afterGc.Nodes} CDP nodes, ${afterGcNodes} document nodes, ` +
          `heap ${mb(afterGc.JSHeapUsedSize)} (from ${mb(deepest.heap)})`,
      )
      note(
        `css2 for the whole run ${css2Requests.length} (${measured.scrollCss2} of them during this scroll), ` +
          `gstatic ${gstatic.count} files / ${kb(gstatic.bytes)}` +
          `${gstatic.unsized ? ` (${gstatic.unsized} without content-length)` : ''}`,
      )

      check(
        `the document holds under ${NODE_BUDGET} nodes at every depth`,
        worstLiveNodes < NODE_BUDGET,
        `worst ${worstLiveNodes} nodes in the document`,
      )
      check(
        `the renderer's node count is under ${NODE_BUDGET} once the garbage is collected`,
        afterGc.Nodes < NODE_BUDGET,
        `${afterGc.Nodes} after GC, peaked at ${worstNodes} live`,
      )
      check(
        `document.fonts.size never passes ${FONT_SET_BUDGET} (the eviction proof)`,
        worstFonts <= FONT_SET_BUDGET,
        `worst ${worstFonts} faces registered, ${measured.finalFonts} at the end of the sweep, ` +
          `${settled} after 2.5s idle`,
      )
      check(
        `JS heap under ${HEAP_BUDGET_MB}MB after a forced GC`,
        afterGc.JSHeapUsedSize < HEAP_BUDGET_MB * 1024 * 1024,
        mb(afterGc.JSHeapUsedSize),
      )
      check(
        `the whole run stays under ${CSS2_BUDGET} css2 requests`,
        css2Requests.length < CSS2_BUDGET,
        `${css2Requests.length} total, ${measured.scrollCss2} during the scroll`,
      )
      check(
        'every sample was taken of a live grid with cards mounted and specimens drawn',
        samples.every((sample) => sample.cards > 0) && samples.some((sample) => sample.ready > 0),
        `${Math.min(...samples.map((sample) => sample.cards))}-${worstCards} cards mounted per sample`,
      )
    } catch (error) {
      check('show-all scroll completes', false, error.message)
    }

    // D. Continuous scroll ---------------------------------------------------
    section('D. Long tasks during a 4s continuous scroll')
    try {
      await page.evaluate(() => {
        document.querySelector('.font-stage').scrollTop = 0
      })
      await page.waitForTimeout(1200)
      const marker = await page.evaluate(() => ({
        index: window.__perf.longTasks.length,
        now: performance.now(),
        failed: Boolean(window.__perf.longTaskObserverFailed),
      }))
      if (marker.failed) throw new Error('PerformanceObserver refused the longtask type')
      await mark('continuous scroll')

      const travelled = await page.evaluate(
        (duration) =>
          new Promise((resolve) => {
            const stage = document.querySelector('.font-stage')
            const from = stage.scrollTop
            const start = performance.now()
            const tick = () => {
              stage.scrollBy(0, 40)
              if (performance.now() - start < duration) requestAnimationFrame(tick)
              else resolve(stage.scrollTop - from)
            }
            requestAnimationFrame(tick)
          }),
        CONTINUOUS_SCROLL_MS,
      )

      const longTasks = await page.evaluate(
        (since) => window.__perf.longTasks.filter((task) => task.start >= since),
        marker.now,
      )
      // A silent observer and a smooth scroll look identical from here, so the
      // session total is reported as proof the observer is actually wired up.
      const sessionTasks = await page.evaluate(() => ({
        count: window.__perf.longTasks.length,
        total: window.__perf.longTasks.reduce((sum, task) => sum + task.duration, 0),
        worst: window.__perf.longTasks.reduce((worst, task) => Math.max(worst, task.duration), 0),
      }))
      const total = longTasks.reduce((sum, task) => sum + task.duration, 0)
      const worst = longTasks.length ? Math.max(...longTasks.map((task) => task.duration)) : 0
      const over50 = longTasks.filter((task) => task.duration > 50).length
      measured.longTaskTotal = total
      measured.longTaskWorst = worst

      note(`scrolled ${Math.round(travelled).toLocaleString('en-US')}px over ${CONTINUOUS_SCROLL_MS}ms of rAF`)
      note(
        `${longTasks.length} long tasks, worst ${ms(worst)}, ${over50} over 50ms, ` +
          `${ms(total)} of main thread blocked in total`,
      )
      if (longTasks.length) {
        note(
          `durations: ${longTasks
            .map((task) => Math.round(task.duration))
            .sort((a, b) => b - a)
            .slice(0, 8)
            .join(', ')}ms`,
        )
      }

      check(
        `total long-task time under ${ms(LONGTASK_BUDGET_MS)} across the 4s scroll`,
        total < LONGTASK_BUDGET_MS,
        `${ms(total)} across ${longTasks.length} tasks`,
      )
      check(
        'the scroll actually moved, so the budget was measured under load',
        travelled > 1000,
        `${Math.round(travelled)}px`,
      )
      check(
        'the long-task observer is live (it caught tasks elsewhere in the session)',
        sessionTasks.count > 0,
        `${sessionTasks.count} tasks this session, worst ${ms(sessionTasks.worst)}, ${ms(sessionTasks.total)} total`,
      )
    } catch (error) {
      check('the 4s continuous scroll stays inside the long-task budget', false, error.message)
    }

    // E. Blocked origin ------------------------------------------------------
    section('E. fonts.googleapis.com blocked (the product guarantee)')
    let blockedContext
    try {
      blockedContext = await browser.newContext({ viewport: VIEWPORT })
      await blockedContext.route(
        (url) => url.hostname === 'fonts.googleapis.com',
        (route) => route.abort(),
      )
      const blockedPage = await blockedContext.newPage()
      await blockedPage.goto(APP_URL, { waitUntil: 'commit' })
      await blockedPage.waitForSelector('.font-card', { timeout: 20000 })
      await blockedPage.waitForTimeout(6000)

      const blocked = await blockedPage.evaluate(() => {
        const cards = [...document.querySelectorAll('.font-card')]
        const states = {}
        for (const card of cards) {
          const state = card.getAttribute('data-state') || 'none'
          states[state] = (states[state] || 0) + 1
        }
        const specimens = [...document.querySelectorAll('.font-card__text')].map((element) => ({
          family: getComputedStyle(element).fontFamily,
          text: element.textContent,
        }))
        const banner = document.querySelector('.banner')
        return {
          cards: cards.length,
          states,
          ready: document.querySelectorAll('.font-card[data-state="ready"]').length,
          specimens,
          systemDrawn: specimens.filter((entry) => !entry.family.includes('gf_')),
          bannerText: banner ? banner.textContent : null,
          fonts: document.fonts.size,
        }
      })

      note(`banner: ${blocked.bannerText ? `"${blocked.bannerText.trim()}"` : 'NOT PRESENT'}`)
      note(
        `${blocked.cards} cards mounted, states ${JSON.stringify(blocked.states)}, ` +
          `document.fonts.size ${blocked.fonts}`,
      )
      note(
        `${blocked.specimens.length} .font-card__text elements rendered, ` +
          `${blocked.systemDrawn.length} of them without a gf_ alias`,
      )

      check(
        'the connectivity banner appears',
        Boolean(blocked.bannerText),
        blocked.bannerText ? '' : 'no .banner element',
      )
      check(
        'the banner says fonts are being blocked',
        Boolean(blocked.bannerText) && /block/i.test(blocked.bannerText),
        blocked.bannerText ? `"${blocked.bannerText.trim().slice(0, 60)}..."` : '',
      )
      check(
        'not one card claims to be ready',
        blocked.ready === 0,
        `${blocked.ready} ready`,
      )
      check(
        'every mounted card sits in loading or error',
        blocked.cards > 0 &&
          Object.keys(blocked.states).every((state) => state === 'loading' || state === 'error'),
        `${blocked.cards} cards, ${JSON.stringify(blocked.states)}`,
      )
      check(
        'no specimen is drawn in a system font (every rendered specimen keeps a gf_ alias)',
        blocked.systemDrawn.length === 0,
        blocked.systemDrawn.length
          ? blocked.systemDrawn
              .slice(0, 3)
              .map((entry) => `"${entry.text}" in ${entry.family}`)
              .join('; ')
          : `${blocked.specimens.length} specimens rendered`,
      )
    } catch (error) {
      check('the blocked-origin guarantee holds', false, error.message)
    } finally {
      if (blockedContext) await blockedContext.close()
    }

    // Where the main thread actually went ------------------------------------
    section('Long tasks by phase (main page, whole session)')
    try {
      await mark('idle')
      const timeline = await page.evaluate(() => ({
        phases: window.__perf.phases,
        tasks: window.__perf.longTasks,
      }))
      const buckets = timeline.phases.map((phase) => ({ ...phase, count: 0, total: 0, worst: 0 }))
      for (const task of timeline.tasks) {
        let index = 0
        for (let i = 0; i < buckets.length; i += 1) if (task.start >= buckets[i].at) index = i
        buckets[index].count += 1
        buckets[index].total += task.duration
        buckets[index].worst = Math.max(buckets[index].worst, task.duration)
      }
      console.log('    phase                 tasks     total     worst')
      for (const bucket of buckets) {
        console.log(
          `    ${bucket.name.padEnd(20)}` +
            `${String(bucket.count).padStart(6)}` +
            `${ms(bucket.total).padStart(10)}` +
            `${ms(bucket.worst).padStart(10)}`,
        )
      }
      measured.longTaskPhases = buckets
    } catch (error) {
      note(`could not attribute long tasks: ${error.message}`)
    }

    // Summary ----------------------------------------------------------------
    section('Measured')
    console.log(`  boot to first ready specimen   ${measured.bootMs ? ms(measured.bootMs) : 'n/a'}`)
    console.log(`  keystroke to redrawn specimen  ${measured.typeMs ? ms(measured.typeMs) : 'n/a'}`)
    console.log(`  css2 requests while typing     ${measured.typeRequests ?? 'n/a'}`)
    console.log(`  worst nodes in the document    ${measured.worstLiveNodes ?? 'n/a'}`)
    console.log(`  worst CDP node counter         ${measured.worstNodes ?? 'n/a'}  (includes detached nodes)`)
    console.log(`  worst document.fonts.size      ${measured.worstFonts ?? 'n/a'}`)
    console.log(`  heap after forced GC           ${measured.heapAfterGc ? mb(measured.heapAfterGc) : 'n/a'}`)
    console.log(`  css2 requests, whole run       ${css2Requests.length}`)
    console.log(`  gstatic transferred            ${kb(gstatic.bytes)} across ${gstatic.count} files`)
    console.log(`  long-task time, 4s scroll      ${measured.longTaskTotal !== undefined ? ms(measured.longTaskTotal) : 'n/a'}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

const startedAt = Date.now()

main()
  .then(() => {
    console.log(`\nRun took ${Math.round((Date.now() - startedAt) / 1000)}s against ${APP_URL}`)
    console.log(`${failures ? 'FAILED' : 'OK'}  ${checks - failures}/${checks} checks passed`)
    process.exit(failures ? 1 : 0)
  })
  .catch((error) => {
    console.log(`\nFAILED  the harness itself threw: ${error && error.stack ? error.stack : error}`)
    process.exit(1)
  })
