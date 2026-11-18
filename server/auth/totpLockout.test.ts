/**
 * server/auth/totpLockout.test.ts
 *
 * Phase 24 (F2): per-user TOTP attempt lockout (mirrors the email-OTP
 * 5-attempt cap). Uses the module's IncrementFn test seam (the repo
 * convention from ratelimit.ts) — no live Redis required.
 */
import { describe, expect, it, vi } from "vitest";
import {
  checkTotpLoginAttempt,
  resetTotpLoginAttempts,
  TOTP_MAX_ATTEMPTS,
  TOTP_LOCKOUT_WINDOW_SECONDS,
  type TotpIncrementFn,
} from "./totpLockout";

function memoryIncrementer(): { increment: TotpIncrementFn; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    increment: async (key, _window) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}

const unavailable: TotpIncrementFn = async () => null;

/** Simulate one verifyLoginTotp attempt: gate first, then (if allowed) the code check. */
async function attempt(increment: TotpIncrementFn, userId: string, codeOk: boolean): Promise<"ok" | "invalid" | "locked"> {
  const gate = await checkTotpLoginAttempt(userId, increment);
  if (gate === "locked") return "locked";
  return codeOk ? "ok" : "invalid";
}

describe("TOTP login attempt lockout", () => {
  it("4 failures then a success still works", async () => {
    const { increment } = memoryIncrementer();
    for (let i = 0; i < 4; i++) {
      expect(await attempt(increment, "u1", false)).toBe("invalid");
    }
    expect(await attempt(increment, "u1", true)).toBe("ok");
  });

  it("the 5th failure locks the account (6th attempt is refused)", async () => {
    const { increment } = memoryIncrementer();
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      expect(await attempt(increment, "u1", false)).toBe("invalid");
    }
    expect(await attempt(increment, "u1", false)).toBe("locked");
  });

  it("a locked attempt is refused even with the CORRECT code (no verification happens)", async () => {
    const { increment } = memoryIncrementer();
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await attempt(increment, "u1", false);
    }
    // Gate must say locked BEFORE any code comparison — the correct code
    // must not be accepted while locked.
    expect(await attempt(increment, "u1", true)).toBe("locked");
  });

  it("tracks attempts per user, not globally", async () => {
    const { increment } = memoryIncrementer();
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) await attempt(increment, "u1", false);
    expect(await checkTotpLoginAttempt("u1", increment)).toBe("locked");
    expect(await checkTotpLoginAttempt("u2", increment)).toBe("ok");
  });

  it("uses a 15-minute window", async () => {
    const windows: number[] = [];
    const spy: TotpIncrementFn = async (key, windowSeconds) => { windows.push(windowSeconds); return 1; };
    await checkTotpLoginAttempt("u1", spy);
    expect(windows).toEqual([TOTP_LOCKOUT_WINDOW_SECONDS]);
    expect(TOTP_LOCKOUT_WINDOW_SECONDS).toBe(15 * 60);
  });

  it("fails CLOSED in production when the backend is unavailable", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(await checkTotpLoginAttempt("u1", unavailable)).toBe("locked");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("fails open with a warning outside production (graceful degradation)", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await checkTotpLoginAttempt("u1", unavailable)).toBe("ok");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      process.env.NODE_ENV = prev;
    }
  });

  it("resetTotpLoginAttempts is a safe no-op without Redis (dev/test)", async () => {
    await expect(resetTotpLoginAttempts("u1")).resolves.toBeUndefined();
  });
});
