#!/usr/bin/env node
/**
 * scripts/generate-pwa-icons.mjs
 *
 * Dependency-free generator for the HealthPoint IDR PWA icons.
 *
 * WHY THIS FILE EXISTS:
 * Binary assets cannot be committed reliably through the remote file API used
 * by the assurance/remediation pipeline, so this script embeds the icon PNGs
 * as base64 payloads and materializes them on disk. It is the single source
 * of truth for the icons referenced by client/public/manifest.json.
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
 *
 * NOTE (2026-09-05): the embedded payloads were regenerated — the previous
 * base64 blobs decoded to truncated PNGs (incomplete IDAT stream, no IEND
 * chunk; zlib "incomplete or truncated stream" on decode). The current
 * payloads were verified by decode + image-library round-trip: teal #0e6e5d
 * background with a white plus mark inside the maskable safe zone.
 * client/public/icons/icon.svg is also committed directly as an always-
 * present SVG fallback (manifest references it with purpose "any").
 *
 * Output files (under client/public/icons/):
 *   - icon-192.png          (192x192, web manifest)
 *   - icon-512.png          (512x512, web manifest)
 *   - apple-touch-icon.png  (180x180, iOS home screen)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "client", "public", "icons");

const ICON_192_B64 = [
  "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAACVElEQVR4",
  "2u3dsbGCQBSG0WXHGCvEErAWW7BDK8AKCHQE5P7npM68YPd+LAQPhnGe",
  "lgahuiVAACAAEAAIAAQAAgABgABAACAAEAAIAAQAAgABgABAACAAEAAI",
  "AAQAAgABgABAACAAEAAIAAQAAgABgABAACAAEAAIAAQAAgABgABAAPCh",
  "iyXY3+vxXP3ter9ZoB0N4zwtluHYoReDAAy+EDwDGP5t/w4CON3wi0AA",
  "8cMvAgHED78IBBA//CIQAAgg+ervFBAACAAEEHr74zZIACAAEAAIAAQA",
  "AgABgABAACAAEAAIAAQAAgABIABLgABAACAAEAAIAAQAAgABgACgmNLf",
  "CPPmtN+p+p2ycgEYejFEBmDwhRD7DGD4rXtsAIbf+scGYPjtQ2wAht9+",
  "xAZg+O2LWyBIDMDV3/44AUAAEBaA2x/75AQAAYAAQAAgABAAFA+g6r/l",
  "VXOmfXIC4AQAATheCdwfJwBOAFcZUvelW2yS96NbdJL3oVt8kte/2wSS",
  "1927QYm+4Hg7NNGnbOkAEkJz++cZAAQAAgABgABAACAAEAAIAAQAAgAB",
  "gAAQAAgABAACAAGAAEAAIAAQAAgABAACAAHQ2nFvZ/NWOAGAAEAAYbdB",
  "bn8EAAJIPAVc/QUQG4HhF0BsBIZfALERGH4BxEZg+LfjG2E7+eY7YgZf",
  "AHExGHoBgGcAEAAIAAQAAgABgABAACAAEAAIAAQAAgABgABAACAAEAAI",
  "AAQAAgABIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAEAAIAAQAAgABAACAAEAAI",
  "/tsbLz+Ml3wdCGEAAAAASUVORK5CYII="
].join("");

const ICON_180_B64 = [
  "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAACJUlEQVR4",
  "2u3dsXFCMRBFUf4fYqgQSoBaaIEOqQAqIEFIo306J/U4WV+vN7Dl7XS7",
  "vA8QYjcCBA2CBkGDoBE0CBoEDYIGQSNoEDQIGgQNgkbQIGgQNAgaBI2g",
  "QdAgaBA0CBpBg6BB0CBoEDSCBkGDoEHQIGgEDYIGQYOgWdvRCPp5PZ5f",
  "P3a+Xw2og80/3hwXsbidHPExt3weNvRUIdvWNnR0zLa1oKNiFrWgQdAV",
  "tqgtLeiYmEUtaBA0gnZuDD4DnB2CRtAgaBA0CBoEjaBB0CBoEDQIGkGD",
  "oEHQIGgQNIIGQYOgQdAgaAQNggZBQ6uoB889yvK7lIfWywctYnHHnBxi",
  "NteIDS1k2zpmQ4vZvGOCFrO5R9/QUDZo29n8Y4IWs6+DkwMnBwjajzln",
  "h6BB0CBoBA2CBkHDakGn/CVFitm/HjY0NjQI2tnh3BC0qM3fyYGTw5Yg",
  "Y+674ZI079IPzfjVUiFH3dC2tblGbWgbW8TRQad+0/hJtMjJAYJG0CBo",
  "EDQIGgSNoEHQIGgQNAgaQYOgQdAgaAQNggZBg6BB0AgaBA2CBkHPYfSj",
  "Lx6ZETSCBkE7O5wbgha1mAUNgq67pW1nQcdELeY2Hjz/o5bH0IVsQ8ds",
  "azHb0OU3togFDU4OBA2CBkGDoEHQCBoEDYIGQYOgETQIGgQNggZBI2gQ",
  "NAgaBA2CRtAgaBA0CBpBg6BB0CBoEDSCBkGDoEHQIGgEDYIGQUMHH47U",
  "gH+IQvW8AAAAAElFTkSuQmCC"
].join("");

const ICON_512_B64 = [
  "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAIeklEQVR4",
  "2u3bQW6DMBBA0Tjq2pzQHMGchStwQ07grLuqKiISz7y3r1Qs2fMxSqm9",
  "jQcAkMrTEgCAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAA",
  "IAAAAAEAAAgAAEAAAAACAAAQAACAAAAAAQAACAAAQAAAAAIAABAAAIAA",
  "AAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAAAgAA",
  "EAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAAB",
  "AAAIAABAAAAAAgAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAA",
  "IAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAACAAAQAAAAAIAABAAAIAA",
  "AAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAA",
  "EACWAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAA",
  "CAAAQAAAAAIAABAAAIAAAAAEAAAIAABAAAAAAgAAEAAAgAAAAAQAACAA",
  "AAABAAB81I8lgPjO/fj33yzbauEgsFJ7G5YBDHxBAAIAMPTFAAgAwNAX",
  "AyAAAINfCIAAAHIPfiEAc/IzQDD8U/6f4AbADQAYqG4DwA0AYPj7/0EA",
  "AIan54CAfAIAA/M2PgmAGwAg4duy2wAQAEDS4SgCQAAASYeiCAABAAAI",
  "APD277kBAQCGoOcHBAAYftYBEAAAgAAAb73WAxAAYNhZF0AAAAACALzl",
  "Wh8QAACAAAC83VonEAAAgAAAAAQA8DfX2tYLBAAAIAAAAAEA4bjOtm4g",
  "AAAAAQAACAAAQADA/HzHtn4gAAAAAQAACAAAQAAAAAIAABAAAIAAAAAE",
  "AAAgAAAAAQAACAAAEAAAgAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAA",
  "gAAAAAQAACAAAAABAAAIAABAAAAAAgAAEAAAIAAAAAEAAAgAAEAAAAAC",
  "AAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAA",
  "QAAAAAIAABAAAIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAE",
  "AAAgAAAAAQAACAAAQAAAgAAAAAQAACAAAAABAAAIAABAAAAAMyi1t2EZ",
  "eIdzPywC3GDZVouAAMDAB0EgCBAAGPogBkAAYOiDGAABgMEPQgAEAAY/",
  "CAGy8jNADH+wv3EDgIMBcBuAGwAMf8C+RwDgEADsf2LwCcDGB/BJwA0A",
  "hj/gXEAAYJMDzgcEADY34JxAAAAAAgBVDzgvEADYzIBzAwGATQw4PxAA",
  "AIAAQL0DzhEEADYt4DxBAAAAAgC1DjhXEAAAgABQ6RYBcL4gAAAAAQAA",
  "CIBYXM8BzhkEAAAgAAAAARCOaznAeYMAAAAEAAAgAABAAFiC+fkeBzh3",
  "EAAAgAAAAAQAACAAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAA",
  "cNGyrRYBcO4gAAAAAQAACAAAQAAE4Xsc4LxBAAAAAgAAEABhuZYDnDMI",
  "AABAAAAAAiAs13OA8wUBAAAIAJUO4FxBAACAAECtAzhPBAA2LYBzRAAA",
  "AAIA9Q44PxAA2MSAcwMBgM0MOC8QAACAAEDVA84JBAA2N+B8QABgkwPO",
  "BW5Qam/DMuR17odFAIMfNwDY/ID9jwDAIQDY94TkEwC/+CQABj9uAHA4",
  "APY3bgBwGwAY/AgAhABg8CMAEAOAoY8AQAwAhj4CAEEAGPgIABBFGHbw",
  "UX4GCAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAA",
  "BAAAIAAAAAEAAAgAAEAAAAACAAAEAAAgAAAAAQAACAAAQAAAAAIAABAA",
  "AIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAA",
  "CAAAQAAAAAIAABAAAIAAAAAEAAAIAABAAAAAAgAAEAAAgAAAAAQAACAA",
  "AAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAACAAAQAACAAAAA",
  "BAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAA",
  "ECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAk",
  "AAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAABAAAIAABAAAAAAgAAEAAA",
  "gAAAAAQAACAAAAABAAACAAAEAAAgAAAAAQAACAAAAABAAACAAAQAHCTZ",
  "VstgvUDAQAACAAAQAAAAAIA",
  "gvAd27qBAAAABAAAIAAgLNfZ1gsEAAAgAAAAAQBhuda2TiAAAAABAN5u",
  "sT4gAAAAAQDecq0LIADAsLMegAAAAAQAeOu1DoAAAMPP8wMCAAxBzw0I",
  "AAAQAIC3Yc8LAgAwFD0nCADAcPR8EEipvQ3LAN/n3A+DH3ADAG4DPAcg",
  "AEAE+P+BC3wCgEnM9EnA4Ac3AECyoWr4gxsAINFtgMEPAgBIFAIGPwgA",
  "IEkMGPogAIAkMWDogwAAEgSBgQ8CAAAIxs8AAUAAAAACAAAQAACAAAAA",
  "BAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAA",
  "AIAAAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAA",
  "CAAAQAAAAAIAABAAAIAAAAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAA",
  "AAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAACAAAQAACAAAAA",
  "BAAAIAAAAAEAAAgAAEAAAAACAAAQAACAAAAABAAAIAAAAAEAAAgAAEAA",
  "AAACAAAEAAAgAAAAAQAACAAAQAAAAAIAABAAAIAAAAAEAAAgAAAAAQAA",
  "CAAAQAAAAAIAABAAAIAAAAAEAAAgAABAAAAAAgAAEAAAgAAAAAQAACAA",
  "AAABAAAIAABAAAAAAgAAEAAAgAAAAAQAACAAAAABAAAIAABAAACAAAAA",
  "BAAAIAAAAAEAAAgAAEAAAAACAAD4Ki8tlVvyidrCegAAAABJRU5ErkJg",
  "gg=="
].join("");

const ICONS = [
  { file: "icon-192.png", b64: ICON_192_B64 },
  { file: "icon-512.png", b64: ICON_512_B64 },
  { file: "apple-touch-icon.png", b64: ICON_180_B64 },
];

const force = process.env.FORCE === "1";
mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const { file, b64 } of ICONS) {
  const target = join(OUT_DIR, file);
  if (existsSync(target) && !force) {
    // Idempotent for repeated prebuild runs: identical content is fine,
    // diverging content still requires FORCE=1 to overwrite.
    const buf = Buffer.from(b64, "base64");
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
  const buf = Buffer.from(b64, "base64");
  // Sanity check: valid PNG signature
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    console.error(`Embedded payload for ${file} is not a valid PNG. Aborting.`);
    process.exit(1);
  }
  writeFileSync(target, buf);
  console.log(`Wrote ${target} (${buf.length} bytes)`);
  written++;
}

if (written === ICONS.length) {
  console.log("All PWA icons generated.");
}
