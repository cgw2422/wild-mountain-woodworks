import { LocalStorageDriver } from "./local";
import { R2StorageDriver } from "./r2";
import type { StorageDriver } from "./types";

/**
 * STORAGE_DRIVER=r2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_URL. Otherwise local disk.
 * (No "server-only" import so CLI scripts like the seed can use it.)
 */
export function createStorageFromEnv(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const kind = env.STORAGE_DRIVER ?? (env.R2_BUCKET ? "r2" : "local");
  if (kind === "r2") {
    const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"] as const;
    const missing = required.filter((k) => !env[k]);
    if (missing.length) throw new Error(`R2 storage is missing configuration: ${missing.join(", ")}`);
    return new R2StorageDriver({
      accountId: env.R2_ACCOUNT_ID!,
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      bucket: env.R2_BUCKET!,
      publicUrl: env.R2_PUBLIC_URL!,
    });
  }
  return new LocalStorageDriver(env.LOCAL_STORAGE_DIR || undefined);
}
