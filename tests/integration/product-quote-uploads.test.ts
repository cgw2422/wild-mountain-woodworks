import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const { submitConfigurationQuote, submitCustomRequest } = await import("@/app/(site)/actions");
const sales = await import("@/app/admin/(panel)/sales-actions");
const attachmentRoute = await import("@/app/api/admin/attachments/[id]/route");
const { getStorage } = await import("@/lib/storage");
const { hasTestDb, imageFile, resetDb, seedRidge } = await import("../support/db");

/** A filled-in form that passes the honeypot and minimum-fill-time checks. */
function form(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("form_started_at", String(Date.now() - 10_000));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const person = { name: "Jamie Rivers", email: "jamie@example.com", phone: "", zipCode: "43215" };

describe("standard product quote form", () => {
  it("has no customer upload field (custom furniture keeps its photo field)", () => {
    const configurator = readFileSync(path.resolve("src/components/product/Configurator.tsx"), "utf8");
    expect(configurator).not.toMatch(/ReferenceImagesField|type="file"|attachments/);
    const custom = readFileSync(path.resolve("src/components/forms/CustomBuildForm.tsx"), "utf8");
    expect(custom).toMatch(/ReferenceImagesField/);
  });
});

describe.skipIf(!hasTestDb)("product quote uploads", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await prisma.siteSetting.create({ data: { id: "default" } });
  });

  async function productForm() {
    const { product, ids } = await seedRidge();
    return form({ ...person, productId: product.id, selection: JSON.stringify({ options: { [ids.size]: ids.s60, [ids.wood]: ids.pine }, addOns: {}, customDetails: {} }), notes: "Walnut please" });
  }

  it("rejects any file sent with a product quote request and stores nothing", async () => {
    for (const field of ["attachments", "photo", "anything"]) {
      const fd = await productForm();
      fd.append(field, await imageFile("inspo.jpg"));
      const res = await submitConfigurationQuote(fd);
      expect(res, field).toMatchObject({ status: "error", message: expect.stringMatching(/Custom Furniture form/) });
      await resetDb();
      await prisma.siteSetting.create({ data: { id: "default" } });
    }
    expect(await prisma.quoteRequest.count()).toBe(0);
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("accepts the structured configuration + notes without files", async () => {
    const res = await submitConfigurationQuote(await productForm());
    expect(res).toMatchObject({ status: "success", reference: "WMWQ-2001" });
    expect(await prisma.quoteRequest.findFirstOrThrow()).toMatchObject({ notes: "Walnut please", source: "CONFIGURATOR" });
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("custom furniture requests still accept reference images", async () => {
    const fd = form({ ...person, furnitureType: "Desk", description: "A walnut writing desk with two drawers." });
    fd.append("attachments", await imageFile("room.jpg"));
    expect(await submitCustomRequest(fd)).toMatchObject({ status: "success" });
    const a = await prisma.attachment.findFirstOrThrow();
    expect(a.customRequestId).not.toBeNull();
    expect(await getStorage().get(a.storageKey)).not.toBeNull();
  });

  it("admins can still attach files to quotes and orders, and historical customer uploads stay readable", async () => {
    const quoteRes = await submitConfigurationQuote(await productForm());
    const quote = await prisma.quoteRequest.findUniqueOrThrow({ where: { number: quoteRes.status === "success" ? quoteRes.reference : "" } });
    // An older product quote that already has a customer upload (before this change).
    const buf = Buffer.from(await (await imageFile("old.jpg")).arrayBuffer());
    await getStorage().put("private/legacy-old.jpg", buf, "image/jpeg");
    const legacy = await prisma.attachment.create({ data: { storageKey: "private/legacy-old.jpg", filename: "old.jpg", mimeType: "image/jpeg", size: buf.length, quoteRequestId: quote.id } });

    await createSignedInAdmin({ role: "ADMIN", email: "admin@example.com" });
    const res = (await attachmentRoute.GET(new Request(`http://localhost/api/admin/attachments/${legacy.id}`), { params: Promise.resolve({ id: legacy.id }) }))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");

    const media = await prisma.media.create({ data: { storageKey: "public/drawing.jpg", url: "/media-files/public/drawing.jpg", filename: "drawing.jpg", originalName: "drawing.jpg", mimeType: "image/jpeg", size: 10, width: 10, height: 10 } });
    const attach = (target: "quote" | "order", id: string) => sales.addSalesAttachmentAction(target, id, (() => { const fd = new FormData(); fd.set("mediaId", media.id); fd.set("label", "Top view"); return fd; })());
    expect(await attach("quote", quote.id)).toMatchObject({ ok: true });
    const order = await prisma.order.create({ data: { number: "WMO-9", customerName: "J", customerEmail: "j@example.com", subtotalCents: 0, totalCents: 0 } });
    expect(await attach("order", order.id)).toMatchObject({ ok: true });
    expect(await prisma.salesAttachment.count()).toBe(2);
    // The historical upload is untouched.
    expect(await prisma.attachment.findUnique({ where: { id: legacy.id } })).not.toBeNull();
  });
});
