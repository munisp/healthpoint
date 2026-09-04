import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "node:path";

type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function getStorageConfig(): StorageConfig {
  const endpoint = process.env.S3_ENDPOINT?.trim() ?? "";
  const accessKeyId = process.env.S3_ACCESS_KEY?.trim() ?? "";
  const secretAccessKey = process.env.S3_SECRET_KEY?.trim() ?? "";
  const bucket = process.env.S3_BUCKET?.trim() ?? "";
  const region = process.env.S3_REGION?.trim() ?? "us-east-1";
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "S3 storage credentials missing: set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET"
    );
  }
  const parsed = new URL(endpoint);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("S3_ENDPOINT must use HTTPS in production");
  }
  return {
    endpoint: parsed.toString(),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

function normalizeKey(value: string): string {
  const normalized = path.posix.normalize(value.trim().replace(/^\/+/, ""));
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(
      "Storage key must be a non-empty relative path without traversal"
    );
  }
  return normalized;
}

function createClient(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

async function presignedDownloadUrl(
  client: S3Client,
  config: StorageConfig,
  key: string,
  expiresIn: number
): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn }
  );
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const config = getStorageConfig();
  const key = normalizeKey(relKey);
  const client = createClient(config);
  const body = typeof data === "string" ? Buffer.from(data) : data;
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    })
  );
  return { key, url: await presignedDownloadUrl(client, config, key, 300) };
}

/**
 * Reads a stored object only from the configured S3-compatible bucket. This is
 * intended for server-side verification workflows such as an authorized CMS
 * handoff; callers must perform domain authorization before invoking it.
 */
export async function storageReadVerified(
  relKey: string,
  maxBytes = 25 * 1024 * 1024
): Promise<{ key: string; bytes: Buffer; contentType?: string }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) {
    throw new Error("Storage read maximum must be an integer from 1 through 104857600 bytes");
  }
  const config = getStorageConfig();
  const key = normalizeKey(relKey);
  const response = await createClient(config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key })
  );
  if (!response.Body) throw new Error("Stored object has no readable body");
  if (response.ContentLength !== undefined && response.ContentLength > maxBytes) {
    throw new Error("Stored object exceeds the permitted verified-read size");
  }
  const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> };
  const bytes = body.transformToByteArray
    ? Buffer.from(await body.transformToByteArray())
    : Buffer.from(await new Response(response.Body as any).arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error("Stored object exceeds the permitted verified-read size");
  }
  return { key, bytes, contentType: response.ContentType };
}

export async function storageGet(
  relKey: string,
  expiresIn = 300
): Promise<{ key: string; url: string }> {
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 3600) {
    throw new Error(
      "Storage URL expiry must be an integer from 1 through 3600 seconds"
    );
  }
  const config = getStorageConfig();
  const key = normalizeKey(relKey);
  const client = createClient(config);
  return {
    key,
    url: await presignedDownloadUrl(client, config, key, expiresIn),
  };
}
