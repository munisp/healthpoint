import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve("infrastructure/tigerbeetle-staging/k8s/alertmanager-tigerbeetle-drill-routing.fragment.yaml.template");
const text = readFileSync(path, "utf8");
const findings = [];
function requireText(value) {
  if (!text.includes(value)) findings.push(`missing required routing contract: ${value}`);
}

for (const required of [
  'environment="staging"',
  'service="tigerbeetle"',
  'severity="critical"',
  'drill_abort="true"',
  "healthpoint-tigerbeetle-drill-pagerduty",
  "healthpoint-tigerbeetle-drill-slack",
  "healthpoint-tigerbeetle-clock-no-go-pagerduty",
  "healthpoint-tigerbeetle-clock-no-go-slack",
  "healthpoint-tigerbeetle-clock-warning-slack",
  'timing_gate="no_go"',
  'timing_gate=~"advisory|warning"',
  "pagerduty_configs:",
  "routing_key_file:",
  "slack_configs:",
  "api_url_file:",
  "group_wait: 0s",
  "repeat_interval: 5m",
  "send_resolved: true",
]) requireText(required);

if (/^\s*routing_key:\s*\S+/m.test(text)) findings.push("PagerDuty routing key must be read from a mounted file, not inline");
if (/^\s*service_key(?:_file)?\s*:/m.test(text)) findings.push("use PagerDuty Events API v2 routing_key_file, not a service key");
if (/^\s*api_url:\s*https?:\/\//m.test(text)) findings.push("Slack webhook URL must be read from a mounted file, not inline");
if (/https?:\/\/(?:hooks\.slack\.com|events\.pagerduty\.com)/i.test(text)) findings.push("integration endpoint must not be embedded in the routing fragment");
if (!/healthpoint-tigerbeetle-drill-pagerduty[\s\S]*?continue:\s*true[\s\S]*?healthpoint-tigerbeetle-drill-slack[\s\S]*?continue:\s*false/.test(text)) {
  findings.push("active-drill abort PagerDuty must fan out first to dedicated Slack, then stop before generic critical routes");
}
if (!/healthpoint-tigerbeetle-clock-no-go-pagerduty[\s\S]*?continue:\s*true[\s\S]*?healthpoint-tigerbeetle-clock-no-go-slack[\s\S]*?continue:\s*false/.test(text)) {
  findings.push("critical clock no-go PagerDuty must fan out first to dedicated Slack, then stop before generic critical routes");
}
if (!/timing_gate=~\"advisory\|warning\"[\s\S]*?receiver:\s*healthpoint-tigerbeetle-clock-warning-slack[\s\S]*?continue:\s*false/.test(text)) {
  findings.push("advisory/warning clock degradation must use the dedicated Slack-only route");
}

if (findings.length) {
  console.error("TIGERBEETLE_DRILL_ALERT_ROUTING_INVALID");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(2);
}
console.log("TIGERBEETLE_DRILL_ALERT_ROUTING_VALID: immediate file-backed PagerDuty-plus-Slack fan-out for critical abort/no-go states and dedicated Slack advisory/warning notification are present");
