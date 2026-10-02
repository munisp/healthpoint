/**
 * server/permify-write.test.ts
 * Tuple payload shape + fail-open behavior of the mirror-only Permify write
 * path. No database or Permify instance required: fetch is stubbed, and the
 * failure-audit path tolerates getDb() returning null (no DATABASE_URL in the
 * test environment).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRelationshipWritePayload,
  isPermifyWriteEnabled,
  mirrorDisputeCreation,
  mirrorOrgMembership,
  writePermifyTuples,
  type PermifyTuple,
} from "./permify-write";

const ownerTuple: PermifyTuple = {
  entity: { type: "dispute", id: "d-123" },
  relation: "owner",
  subject: { type: "user", id: "u-1" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PERMIFY_WRITE_ENABLED;
  delete process.env.PERMIFY_URL;
  delete process.env.PERMIFY_TENANT;
});

describe("buildRelationshipWritePayload", () => {
  it("matches the Permify Write API shape used by server/authz.ts", () => {
    const payload = buildRelationshipWritePayload([ownerTuple]);
    expect(payload).toEqual({
      metadata: { schema_version: "" },
      tuples: [
        {
          entity: { type: "dispute", id: "d-123" },
          relation: "owner",
          subject: { type: "user", id: "u-1" },
        },
      ],
    });
  });
});

describe("isPermifyWriteEnabled", () => {
  it("defaults to false", () => {
    expect(isPermifyWriteEnabled()).toBe(false);
  });
  it("is true only for the literal string 'true'", () => {
    process.env.PERMIFY_WRITE_ENABLED = "true";
    expect(isPermifyWriteEnabled()).toBe(true);
    process.env.PERMIFY_WRITE_ENABLED = "1";
    expect(isPermifyWriteEnabled()).toBe(false);
  });
});

describe("writePermifyTuples", () => {
  it("is a no-op returning 'disabled' when the flag is off (fetch never called)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await writePermifyTuples("dispute:d-123", [ownerTuple]);
    expect(result).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the tuple payload to the Permify write endpoint when enabled", async () => {
    process.env.PERMIFY_WRITE_ENABLED = "true";
    process.env.PERMIFY_URL = "http://permify:3476/";
    process.env.PERMIFY_TENANT = "t1";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await writePermifyTuples("dispute:d-123", [ownerTuple]);
    expect(result).toBe("written");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://permify:3476/v1/tenants/t1/relationships/write");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(buildRelationshipWritePayload([ownerTuple]));
  });

  it("fails open (returns 'failed', does not throw) when Permify rejects", async () => {
    process.env.PERMIFY_WRITE_ENABLED = "true";
    process.env.PERMIFY_URL = "http://permify:3476";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
    await expect(writePermifyTuples("dispute:d-123", [ownerTuple])).resolves.toBe("failed");
  });

  it("fails open when fetch throws (network down)", async () => {
    process.env.PERMIFY_WRITE_ENABLED = "true";
    process.env.PERMIFY_URL = "http://permify:3476";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(writePermifyTuples("dispute:d-123", [ownerTuple])).resolves.toBe("failed");
  });

  it("fails open when enabled without PERMIFY_URL", async () => {
    process.env.PERMIFY_WRITE_ENABLED = "true";
    await expect(writePermifyTuples("dispute:d-123", [ownerTuple])).resolves.toBe("failed");
  });
});

describe("mirror helpers", () => {
  it("mirrorDisputeCreation writes dispute#owner for the initiator", async () => {
    process.env.PERMIFY_WRITE_ENABLED = "true";
    process.env.PERMIFY_URL = "http://permify:3476";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await mirrorDisputeCreation("d-9", "u-owner");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).tuples).toEqual([
      { entity: { type: "dispute", id: "d-9" }, relation: "owner", subject: { type: "user", id: "u-owner" } },
    ]);
  });

  it("mirrorDisputeCreation adds a second owner tuple when creator differs", async () => {
    process.env.PERMIFY_WRITE_ENABLED = "true";
    process.env.PERMIFY_URL = "http://permify:3476";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await mirrorDisputeCreation("d-9", "u-owner", "u-staff");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).tuples).toHaveLength(2);
  });

  it("mirrorOrgMembership writes organization#member@user", async () => {
    process.env.PERMIFY_WRITE_ENABLED = "true";
    process.env.PERMIFY_URL = "http://permify:3476";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await mirrorOrgMembership("Acme Health", "u-7");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).tuples).toEqual([
      { entity: { type: "organization", id: "Acme Health" }, relation: "member", subject: { type: "user", id: "u-7" } },
    ]);
  });

  it("helpers are no-ops when the flag is off", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(mirrorDisputeCreation("d-1", "u-1")).resolves.toBe("disabled");
    await expect(mirrorOrgMembership("Acme", "u-1")).resolves.toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
