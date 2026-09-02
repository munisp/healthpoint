import { afterEach, describe, expect, it } from "vitest";
import { isPostgresConnectionString, resolvePostgresDriverUrl, resolvePostgresTlsOptions, resolvePostgresUrl } from "./db";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalExternalPostgresUrl = process.env.EXTERNAL_POSTGRES_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalExternalPostgresUrl === undefined) delete process.env.EXTERNAL_POSTGRES_URL;
  else process.env.EXTERNAL_POSTGRES_URL = originalExternalPostgresUrl;
});

describe("PostgreSQL-only database configuration", () => {
  it("accepts only PostgreSQL URI schemes", () => {
    expect(isPostgresConnectionString("postgresql://user:pass@db.example.com:5432/healthpoint?sslmode=require")).toBe(true);
    expect(isPostgresConnectionString("postgres://user:pass@db.example.com/healthpoint")).toBe(true);
    expect(isPostgresConnectionString("mysql://user:pass@db.example.com/healthpoint")).toBe(false);
    expect(isPostgresConnectionString("http://db.example.com")).toBe(false);
  });

  it("refuses missing or incompatible DATABASE_URL values without a local fallback", () => {
    delete process.env.EXTERNAL_POSTGRES_URL;
    delete process.env.DATABASE_URL;
    expect(resolvePostgresUrl()).toBeNull();
    process.env.DATABASE_URL = "mysql://managed.example.com/healthpoint";
    expect(resolvePostgresUrl()).toBeNull();
  });

  it("uses a strict external PostgreSQL override when a platform binding is incompatible", () => {
    process.env.DATABASE_URL = "mysql://platform-managed.example.com/app";
    process.env.EXTERNAL_POSTGRES_URL = "postgresql://healthpoint:secret@postgres.example.com:5432/healthpoint?sslmode=verify-ca";
    expect(resolvePostgresUrl()).toBe(process.env.EXTERNAL_POSTGRES_URL);
  });

  it("rejects an incompatible external override instead of silently using another binding", () => {
    process.env.DATABASE_URL = "postgresql://healthpoint:secret@postgres.example.com:5432/healthpoint";
    process.env.EXTERNAL_POSTGRES_URL = "https://not-a-postgres-endpoint.example.com";
    expect(resolvePostgresUrl()).toBeNull();
  });

  it("requires strict CA parameters when using an external override", () => {
    process.env.EXTERNAL_POSTGRES_URL = "postgresql://healthpoint:secret@postgres.example.com:5432/healthpoint?sslmode=require";
    expect(() => resolvePostgresTlsOptions(process.env.EXTERNAL_POSTGRES_URL!)).toThrow("sslmode=verify-ca");
  });

  it("does not forward libpq-only TLS parameters to the postgres-js driver", () => {
    process.env.EXTERNAL_POSTGRES_URL = "postgresql://healthpoint:secret@postgres.example.com:5432/healthpoint?sslmode=verify-ca&sslrootcert=/app/ca.crt";
    const driverUrl = resolvePostgresDriverUrl(process.env.EXTERNAL_POSTGRES_URL);
    expect(driverUrl).not.toContain("sslmode");
    expect(driverUrl).not.toContain("sslrootcert");
  });
});
