import { execSync } from "node:child_process";
import "dotenv/config";

/** Apply migrations to the test database once before the suite. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("[tests] TEST_DATABASE_URL not set — integration tests will be skipped.");
    return;
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
