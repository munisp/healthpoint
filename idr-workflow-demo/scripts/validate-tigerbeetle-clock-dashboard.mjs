import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve("observability/grafana/dashboards/tigerbeetle-clock-synchronization.json");
const dashboard = JSON.parse(readFileSync(path, "utf8"));
const serialized = JSON.stringify(dashboard);
const queryAndVariableContent = JSON.stringify({ templating: dashboard.templating, panels: dashboard.panels });
const findings = [];
const requireCondition = (condition, message) => { if (!condition) findings.push(message); };
const panelById = new Map((dashboard.panels ?? []).map(panel => [panel.id, panel]));
const targets = (panel) => panel?.targets ?? [];
const expressions = (panel) => targets(panel).map(target => target.expr ?? "").join("\n");

requireCondition(dashboard.uid === "healthpoint-tigerbeetle-clock-staging", "dashboard UID must remain stable");
requireCondition(dashboard.timezone === "utc", "dashboard must use UTC for cross-node event correlation");
requireCondition(dashboard.refresh === "15s", "dashboard refresh must match the intended continuous-monitor cadence");
requireCondition(Array.isArray(dashboard.templating?.list) && dashboard.templating.list.some(variable => variable.name === "datasource" && variable.type === "datasource" && variable.query === "prometheus"), "dashboard must have a Prometheus datasource variable");
requireCondition(Array.isArray(dashboard.templating?.list) && dashboard.templating.list.some(variable => variable.name === "timing_role" && variable.allValue === "application|cni|otel_collector|prometheus"), "dashboard must limit timing role values to the four correlation roles");
requireCondition(panelById.size >= 14, "dashboard must include the expected timing and lifecycle panels");
for (const [id, metric] of [
  [1, "healthpoint_tigerbeetle_clock_monitor_status"],
  [2, "healthpoint_tigerbeetle_clock_monitor_clock_error_bound_seconds"],
  [5, "healthpoint:chrony_clock_error_bound_seconds"],
  [7, "healthpoint_tigerbeetle_clock_monitor_last_poll_success_timestamp_seconds"],
  [8, "healthpoint_tigerbeetle_clock_monitor_failures_total"],
  [9, "ALERTS"],
  [10, "node_timex_sync_status"],
  [11, "ALERTS"],
  [12, "healthpoint_tigerbeetle_read_client_active"],
  [13, "healthpoint_tigerbeetle_tunnel_active"],
  [14, "healthpoint_tigerbeetle_read_probe_total"],
]) requireCondition(expressions(panelById.get(id)).includes(metric), `panel ${id} must query ${metric}`);
requireCondition(serialized.includes("0.025") && serialized.includes("0.05") && serialized.includes("0.25"), "dashboard must show the 25 ms advisory, 50 ms pre-check, and 250 ms abort thresholds");
requireCondition(!/tenant|patient|dispute|account|transfer|certificate|authorization|token/i.test(queryAndVariableContent), "dashboard queries and variables must not contain regulated, financial, credential, or tenant fields");
requireCondition(!/connection[ _-]*pool(?!\))/i.test(queryAndVariableContent), "dashboard must not misrepresent explicit client lifecycle telemetry as a connection pool");

if (findings.length) {
  console.error("TIGERBEETLE_CLOCK_DASHBOARD_INVALID");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(2);
}
console.log("TIGERBEETLE_CLOCK_DASHBOARD_VALID: importable UTC Prometheus dashboard with clock error, target coverage, monitor health, kernel/Chrony status, and timing alert panels");
