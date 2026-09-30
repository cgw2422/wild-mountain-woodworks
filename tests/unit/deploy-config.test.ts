import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the Railway deployment contract (docs/railway-deployment.md).
 * Losing the pre-deploy command would start new code against an
 * unmigrated database without any loud failure. When the service moves from
 * railway.json (Config as Code, deprecated) to Infrastructure as Code, point
 * these checks at the new configuration instead of deleting them.
 */
const root = process.cwd();
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("Railway deployment contract", () => {
  const config = JSON.parse(read("railway.json"));
  const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;

  it("runs migrations + the production-safe seed as the single pre-deploy command", () => {
    expect(config.deploy.preDeployCommand).toEqual(["npm run deploy:prepare"]);
    expect(scripts["deploy:prepare"]).toBe("sh scripts/predeploy.sh");
    const predeploy = read("scripts/predeploy.sh");
    expect(predeploy).toMatch(/set -eu/);
    const migrate = predeploy.indexOf("prisma migrate deploy");
    const seed = predeploy.indexOf("scripts/seed-production.ts");
    expect(migrate).toBeGreaterThan(-1);
    expect(seed).toBeGreaterThan(migrate);
    // Never the development seed (sample content) on deploy.
    expect(predeploy).not.toMatch(/db:seed(?!:production)|prisma db seed|prisma\/seed\.ts/);
  });

  it("keeps build, start, health check and restart policy", () => {
    expect(config.build).toMatchObject({ builder: "RAILPACK", buildCommand: "npm run build" });
    expect(config.deploy).toMatchObject({
      startCommand: "npm run start:production",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    });
  });

  it("start repeats migrations + the production-safe seed as a safety net, before Next.js", () => {
    // If Railway skips pre-deploy, the site must still never run against an
    // unmigrated database (pages reading new columns would 500).
    const start = read("scripts/start-production.sh");
    expect(start).toMatch(/set -eu/);
    const migrate = start.indexOf("npx prisma migrate deploy");
    const seed = start.indexOf("npx tsx scripts/seed-production.ts");
    const next = start.indexOf("exec npx next start");
    expect(migrate).toBeGreaterThan(-1);
    expect(seed).toBeGreaterThan(migrate);
    expect(next).toBeGreaterThan(seed);
    expect(start).not.toMatch(/db:seed(?!:production)|prisma db seed|prisma\/seed\.ts/);
  });
});
