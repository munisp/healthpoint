# Security Audit Evidence — 2026-08-13

## Dependency Scan Snapshot

`pnpm audit --json` on the active main-branch workspace reported **3 critical, 49 high, 53 moderate, and 5 low** Node dependency findings. The scan’s proposed update actions included `tar` to 7.5.22, `@smithy/config-resolver` to 4.7.0, `body-parser` to 1.20.6, `rollup` to 4.62.4, `picomatch` to 4.0.5, `lodash` to 4.18.1, `follow-redirects` to 1.16.0, `form-data` to 4.0.6, and `ip-address` to 10.5.0. Some findings require review because an upgrade path was not automatically supplied.

After the direct dependency upgrades and the explicit patched Lodash workspace override, the final `pnpm audit --json` run reported **0 critical, 0 high, 1 moderate, and 0 low** findings. `pnpm audit:dependencies` now fails the release gate whenever a critical or high finding returns. The remaining moderate finding requires release-time review rather than an undocumented waiver.

## Advisory References Captured from the Scan

- [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — esbuild development-server CORS exposure.
- [GHSA-93m4-6634-74q7](https://github.com/advisories/GHSA-93m4-6634-74q7) — Vite filesystem deny-list bypass on exposed Windows development servers.
- [GHSA-29xp-372q-xqph](https://github.com/advisories/GHSA-29xp-372q-xqph) — node-tar race condition and potential memory exposure.
- [GHSA-43p4-m455-4f4j](https://github.com/advisories/GHSA-43p4-m455-4f4j) — tRPC `formDataToObject` prototype-pollution condition.

The raw machine-readable scan output is retained at `/tmp/healthpoint-pnpm-audit.json` for this sandbox session. Severity counts must be re-run immediately before an actual deployment because advisory databases and dependency locks change over time.
