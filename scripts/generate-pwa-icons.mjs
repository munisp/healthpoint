#!/usr/bin/env node
/**
 * scripts/generate-pwa-icons.mjs
 *
 * Dependency-free generator for the HealthPoint IDR PWA icons.
 *
 * WHY THIS FILE EXISTS:
 * Binary assets cannot be committed reliably through the remote file API used
 * by the assurance/remediation pipeline. Earlier revisions embedded the PNGs
 * as base64 payloads, but those blobs were corrupted in transit (truncated
 * IDAT streams). This revision instead RENDERS the icons at runtime: a small
 * pure-Node PNG encoder (built-in node:zlib only) draws the app icon —
 * teal #0e6e5d background with a white plus mark inside the maskable safe
 * zone — so there is no binary payload to corrupt.
 *
 * HOW TO RUN (required before every production build):
 *   node scripts/generate-pwa-icons.mjs          # writes icons; refuses to overwrite
 *   FORCE=1 node scripts/generate-pwa-icons.mjs  # overwrite existing icons
 *
 * BUILD INTEGRATION:
 * This script MUST run before `vite build` (i.e. as a prebuild step, e.g.
 * "prebuild": "node scripts/generate-pwa-icons.mjs" in package.json, or an
 * equivalent CI step) so that client/public/icons/*.png exists when Vite
 * copies publicDir into dist/public. Without these files the web app
 * manifest references missing icons and PWA installability is broken.
 * (client/public/icons/icon.svg is committed directly as an always-present
 * SVG fallback, referenced by the manifest with purpose "any".)
 *
 * Output files (under client/public/icons/):
 *   - icon-192.png          (192x192, web manifest)
 *   - icon-512.png          (512x512, web manifest)
 *   - apple-touch-icon.png  (180x180, iOS home screen)
 */

import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "client", "public", "icons");

const TEAL = [14, 110, 93, 255]; // #0e6e5d — deep-teal primary design token
const WHITE = [255, 255, 255, 255];

// ── CRC32 (PNG chunk checksums) ─────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Rasterize the icon: teal square + centered white plus (rounded ends). */
function renderPixels(size) {
  const px = new Uint8Array(size * size * 4);
  const barW = Math.round(size * 0.16);
  const barL = Math.round(size * 0.56); // stays inside maskable safe zone
  const c = size / 2;
  const r = barW / 2;
  const half = barL / 2;
  const inRoundedBar = (x, y, x0, y0, x1, y1) => {
    // rectangle with semicircular (rounded) short ends
    if (x >= x0 + r && x <= x1 - r && y >= y0 && y <= y1) return true;
    if (y >= y0 + r && y <= y1 - r && x >= x0 && x <= x1) return true;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const vertical = inRoundedBar(x, y, c - r, c - half, c + r, c + half);
      const horizontal = inRoundedBar(x, y, c - half, c - r, c + half, c + r);
      const color = vertical || horizontal ? WHITE : TEAL;
      px.set(color, (y * size + x) * 4);
    }
  }
  return px;
}

/** Encode raw RGBA pixels as a non-interlaced 8-bit RGBA PNG. */
function encodePng(size, px) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // filter type 0 (none) per scanline
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SIZES = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

const force = process.env.FORCE === "1";
mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const { file, size } of SIZES) {
  const target = join(OUT_DIR, file);
  const buf = encodePng(size, renderPixels(size));
  if (existsSync(target) && !force) {
    // Idempotent for repeated prebuild runs: identical content is fine,
    // diverging content still requires FORCE=1 to overwrite.
    const existing = readFileSync(target);
    if (existing.equals(buf)) {
      console.log(`Up-to-date ${target}; skipping.`);
      written++;
      continue;
    }
    console.error(
      `Refusing to overwrite existing ${target} (set FORCE=1 to overwrite).`
    );
    process.exitCode = 1;
    continue;
  }
  writeFileSync(target, buf);
  console.log(`Wrote ${target} (${buf.length} bytes)`);
  written++;
}

if (written === SIZES.length) {
  console.log("All PWA icons generated.");
}
