# Changelog

The number here, in `package.json`, and in `src/data/version.js` are the same number, and the bump lands in the same change as the work. A fix bumps the patch, a feature bumps the minor. Nothing enforces this automatically yet, so it is on whoever ships the change.

## [1.7.0] - 2026-08-23

- The Filters button now sits directly beside the name search, where the eye goes next when a name has not narrowed things enough.
- Undo, Redo and Reset all moved up to the header with the other app-wide actions, separated from the Saved button and from the icon buttons by their own hairlines. The results bar below is purely a report on the grid now.
- Narrow screens keep every one of those reachable: below 992px the history buttons move into the controls drawer, and on a phone the preview box takes the width the shuffle button was using.

## [1.6.0] - 2026-08-23

- The remaining filter switches moved into a dropdown behind a Filters button beside the search box, with a badge counting how many are narrowing the grid right now. Back to defaults resets them in a single undo step.
- The sidebar is now only about how fonts are drawn and laid out. Everything that decides which fonts you see lives above the grid.
- The badge counts the same filters the chips show, so it never claims a filter is working when it is not. Must support my text does nothing until there is text, and no longer counts until then.

## [1.5.0] - 2026-08-23

- Fixed the biggest bug in the app so far: the Latin filter, which is on by default, was hiding 388 fonts that carry a full Latin character set, Poppins among them at rank 8. It read the script a family is filed under rather than asking whether the family has Latin at all, so a Latin and Devanagari face like Poppins counted as non-Latin. The default view goes from 1,226 fonts to 1,614, and searching Poppins now finds Poppins.
- Name search, category, and sort moved out of the sidebar and into a bar above the grid. Looking for a typeface is the point of the app, so it no longer starts with opening a panel. Each control still has exactly one home; the sidebar keeps the deeper filters.

## [1.4.0] - 2026-08-23

- Favorites and saved lists now live in the header beside share and theme. The button names whichever collection is on screen and carries a count, so what is filtering the grid is readable from anywhere without opening anything.
- The manage dialog can start a list. Before, a list could only be born from a font's save menu, so there was no way to set up shortlists before picking.
- The header and the bar above the grid are slightly translucent with a blur behind them, so content passing underneath reads as depth instead of sliding under a hard edge. Browsers without backdrop blur get the solid bar rather than a see-through one.
- Disabled Undo and Redo are muted rather than nearly invisible.
- Fixed the collections menu opening behind the bar below it, which made its top entries unclickable.

## [1.3.0] - 2026-08-23

- Favorites and saved lists moved out of a dropdown in the sidebar and onto a row above the grid. Every collection is one click away with its count in view, the active one is obvious, and starring a font updates the count as you go.
- An empty favorites view now says how to fill it rather than suggesting you remove a filter you never set.

## [1.2.0] - 2026-08-23

- A version number in the header, next to the app name, small and muted. The deploy pipeline stamps each release with its own build number, so the site reads v1.2.0.n and the n climbs on every deploy with no file to edit.
- The preview box hints "Custom text" instead of assuming you are naming a brand, sits a little further from the app name, and takes less of the header.

## [1.1.0] - 2026-08-22

- Opening a sidebar section now scrolls it into view. Before, expanding a group near the bottom only made the scrollbar longer while the revealed controls stayed below the fold. Instant instead of smooth when the system asks for reduced motion.
- Section headings sit on a slightly lighter surface, so the sidebar's structure reads at a glance.
- The dropdown arrow keeps a real gap from the edge of the select instead of hugging its border.
- The grid reserves its scrollbar lane, so results no longer shift sideways when a filter drops the count below one page. The sidebar deliberately does not, where the reserved lane read as dead space.
- The "Not affiliated with Google" line centers on the visible area beside the sidebar instead of on a width the sidebar partly covers.

## [1.0.1] - 2026-08-22

- Undo, Redo, and Reset all are labeled buttons on desktop, icons on phones, and Reset all wears a distinct glyph so it can never be mistaken for Undo. The whole group is easier to see against the bar.
- Hovering a Case segment names its case (As typed, UPPERCASE, lowercase, Title Case) instead of repeating one shared sentence four times, and screen readers get the same names.
- Every header and results-bar button carries a tooltip.
- The card action icons stay visible while the save-to-list menu is open instead of fading away underneath it.
- The "Made by" strip and the attribution footer sit level as one bottom band.
- Sharper social preview cards rendered from the real app, page metadata for link embeds, and a Limits section in the README.

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
