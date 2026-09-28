import "dotenv/config";
import path from "node:path";
import os from "node:os";

// Integration tests run against TEST_DATABASE_URL (never the dev database).
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.LOCAL_STORAGE_DIR ??= path.join(os.tmpdir(), "wm-test-storage");
process.env.STORAGE_DRIVER = "local";
delete process.env.EMAIL_PROVIDER;
delete process.env.STRIPE_SECRET_KEY;
