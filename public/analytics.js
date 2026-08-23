// Google Analytics boot. Lives here as a file rather than an inline block,
// the same rule theme-boot.js follows. This file also injects the gtag loader
// itself (instead of a hardcoded <script> tag in index.html) so that while
// the measurement id below is still the placeholder, visitors pay zero
// network cost: nothing loads, nothing runs.
//
// To activate: replace the placeholder with the real G- id and nothing else.
var MEASUREMENT_ID = 'G-RRR7S61G8S'

;(function () {
  if (MEASUREMENT_ID.indexOf('X') !== -1) return

  var loader = document.createElement('script')
  loader.async = true
  loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID
  document.head.appendChild(loader)

  window.dataLayer = window.dataLayer || []
  // Kept as a declaration because it forwards `arguments`.
  function gtag() {
    window.dataLayer.push(arguments)
  }
  window.gtag = gtag
  gtag('js', new Date())
  // page_location is sent without the hash on purpose: the share hash packs
  // the visitor's typed preview text, and what someone types must not reach
  // an analytics service.
  gtag('config', MEASUREMENT_ID, {
    page_location: window.location.origin + window.location.pathname,
  })
})()
