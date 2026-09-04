import { randomUUID } from "node:crypto";

export type MockAuditEntry = {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
};

const auditEntries = new Map<string, MockAuditEntry>();

/** This fixture is test-only and must never be used by production modules. */
export function assertTestInfrastructureFallbackEnabled(): void {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_INFRA_FALLBACK_MOCKS !== "true") {
    throw new Error("Test infrastructure fallback is permitted only with NODE_ENV=test and TEST_INFRA_FALLBACK_MOCKS=true");
  }
}

export function persistMockAuditEntry(input: Omit<MockAuditEntry, "id" | "createdAt">): MockAuditEntry {
  assertTestInfrastructureFallbackEnabled();
  const entry: MockAuditEntry = { ...input, id: randomUUID(), createdAt: new Date() };
  auditEntries.set(entry.id, entry);
  return entry;
}

export function listMockAuditEntries(entityType?: string): MockAuditEntry[] {
  assertTestInfrastructureFallbackEnabled();
  return Array.from(auditEntries.values()).filter(entry => !entityType || entry.entityType === entityType);
}

export function clearMockAuditEntry(id: string): void {
  assertTestInfrastructureFallbackEnabled();
  auditEntries.delete(id);
}
