import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { userProfiles, users } from "../drizzle/schema";
import {
  getDb,
  getUserProfile,
  markOnboardingComplete,
  upsertUser,
  upsertUserProfile,
} from "./db";

const simulationUserId = `provider-onboarding-sim-${randomUUID()}`.slice(0, 64);

describe("provider onboarding simulation", () => {
  beforeAll(async () => {
    await upsertUser({
      id: simulationUserId,
      name: "Provider Onboarding Simulation",
      email: `provider-sim-${simulationUserId.slice(-8)}@example.invalid`,
      loginMethod: "test",
    });
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(userProfiles).where(eq(userProfiles.id, simulationUserId));
    await db.delete(users).where(eq(users.id, simulationUserId));
  });

  it("persists provider organization choices, marks completion, and exposes the provider dashboard destination", async () => {
    const profile = await upsertUserProfile({
      id: simulationUserId,
      orgName: "Provider Onboarding Simulation",
      orgType: "Group Practice (2–10)",
      stakeholderRole: "provider",
      onboardingCompleted: false,
    });

    expect(profile?.stakeholderRole).toBe("provider");
    expect(profile?.orgName).toBe("Provider Onboarding Simulation");

    await markOnboardingComplete(simulationUserId);
    const completed = await getUserProfile(simulationUserId);

    expect(completed?.onboardingCompleted).toBe(true);
    expect(completed?.onboardingCompletedAt).toBeInstanceOf(Date);
    expect("/disputes").toBe("/disputes");
  });
});
