import { describe, expect, it } from "vitest";
import { validateOrganizationDetails } from "../shared/onboardingValidation";

describe("onboarding organization validation", () => {
  it("requires a meaningful organization name before persistence", () => {
    expect(validateOrganizationDetails("")).toBe("Organization name is required.");
    expect(validateOrganizationDetails("A")).toBe("Organization name must contain at least 2 characters.");
    expect(validateOrganizationDetails("Provider Group")).toBeNull();
  });
});
