import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { resolvePostgresDriverUrl, resolvePostgresTlsOptions } from "./db";

const externalUrl = process.env.EXTERNAL_POSTGRES_URL;
const tlsServerName = process.env.EXTERNAL_POSTGRES_TLS_SERVER_NAME;
const describeExternalPostgres = externalUrl && tlsServerName ? describe : describe.skip;

describeExternalPostgres("external PostgreSQL runtime override", () => {
  it("authenticates and performs a non-destructive health query", async () => {
    const sql = postgres(resolvePostgresDriverUrl(externalUrl!), {
      connect_timeout: 10,
      idle_timeout: 1,
      max: 1,
      onnotice: () => {},
      ...resolvePostgresTlsOptions(externalUrl!),
    });

    try {
      const result = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
      expect(result).toEqual([{ ok: 1 }]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 20_000);
});
