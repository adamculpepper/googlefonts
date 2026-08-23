# Changelog

The number here, in `package.json`, and in `src/data/version.js` are the same number, and the bump lands in the same change as the work. A fix bumps the patch, a feature bumps the minor. Nothing enforces this automatically yet, so it is on whoever ships the change.

## [1.0.0] - 2026-08-22

First release.

- Type your text once and every Google Font in the catalog draws it. 1,942 families, 48 to a page by default, with 24, 96, 192, and "Show all" as the other options. Show all puts the whole catalog on one endless page.
- Ink density measured from real font outlines at build time, exposed as a "Thickest ink first" sort and a min/max pair of density sliders. It ranks by how black a family actually renders rather than by the weight number it declares, so Anton lands above Roboto instead of below it.
- Weight controls split into how fonts are drawn and which fonts are shown. Draw everything at one weight (families without it snap to their nearest, and the card says so), or draw each family at its own thickest or lightest. Separately, hide families that never reach the weight you need, optionally counting a variable font's axis range.
- Filters for category, variable fonts only, has italic, hide Noto, Latin script only, and "must support my text", the last one checked against each font's real character coverage. The three that default on each show as a removable chip above the grid.
- Favorites and named lists, saved in this browser only. They never ride a share link, because a link carrying somebody else's saved lists would open wrong for everyone who clicked it.
- A compare tray holding up to 8 pinned families, a side-by-side view of the pinned set, and one button that copies a single embed covering all of them.
- A detail panel per font: the full weight ladder with an italic toggle, live sliders for every variable axis, a size waterfall, the character set, and copy-ready embeds as a link tag, an `@import`, a Fontsource npm install, and plain CSS. It still renders its facts and its embed blocks if the font itself fails to load.
- Share links carrying the whole view in the URL hash, including pinned fonts, the open font, and the shuffle seed, so a random order is reproducible from the link.
- Eight presets, from Wordmark and Logo ready through to Thickest first, each applied as a single undo step.
- Keyboard shortcuts for the text box, the search box, moving through results, opening, pinning, favoriting, and copying CSS, with a sheet on `?`.
- Dark and light themes, seeded from the OS setting and remembered after that, with a pre-paint boot script so a reload never flashes the wrong one.
