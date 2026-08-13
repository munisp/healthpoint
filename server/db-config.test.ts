import { afterEach, describe, expect, it } from "vitest";
import { isPostgresConnectionString, resolvePostgresUrl } from "./db";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("PostgreSQL-only database configuration", () => {
  it("accepts only PostgreSQL URI schemes", () => {
    expect(isPostgresConnectionString("postgresql://user:pass@db.example.com:5432/healthpoint?sslmode=require")).toBe(true);
    expect(isPostgresConnectionString("postgres://user:pass@db.example.com/healthpoint")).toBe(true);
    expect(isPostgresConnectionString("mysql://user:pass@db.example.com/healthpoint")).toBe(false);
    expect(isPostgresConnectionString("http://db.example.com")).toBe(false);
  });

  it("refuses missing or incompatible DATABASE_URL values without a local fallback", () => {
    delete process.env.DATABASE_URL;
    expect(resolvePostgresUrl()).toBeNull();
    process.env.DATABASE_URL = "mysql://managed.example.com/healthpoint";
    expect(resolvePostgresUrl()).toBeNull();
  });
});
