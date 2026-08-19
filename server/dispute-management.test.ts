import { describe, expect, it } from "vitest";
import { summarizeProviderDisputes } from "../shared/disputeManagement";

describe("provider dispute management summary", () => {
  it("separates active, payment, and deadline-attention disputes from persisted status values", () => {
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(summarizeProviderDisputes([
      { status: "open_negotiation", paymentDeadline: soon },
      { status: "payment_pending", paymentDeadline: soon },
      { status: "closed", paymentDeadline: soon },
    ])).toEqual({ total: 3, active: 2, pendingPayment: 1, attention: 2 });
  });
});
