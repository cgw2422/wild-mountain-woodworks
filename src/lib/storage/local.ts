import { promises as fs } from "node:fs";
import path from "node:path";
import type { StorageDriver } from "./types";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

/**
 * Stores files on local disk (default ./storage). Suitable for development.
 * On Railway, local disk is ephemeral unless a Volume is mounted — use R2 in
 * production.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;
  private root: string;

  constructor(root = process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), "storage")) {
    this.root = path.resolve(root);
  }

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }

  async get(key: string) {
    try {
      const full = this.resolve(key);
      const body = await fs.readFile(full);
      return { body, contentType: CONTENT_TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }

  publicUrl(key: string) {
    return `/media-files/${key.replace(/^media\//, "")}`;
  }
}
