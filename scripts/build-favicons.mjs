/**
 * Builds the favicon set from one drawing: the "Aa" tile. Run after changing it:
 *
 *   node scripts/build-favicons.mjs
 *
 * Writes, all committed and served from public/, every one a full opaque square:
 *   favicon.svg           64x64 vector, the letters as paths
 *   favicon.ico           16, 32 and 48 in one file
 *   favicon.png           96x96
 *   apple-touch-icon.png  180x180, no alpha channel at all
 *
 * Why every file is a square with no see-through pixels: Google draws a site's
 * icon in a circle next to its results, fills see-through pixels with white, and
 * may show ANY icon file the site lists (on purecss.com, 2026-11-14, it took the
 * 96px PNG). A rounded tile comes out as a small tile inside a white ring. The
 * PNG sizes matter too: Google wants a multiple of 48px, and an SVG-only set gave
 * it nothing to take.
 *
 * Why the letters are paths: an SVG favicon with <text> renders in whatever font
 * each machine has. The tile was drawn as Georgia Bold, so resvg converts the
 * letters with that exact font file and the result looks the same everywhere.
 *
 * Neither sharp nor resvg is a dependency (the build never needs them). They load
 * from SHARP_PATH and RESVG_PATH if set, then from anywhere node can resolve them,
 * then from the copies in C:/repos. FONT_PATH overrides the Georgia Bold file.
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function load(name, envPath, fallback) {
  for (const id of [envPath, name, fallback].filter(Boolean)) {
    try {
      return require(id);
    } catch {}
  }
  throw new Error(`${name} not found. Run \`npm install --no-save ${name}\`, or set the path in the environment.`);
}
const sharp = load('sharp', process.env.SHARP_PATH, 'C:/repos/purecss.com-home-redesign/node_modules/sharp');
const { Resvg } = load('@resvg/resvg-js', process.env.RESVG_PATH, 'C:/repos/songsuey.com/node_modules/@resvg/resvg-js');
const FONT = process.env.FONT_PATH || 'C:/Windows/Fonts/georgiab.ttf';

const SIZE = 64; // viewBox units
const GROUND = '#16161a';
const INK = '#f5f0e8';

// The letters exactly as the original tile set them, converted to a path below.
const LETTERS = `<text x="32" y="45" font-family="Georgia" font-size="34" font-weight="700" fill="${INK}" text-anchor="middle">Aa</text>`;

function lettersAsPath() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${LETTERS}</svg>`;
  const converted = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: [FONT], defaultFontFamily: 'Georgia', serifFamily: 'Georgia' },
  }).toString();
  const paths = [...converted.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!paths.length) throw new Error(`resvg drew no letters; is ${FONT} a Georgia Bold TTF?`);
  // two decimals is far finer than a pixel at any favicon size
  return paths.join(' ').replace(/-?\d+\.\d+/g, (n) => String(Number(Number(n).toFixed(2))));
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${GROUND}"/>
  <path fill="${INK}" d="${lettersAsPath()}"/>
</svg>
`;

/** Each size drawn at its own density, never drawn small and enlarged, then flattened. */
const render = (px) =>
  sharp(Buffer.from(svg), { density: (72 * px) / SIZE }).resize(px, px).flatten({ background: GROUND }).png().toBuffer();
// ICO readers expect 32-bit PNG entries, so these keep an alpha channel, fully opaque
const renderIcoEntry = async (px) => sharp(await render(px)).ensureAlpha().png().toBuffer();

/** One .ico holding a PNG per size, so each place that reads it takes the size it needs. */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

function write(name, buf) {
  writeFileSync(resolve(publicDir, name), buf);
  console.log(`  public/${name.padEnd(22)}${(buf.length / 1024).toFixed(1)} KB`);
}

console.log('favicons built:');
write('favicon.svg', Buffer.from(svg));
write('favicon.ico', ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await renderIcoEntry(size) })))));
write('favicon.png', await render(96));
write('apple-touch-icon.png', await render(180));
