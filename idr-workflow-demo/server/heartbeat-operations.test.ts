import { describe, expect, it } from "vitest";
import { summarizeHeartbeatOperations } from "./heartbeat-operations";

describe("heartbeat operations summary", () => {
  it("distinguishes enabled, paused, and missing-next-run schedules", () => {
    expect(summarizeHeartbeatOperations([
      { taskUid: "one", name: "daily", userId: "admin", description: "", cronExpression: "0 0 2 * * *", callbackPath: "/api/scheduled/a", callbackMethod: "POST", callbackPayload: "{}", isEnable: true, nextExecutionAt: "2026-08-20T02:00:00Z" },
      { taskUid: "two", name: "paused", userId: "admin", description: "", cronExpression: "0 0 3 * * *", callbackPath: "/api/scheduled/b", callbackMethod: "POST", callbackPayload: "{}", isEnable: false },
      { taskUid: "three", name: "missing", userId: "admin", description: "", cronExpression: "0 0 4 * * *", callbackPath: "/api/scheduled/c", callbackMethod: "POST", callbackPayload: "{}", isEnable: true },
    ])).toEqual({ total: 3, enabled: 2, paused: 1, overdue: 2 });
  });
});
