import fs from "fs";
import https from "https";
import { describe, expect, it } from "vitest";

const endpoint = process.env.PERMIFY_URL;
const token = process.env.PERMIFY_AUTH_TOKEN;
const caPath = process.env.PERMIFY_TLS_CA_PATH;
const livePermifyConfigured = Boolean(
  endpoint?.startsWith("https://") && token && caPath && fs.existsSync(caPath)
);
const describeLivePermify = livePermifyConfigured ? describe : describe.skip;

describeLivePermify("configured Permify endpoint", () => {
  it("accepts the configured bearer token over CA-verified TLS", async () => {
    const ca = fs.readFileSync(caPath!, "utf8");
    const body = await new Promise<string>((resolve, reject) => {
      const request = https.request(new URL("/healthz", endpoint!), {
        ca,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
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
