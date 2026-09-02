import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const validator = resolve(repositoryRoot, "scripts/validate-tigerbeetle-gitops-deployment-contract.mjs");
const unsafeFixture = resolve(repositoryRoot, "test-fixtures/tigerbeetle-gitops-contract/automated-sync-prune-enabled.application.yaml");

test("rejects an Argo CD Application with automated sync and pruning enabled", () => {
  let error;
  try {
    execFileSync(process.execPath, [validator, "--argo", unsafeFixture], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, NO_PROXY: "*", HTTP_PROXY: "", HTTPS_PROXY: "" },
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "unsafe Application fixture must fail validation");
  assert.equal(error.status, 2, "unsafe Application fixture must use the validator failure exit code");
  const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  assert.match(output, /TIGERBEETLE_GITOPS_DEPLOYMENT_CONTRACT_INVALID/, "expected contract failure marker");
  assert.match(output, /Argo CD automated sync is prohibited/, "automated sync must be rejected");
  assert.match(output, /Argo CD automated pruning is prohibited/, "automated.prune must be rejected");
  assert.match(output, /Argo CD pruning must not be enabled/, "Prune=true sync option must be rejected");
});
