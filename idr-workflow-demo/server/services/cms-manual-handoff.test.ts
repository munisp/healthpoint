import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("CMS manual handoff persistence boundary", () => {
  it("contains no process-local submission or feedback store in active adapter code", () => {
    const source = readFileSync(resolve(process.cwd(), "server/services/cms-adapter.ts"), "utf8");
    expect(source).not.toMatch(/class\s+InMemoryCmsSubmissionStore/);
    expect(source).not.toMatch(/new\s+Map<\s*string\s*,\s*CmsSubmissionRecord/);
    expect(source).not.toMatch(/new\s+Set<\s*string\s*>/);
  });

  it("wires the PostgreSQL handoff store at the production router boundary", () => {
    const source = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf8");
    expect(source).toContain("PostgresCmsSubmissionStore");
    expect(source).toMatch(/new ManualCmsHandoffAdapter\(\s*new PostgresCmsSubmissionStore\(\)\s*\)/);
  });
});
