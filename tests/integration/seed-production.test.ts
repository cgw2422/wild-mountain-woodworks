import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PAGE_DEFINITIONS } from "@/lib/cms/definitions";
import { applyRequiredDefaults } from "@/lib/seed/defaults";
import { createPasswordAdmin } from "@/lib/auth/accounts";
import { hasTestDb, resetDb, seedRidge } from "../support/db";

const run = promisify(execFile);
const quiet = () => {};
const sectionCount = PAGE_DEFINITIONS.reduce((n, d) => n + d.sections.length, 0);
const STRONG = "correct-horse-battery-staple-42";

/** The real pre-deploy entry point, against the test database. */
function seedScript(env: Record<string, string> = {}) {
  return run("npx", ["tsx", "scripts/seed-production.ts"], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!, ADMIN_EMAIL: "", ADMIN_PASSWORD: "", ADMIN_NAME: "", ...env },
    timeout: 60_000,
  });
}

describe.skipIf(!hasTestDb)("production seed (pre-deploy)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates only what's missing, and a second run changes nothing", async () => {
    const created = await prisma.$transaction((tx) => applyRequiredDefaults(tx, quiet, { ADMIN_EMAIL: "owner@example.com", ADMIN_PASSWORD: STRONG }));
    expect(created).toBe(1 + PAGE_DEFINITIONS.length + sectionCount + 1 + 1);
    expect(await prisma.siteSetting.count()).toBe(1);
    expect(await prisma.page.count()).toBe(PAGE_DEFINITIONS.length);
    expect(await prisma.pageSection.count()).toBe(sectionCount);
    expect(await prisma.announcement.findFirst()).toMatchObject({ enabled: false, linkUrl: "/furniture/sale" });
    expect(await prisma.adminUser.findFirst()).toMatchObject({ email: "owner@example.com", role: "OWNER", twoFactorEnabled: false });
    // Never sample content, products or media.
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.media.count()).toBe(0);

    expect(await prisma.$transaction((tx) => applyRequiredDefaults(tx, quiet, { ADMIN_EMAIL: "owner@example.com", ADMIN_PASSWORD: STRONG }))).toBe(0);
  });

  it("never overwrites settings, content, products, announcements or admins", async () => {
    await prisma.$transaction((tx) => applyRequiredDefaults(tx, quiet, {}));
    const { product } = await seedRidge();
    await prisma.siteSetting.update({ where: { id: "default" }, data: { businessName: "Renamed Co", showPrices: false, ecommerceEnabled: true } });
    const hero = await prisma.pageSection.findFirstOrThrow({ where: { key: "hero", page: { slug: "sale" } } });
    await prisma.pageSection.update({ where: { id: hero.id }, data: { heading: "Owner's heading", visible: false } });
    await prisma.product.update({ where: { id: product.id }, data: { name: "Owner's Table", basePriceCents: 99900 } });
    await prisma.announcement.deleteMany(); // owner deleted the starter announcement
    const owner = await createPasswordAdmin(prisma, { email: "real@example.com", name: "Real Owner", role: "OWNER" }, STRONG);
    const before = await prisma.adminAccount.findFirstOrThrow({ where: { userId: owner.id } });
    // A section removed from the database (e.g. a newly defined one) is restored...
    const faqHero = await prisma.pageSection.findFirstOrThrow({ where: { key: "hero", page: { slug: "faq" } } });
    await prisma.pageSection.delete({ where: { id: faqHero.id } });

    // ...with stale bootstrap variables still set for an address that doesn't exist.
    const created = await prisma.$transaction((tx) => applyRequiredDefaults(tx, quiet, { ADMIN_EMAIL: "someone-else@example.com", ADMIN_PASSWORD: STRONG }));
    expect(created).toBe(1);

    expect(await prisma.siteSetting.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({ businessName: "Renamed Co", showPrices: false, ecommerceEnabled: true });
    expect(await prisma.pageSection.findUniqueOrThrow({ where: { id: hero.id } })).toMatchObject({ heading: "Owner's heading", visible: false });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ name: "Owner's Table", basePriceCents: 99900 });
    expect(await prisma.announcement.count()).toBe(0);
    expect(await prisma.adminUser.count()).toBe(1);
    const after = await prisma.adminAccount.findFirstOrThrow({ where: { userId: owner.id } });
    expect(after.password).toBe(before.password);
    expect(await prisma.pageSection.count({ where: { key: "hero", page: { slug: "faq" } } })).toBe(1);
  });

  it("the pre-deploy script is idempotent end to end", async () => {
    const first = await seedScript({ ADMIN_EMAIL: "owner@example.com", ADMIN_PASSWORD: STRONG });
    expect(first.stdout).toMatch(/missing record\(s\) created/);
    const second = await seedScript({ ADMIN_EMAIL: "owner@example.com", ADMIN_PASSWORD: STRONG });
    expect(second.stdout).toMatch(/nothing changed/);
    expect(second.stdout).toMatch(/ADMIN_PASSWORD is ignored/);
    expect(await prisma.adminUser.count()).toBe(1);
  }, 120_000);

  it("fails the deploy and saves nothing when a step fails", async () => {
    // A weak bootstrap password fails the last step, after pages were created in the same transaction.
    await expect(seedScript({ ADMIN_EMAIL: "owner@example.com", ADMIN_PASSWORD: "short" })).rejects.toMatchObject({ code: 1 });
    expect(await prisma.siteSetting.count()).toBe(0);
    expect(await prisma.page.count()).toBe(0);
    expect(await prisma.seedMarker.count()).toBe(0);
    expect(await prisma.adminUser.count()).toBe(0);
  }, 120_000);
});
