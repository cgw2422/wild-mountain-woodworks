import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { StorageDriver } from "./types";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string; // e.g. https://media.wildmountainwoodworks.com
}

/** Cloudflare R2 via its S3-compatible API. */
export class R2StorageDriver implements StorageDriver {
  readonly name = "r2" as const;
  private client: S3Client;

  constructor(private config: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Keys are content-unique, so objects can be cached forever.
        CacheControl: key.startsWith("media/") ? "public, max-age=31536000, immutable" : "private, no-store",
      }),
    );
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return { body: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream" };
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  publicUrl(key: string) {
    return `${this.config.publicUrl.replace(/\/$/, "")}/${key}`;
  }
}
