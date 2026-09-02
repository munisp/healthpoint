import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`TIGERBEETLE_LOCAL_ALERT_ROUTING_INVALID: ${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const captureIndex = args.indexOf("--capture");
if (captureIndex === -1 || !args[captureIndex + 1] || args.length !== 2) {
  fail("usage: node scripts/analyze-tigerbeetle-local-alertmanager-routing.mjs --capture <loopback-capture.jsonl>");
}

const capturePath = resolve(args[captureIndex + 1]);
let lines;
try {
  lines = readFileSync(capturePath, "utf8").split(/\r?\n/).filter(Boolean);
} catch {
  fail("capture log is not readable");
}

const expected = {
  "/pagerduty-abort": 5,
  "/slack-abort": 5,
  "/pagerduty-no-go": 1,
  "/slack-no-go": 1,
  "/slack-warning": 1,
  "/discard": 0,
};
const received = Object.fromEntries(Object.keys(expected).map(path => [path, 0]));

for (const [index, line] of lines.entries()) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    fail(`capture record ${index + 1} is not valid JSON`);
  }
  if (!record || typeof record !== "object" || typeof record.path !== "string") {
    fail(`capture record ${index + 1} has no valid receiver path`);
  }
  if (!(record.path in received)) {
    fail(`capture record ${index + 1} used an unexpected receiver path`);
  }
  if (typeof record.body !== "string" || record.body.length === 0) {
    fail(`capture record ${index + 1} has no notification body`);
  }
  received[record.path] += 1;
}

for (const [path, expectedCount] of Object.entries(expected)) {
  if (received[path] !== expectedCount) {
    fail(`receiver ${path} expected ${expectedCount} notifications, received ${received[path]}`);
  }
}

const total = Object.values(received).reduce((sum, count) => sum + count, 0);
console.log("TIGERBEETLE_LOCAL_ALERT_ROUTING_VALID: loopback capture confirms 5 abort PagerDuty + 5 abort Slack + 1 no-go PagerDuty + 1 no-go Slack + 1 advisory Slack; zero advisory PagerDuty/discard/unknown routes.");
console.log(`TIGERBEETLE_LOCAL_ALERT_ROUTING_COUNT: ${total}`);
