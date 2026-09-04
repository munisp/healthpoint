import { afterEach, describe, expect, it, vi } from "vitest";

const authorizationMocks = vi.hoisted(() => ({
  assertDisputeAccess: vi.fn(),
}));

vi.mock("./authz", () => authorizationMocks);

import { appRouter } from "./routers";

const user = {
  id: "document-user",
  email: "document-user@example.test",
  role: "provider",
  name: "Document User",
} as any;

function caller() {
  return appRouter.createCaller({ req: {} as any, res: {} as any, user });
}

const denied = () =>
  authorizationMocks.assertDisputeAccess.mockRejectedValue(
    new Error("dispute access denied")
  );

afterEach(() => authorizationMocks.assertDisputeAccess.mockReset());

describe("dispute document routes", () => {
  it("denies document metadata creation before persisting a storage key", async () => {
    denied();
    await expect(
      caller().documents.upload({
        disputeId: "dispute-denied",
        fileName: "supporting.pdf",
        fileType: "application/pdf",
        documentType: "eob",
        fileSize: 1024,
        storageKey: "private/dispute-denied/supporting.pdf",
        storageUrl: "https://object.example.test/private/dispute-denied/supporting.pdf",
      })
    ).rejects.toThrow("dispute access denied");
    expect(authorizationMocks.assertDisputeAccess).toHaveBeenCalledWith(
      user.id,
      user.role,
      "dispute-denied",
      "write"
    );
  });

  it("rejects an unsafe document MIME type and storage key before persistence", async () => {
    authorizationMocks.assertDisputeAccess.mockResolvedValue(undefined);

    await expect(
      caller().documents.upload({
        disputeId: "dispute-allowed",
        fileName: "supporting.exe",
        fileType: "application/x-msdownload",
        documentType: "other",
        fileSize: 1024,
        storageKey: "disputes/dispute-allowed/supporting.exe",
        storageUrl: "https://object.example.test/disputes/dispute-allowed/supporting.exe",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Document MIME type is not allowed for dispute evidence",
    });
  });

  it("denies document metadata and version history reads before querying storage metadata", async () => {
    denied();
    await expect(
      caller().documents.list({ disputeId: "dispute-denied" })
    ).rejects.toThrow("dispute access denied");
    await expect(
      caller().documents.listVersions({
        disputeId: "dispute-denied",
        documentId: "document-denied",
      })
    ).rejects.toThrow("dispute access denied");
    expect(authorizationMocks.assertDisputeAccess).toHaveBeenNthCalledWith(
      1,
      user.id,
      user.role,
      "dispute-denied",
      "read"
    );
    expect(authorizationMocks.assertDisputeAccess).toHaveBeenNthCalledWith(
      2,
      user.id,
      user.role,
      "dispute-denied",
      "read"
    );
  });

  it("denies a document version upload before it can alter version state", async () => {
    denied();
    await expect(
      caller().documents.uploadVersion({
        disputeId: "dispute-denied",
        documentId: "document-denied",
        fileName: "supporting-v2.pdf",
        fileType: "application/pdf",
        fileSize: 2048,
        storageKey: "private/dispute-denied/supporting-v2.pdf",
      })
    ).rejects.toThrow("dispute access denied");
    expect(authorizationMocks.assertDisputeAccess).toHaveBeenCalledWith(
      user.id,
      user.role,
      "dispute-denied",
      "write"
    );
  });
});
