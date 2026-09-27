export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * Object storage abstraction. Image binaries are never stored in PostgreSQL.
 * Production uses Cloudflare R2 (S3-compatible); development can use local
 * disk. Keys are namespaced:
 *   media/…    public site imagery (served via public URL / CDN)
 *   private/…  customer-uploaded reference images (served only to admins)
 */
export interface StorageDriver {
  readonly name: "local" | "r2";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Public URL for a `media/` key. */
  publicUrl(key: string): string;
}
