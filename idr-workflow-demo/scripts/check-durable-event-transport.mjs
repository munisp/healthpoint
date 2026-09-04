#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sourcePath = resolve(process.cwd(), "server/events/bus.ts");
const outputPath = resolve(process.env.DURABLE_EVENT_TRANSPORT_POLICY_OUTPUT || "artifacts/durable-event-transport-policy.json");
const source = readFileSync(sourcePath, "utf8");
const violations = [];
const required = [];

for (const [name, pattern] of [
  ["EventEmitter import", /from\s+["']events["']/],
  ["EventEmitter inheritance", /extends\s+EventEmitter/],
  ["in-process subscription API", /\beventBus\.(?:on|once)\s*\(/],
  ["synchronous publish delivery", /publish[\s\S]{0,1800}await\s+this\.deliverOutboxEvent/],
  ["automatic Kafka topic creation", /allowAutoTopicCreation\s*:\s*true/],
  ["event persistence no-op", /persistEvent[\s\S]{0,500}if\s*\(!db\)\s*return/],
]) {
  if (pattern.test(source)) violations.push(name);
}
for (const [name, pattern] of [
  ["durable event insert", /db\.insert\(eventLog\)\.values/],
  ["outbox worker delivery method", /deliverOutboxEvent/],
  ["Kafka-unavailable failure", /Kafka producer is unavailable for durable outbox delivery/],
  ["Kafka traceparent injection", /injectTrustedTraceparent\(\)/],
]) {
  if (!pattern.test(source)) required.push(name);
}

const report = { valid: violations.length === 0 && required.length === 0, source: sourcePath, violations, missingRequired: required };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report));
process.exit(report.valid ? 0 : 1);
