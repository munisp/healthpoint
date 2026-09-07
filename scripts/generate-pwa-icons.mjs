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
  "iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAADbUlEQVR4nO3dTVIa",
  "UQBGUaAyNfs0U7OMOI37jAswg5SWUZAGmv7hnjO2hMF3+z1DVdhuZnD3cP8yx+uy",
  "bM+PT9upX3OSFzR4zjFFEFd7AaNnTNeKYdRfavRMYcwYdmP9IuNnKmNu7eKSDJ85",
  "XXoaXHQCGD9zu3SDZ9Vj+CzROafBySeA8bNU52zzpACMn6U7daODAzB+1uKUrQ4K",
  "wPhZm6GbPRqA8bNWQ7b7ZQDGz9od2/BonwTDGh0MwNOfW/HVlvcGYPzcmkObdgUi",
  "7VMAnv7cqn3b3h37AbglHzfuCkSaAEh7C8D1h4r3W3cCkCYA0nabjesPPa+bdwKQ",
  "JgDSBEDa1v2fMicAaQIgTQCkCYA0AZD2be43sEZ/fv2e+y0c9P3nj7nfwqo4AUgT",
  "AGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0A",
  "pAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQ",
  "JgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECa",
  "AEjb3j3cv8z9Jl4t+RvYGddSvtHeCUCaAEgTAGkCIE0ApAmANIEQJoASBMAaQIgT",
  "QCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0A",
  "ZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQ",
  "JoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgzTfFk+YEIE0ApAmANAGQtnt+f",
  "NrO/SZgDs+PT1snAGkCIE0ApO02m393obnfCEzpdfNOANIEQNpbAK5BVLzfuhOAN",
  "AGQ9l8ArkHcuo8b/3QCiIBbtW/brkCk7Q3AKcCtObTpgyeACLgVX23ZFYi0LwNwC",
  "rB2xzZ89AQQAWs1ZLuDrkAiYG2Gbnbw3wAiYC1O2epJfwSLgKU7daMn/yuQCFiqc",
  "7Z50Zj9t4oswSUP5Ys+B3AaMLdLNzjagJ0GTGmsh+9onwQ7DZjKmFu72midCIzpW",
  "g/YSZ7aYuAcU9wqZrm2CIJ95rhG/wV437JE1zvjAAAAAABJRU5ErkJggg=="
].join("");

const ICON_180_B64 = [
  "iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAADKklEQVR4nO3dPXLT",
  "UABGUTtDC/uEFpZBWrJPsgAomGTyYzuWJUvPl3P6WCpuvjzbM9F+t6LP37/+WfN6",
  "jOHx/mG/1rWueiEBc8g1A1/8hUXMFEvHvdiLCZk5lgp79osImSXNDftuzg+LmaXN",
  "beqi3wYhs4ZL1nryQouZtVzS2qSgxczapjZ3dtBiZitT2jsraDGztXMb/DBoMTOK",
  "c1o8GbSYGc1HTR4NWsyM6lSbs75YgdEcDNo6M7pjjb4LWszcikOtOnKQ8ipo68yt",
  "edushSblOWjrzK162a6FJkXQpNztdo4b3L6nhi00KYImRdCk7J2fKbHQpAiaFEGT",
  "ImhSBE3Kp61vYHS/f/7a+hbe+fLj29a3MCwLTYqgSRE0KYImRdCkCJoUQZMiaFIE",
  "TYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0",
  "KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCk",
  "CJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYqgSRE0KYImRdCkCJoUQZMi",
  "aFIETYqgSRE0KYImRdCkCJoUQZMiaFIETYrHupFioUkRNCmCJkXQpNw93j/st74J",
  "WMLj/cPeQpMiaFIETcrdbvfv7LH1jcAcTw1baFIETcpz0I4d3KqX7VpoUl4FbaW5",
  "NW+btdCkvAvaSnMrDrV6cKFFzeiONerIQcrRoK00ozrV5smFFjWj+ajJD48comYU",
  "57R41hla1Gzt3AbPflMoarYypb1Jn3KImrVNbW7yx3aiZi2XtDYrTv91iWuYM5qz",
  "vlix1ixtblOLBWmtmWOpcVx8YYXNFEv/lb/qkUHcHHLNo+qqZ2CB/5/WfK/1F6gV",
  "qiylhzKfAAAAAElFTkSuQmCC"
].join("");

const ICON_512_B64 = [
  "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAALtUlEQVR4nO3dQXbT",
  "2AJF0YT1uzBP6MIwoAvzhAGkGizXN6nExLak96Sz9wgkde7xk508PrCY958/Po2+",
  "BoAj+/Xtx+PoazgKD/JKRh5gTuLgOh7WBcYeYN9Ewes8mDMGH+DYBMH/5R+E0Qdo",
  "qsdA8uaNPgDnijGQumHDD8AlpRA4/I0afQBucfQYOOzNGX4AlnDUEDjcTRl+ANZw",
  "tBA4zM0YfgC2cJQQ2P1NGH4ARth7COz24g0/ADPYawi8G30BtzD+AMxir5u0q2rZ",
  "60MGoGFPpwG7uFDDD8Ce7CEEpn8FYPwB2Js9bNfUAbCHBwgAL5l9w6Y8opj9oQHA",
  "NWZ8JTDdCYDxB+BoZty2qQJgxgcEAEuYbeOmOJKY7aEAwJpmeCUw/ATA+ANQM8P2",
  "DQ2AGR4AAIwwegOHBcDoGweA0UZu4ZAAMP4A8NuoTdw8AIw/APxpxDZuGgDGHwBe",
  "tvVGbhYAxh8ALttyKzcJAOMPAG+z1WauHgDGHwCWsdamDv9fAADA9hYPAJ/+AWBZ",
  "a2zrogFg/AFgHUtv7GIBYPwBYF1Lbq3vAABA0CIB4NM/AGxjqc29OwCMPwBsa4nt",
  "vSsAjD8AjHHvBvsOAAAE3RwAPv0DwFj3bLETAAAIuikAfPoHgDncuslXB4DxB4C5",
  "3LLNXgEAQNBVAeDTPwDM6dqNdgIAAEFvDgCf/gFgbtdstRMAAAh6UwD49A8A+/DW",
  "zXYCAABBfw0An/4BYF/est1OAAAg6GIA+PQPAPv0tw13AgAAQQIAAIJeDQDH/wCw",
  "b5e23AkAAAS9GAA+/QPAMby26U4AACBIAABA0H8CwPE/ABzLS9vuBMAAAgQAAAT9",
  "EQCO/wHgmJ5vvBMAAAgSAAAQJAAAIOjfAPD+HwCO7XzrnQAAQJAAAIAgAQAAQQIA",
  "AILePTz4AiAAVJw23wkAAAQJAAAIEgAAECQAACBIAABAkAAAgKBHPwEEgB4nAAAQ",
  "JAAAIEgAAECQAACBIAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAAB",
  "AkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAA",
  "ECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCB",
  "AAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAI",
  "EgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECA",
  "ACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQ9",
  "Pj+88en0RdR8/Pr99GXwCs+fPk0+hJgN5wAAECQAACAIAEAAEECAACCBAAABAkAA",
  "AgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIEgAAECQA",
  "ACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJA",
  "AAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAE",
  "ECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAA",
  "AQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIA",
  "EAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCHt9//vg0+i",
  "IAgG05AQCAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAA",
  "CCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJA",
  "AAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAE",
  "ECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAA",
  "AQJAAAIEgAAECQAACAIAEAAEECAACCHt9//vg0+iIAgG05AQCAIAEAAEECAACCBA",
  "AABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIE",
  "gAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAA",
  "CCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJA",
  "AAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAE",
  "ECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAA",
  "AQJAAAIEgAAEDQu1/ffjyOvggAYDu/vv14dAIAAEECAACCBAAABAkAAAgSAAAQJA",
  "AAI+jcAfBEQAI7tfOudAABAkAAAgCABAABBfwSA7wEAwDE933gnAAAQJAAAIOg/A",
  "eA1AAAcy0vb7gQAAIIEAAAEvRgAXgMAwDG8tulOAAAg6NUAcAoAAPt2acudAABAk",
  "AAAgKCLAeA1AADs09823AkAAAT9NQCcAgDAvrxlu50AAEDQmwLAKQAA7MNbN9sJA",
  "AAEvTkAnAIAwNyu2WonAAAQdFUAOAUAgDldu9FOAAAg6OoAcAoAAHO5ZZtvOgEQA",
  "QAwh1s32SsAAAi6OQCcAgDAWPdssRMAAAi6KwCcAgDAGPdu8N0nACIAALa1xPYu8",
  "gpABADANpbaXN8BAICgxQLAKQAArGvJrV30BEAEAMA6lt7YxV8BiAAAWNYa2+o7A",
  "AAQtEoAOAUAgGWstamrnQCIAAC4z5pbuuorABEAALdZe0NX/w6ACACA62yxnZt8C",
  "VAEAMDbbLWZm/0KQAQAwGVbbuWmPwMUAQDwsq03cvO/AyACAOBPI7ZxyB8CEgEA8",
  "NuoTRz2lwBFAAB1I7dw6BzROafBySeA8bNU52zzpACMn6U7daODAzB+1uKUrQ4Kw",
  "PhZm6GbPRqA8bNWQ7b7ZQDGz9od2/BonwTDGh0MwNOfW/HVlvcGYPzcmkObdgUi7",
  "VMAnv7cqn3b3h37AbglHzfuCkSaAEh7C8D1h4r3W3cCkCYA0nabjesPPa+bdwKQJ",
  "gDSBEDa1v2fMicAaQIgTQCkCYA0AZD2be43sEZ/fv2e+y0c9P3nj7nfwqo4AUgTA",
  "GkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0Ap",
  "AmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJ",
  "gDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaA",
  "Ejb3j3cv8z9Jl4t+RvYGddSvtHeCUCaAEgTAGkCIE0ApAmANIEQJoASBMAaQIgTQ",
  "CkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZ",
  "AmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgTQCkCYA0AZAmANIEQJ",
  "oASBMAaQIgTQCkCYA0AZAmANIEQJoASBMAaQIgzTfFk+YEIE0ApAmANAGQtnt+fN",
  "rO/SZgDs+PT1snAGkCIE0ApO02m393obnfCEzpdfNOANIEQNpbAK5BVLzfuhOANA",
  "GQ9l8ArkHcuo8b/3QCiIBbtW/brkCk7Q3AKcCtObTpgyeACLgVX23ZFYi0LwNwCr",
  "B2xzZ89AQQAWs1ZLuDrkAiYG2Gbnbw3wAiYC1O2epJfwSLgKU7daMn/yuQCFiqc7",
  "Z50Zj9t4oswSUP5Ys+B3AaMLdLNzjagJ0GTGmsh+9onwQ7DZjKmFu72midCIzpWg",
  "/YSZ7aYuAcU9wqZrm2CIJ95rhG/wV437JE1zvjAAAAAABJRU5ErkJggg=="
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
