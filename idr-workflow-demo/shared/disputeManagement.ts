export type ProviderDisputeSummaryInput = { status?: string | null; paymentDeadline?: Date | string | null };

export function summarizeProviderDisputes(disputes: ProviderDisputeSummaryInput[]) {
  const active = disputes.filter(d => !["closed", "ineligible"].includes(d.status ?? "")).length;
  const pendingPayment = disputes.filter(d => d.status === "payment_pending").length;
  const attention = disputes.filter(d => {
    if (!d.paymentDeadline || ["closed", "ineligible"].includes(d.status ?? "")) return false;
    return new Date(d.paymentDeadline).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;
  }).length;
  return { total: disputes.length, active, pendingPayment, attention };
}
