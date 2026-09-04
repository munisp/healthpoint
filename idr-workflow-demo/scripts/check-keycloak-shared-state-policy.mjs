#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sourcePath = resolve(process.cwd(), "server/_core/keycloak.ts");
const outputPath = resolve(process.env.KEYCLOAK_SHARED_STATE_POLICY_OUTPUT || "artifacts/keycloak-shared-state-policy.json");
const source = readFileSync(sourcePath, "utf8");
const violations = [];

const prohibited = [
  { name: "process-memory PKCE store", pattern: /(?:const|let|var)\s+\w*(?:pkce|state)\w*\s*=\s*new\s+Map\s*\(/i },
  { name: "PKCE in-memory fallback", pattern: /pkce\w*[\s\S]{0,500}(?:in-memory|_mem\w*\.get|_mem\w*\.set)/i },
  { name: "revocation fail-open catch", pattern: /isTokenRevoked\([\s\S]{0,200}\.catch\(\s*\(?.*?\)?\s*=>\s*false\s*\)/i },
];
for (const check of prohibited) {
  if (check.pattern.test(source)) violations.push(check.name);
}

const required = [
  { name: "shared Redis PKCE write", pattern: /await\s+cacheSet\(`pkce:\$\{state\}`/ },
  { name: "shared Redis PKCE read", pattern: /await\s+cacheGet<\{\s*codeVerifier/ },
  { name: "shared Redis PKCE delete", pattern: /await\s+cacheDel\(`pkce:\$\{state\}`/ },
  { name: "non-suppressed revocation check", pattern: /const\s+revoked\s*=\s+await\s+isTokenRevoked\(jti\);/ },
];
for (const check of required) {
  if (!check.pattern.test(source)) violations.push(`missing ${check.name}`);
}

const report = { valid: violations.length === 0, source: sourcePath, violations };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report));
process.exit(report.valid ? 0 : 1);
