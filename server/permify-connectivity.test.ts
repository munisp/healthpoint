import fs from "fs";
import https from "https";
import { describe, expect, it } from "vitest";

describe("configured Permify endpoint", () => {
  it("accepts the configured bearer token over CA-verified TLS", async () => {
    const ca = fs.readFileSync("infra/certs/permify-ca.crt", "utf8");
    const token = process.env.PERMIFY_AUTH_TOKEN;
    expect(token).toBeTruthy();
    const body = await new Promise<string>((resolve, reject) => {
      const request = https.request("https://173.66.76.192:32049/healthz", {
        ca,
        headers: { Authorization: `Bearer ${token}` },
      }, response => {
        let data = "";
        response.on("data", chunk => { data += chunk; });
        response.on("end", () => response.statusCode === 200 ? resolve(data) : reject(new Error(`HTTP ${response.statusCode}`)));
      });
      request.on("error", reject);
      request.end();
    });
    expect(body).toContain("SERVING");
  }, 10_000);
});
