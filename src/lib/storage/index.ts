import "server-only";
import { createStorageFromEnv } from "./factory";
import type { StorageDriver } from "./types";

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  driver ??= createStorageFromEnv();
  return driver;
}

export type { StorageDriver } from "./types";
