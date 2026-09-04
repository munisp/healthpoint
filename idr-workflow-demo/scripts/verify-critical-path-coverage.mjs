import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const criticalPaths = [
  {
    name: "Keycloak identity and dispute authorization",
    runtime: ["server/_core/keycloak.ts", "server/authz.ts"],
    tests: ["server/document-router-authorization.test.ts", "server/_core/production-gates.test.ts"],
  },
  {
    name: "IDR workflow transition guards",
    runtime: ["server/workflow/idr-workflow.ts"],
    tests: ["server/workflow/idr-workflow-guards.test.ts"],
  },
  {
    name: "Manual CMS handoff",
    runtime: ["server/services/cms-adapter.ts", "server/services/cms-outbox.ts"],
    tests: ["server/services/cms-manual-handoff.test.ts", "server/cms-manual-handoff-router.test.ts"],
  },
  {
    name: "PostgreSQL ledger exact-money controls",
    runtime: ["server/ledger.ts"],
    tests: ["server/ledger-bigint-precision.test.ts", "server/routers.test.ts"],
  },
  {
    name: "Settlement approval and reconciliation lifecycle",
    runtime: ["server/settlement-lifecycle.ts", "server/settlement-auth.ts", "server/settlement-proof.ts"],
    tests: ["server/settlement-lifecycle.test.ts", "server/settlement-auth.test.ts", "server/settlement-proof.test.ts"],
  },
  {
    name: "TigerBeetle finality controls",
    runtime: ["server/tigerbeetle-finality.ts", "server/tigerbeetle.ts"],
    tests: ["server/tigerbeetle-finality.test.ts", "server/tigerbeetle.test.ts"],
  },
  {
    name: "Durable event transport",
    runtime: ["server/outbox.ts", "server/events/bus.ts", "server/dapr-inbox.ts"],
    tests: ["server/dapr-inbox.integration.test.ts", "server/events/kafka-consumer-traceparent.test.ts"],
  },
  {
    name: "Temporal no-network drill and durable audit evidence",
    runtime: ["server/temporal.ts"],
    tests: ["server/temporal-operations.test.ts", "server/temporal.test.ts"],
  },
];

async function fileExists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function hasExecutableTestBody(relativePath) {
  try {
    const source = await readFile(path.join(root, relativePath), "utf8");
    return /\b(?:it|test)\s*\(/.test(source);
  } catch {
    return false;
  }
}

const findings = [];
for (const criticalPath of criticalPaths) {
  for (const runtimePath of criticalPath.runtime) {
    if (!(await fileExists(runtimePath))) {
      findings.push({ criticalPath: criticalPath.name, kind: "missing_runtime", path: runtimePath });
    }
  }
  for (const testPath of criticalPath.tests) {
    if (!(await fileExists(testPath))) {
      findings.push({ criticalPath: criticalPath.name, kind: "missing_test", path: testPath });
    } else if (!(await hasExecutableTestBody(testPath))) {
      findings.push({ criticalPath: criticalPath.name, kind: "non_executable_test", path: testPath });
    }
  }
}

const report = {
  valid: findings.length === 0,
  policy: "Each hardened critical runtime path must retain named executable tests; integration tests may require separately provisioned infrastructure but cannot be silently replaced by mocks.",
  criticalPathCount: criticalPaths.length,
  findings,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.valid ? 0 : 2);
