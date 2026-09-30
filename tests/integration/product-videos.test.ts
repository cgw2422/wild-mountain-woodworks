import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("../support/next-request")).nextHeaders);
vi.mock("next/navigation", async () => (await import("../support/next-request")).nextNavigation);
vi.mock("next/cache", async () => (await import("../support/next-request")).nextCache);

const { prisma } = await import("@/lib/db");
const { createSignedInAdmin, resetRequest } = await import("../support/next-request");
const { getStorage } = await import("@/lib/storage");
const { createProductVideo } = await import("@/lib/media/video");
const { UploadError } = await import("@/lib/media/process");
const actions = await import("@/app/admin/(panel)/products/actions");
const { hasTestDb, imageFile, resetDb } = await import("../support/db");

/** A tiny file with a real MP4 (ISO-BMFF) or MOV header. */
function videoFile(name: string, brand = "isom", type = "video/mp4") {
  const head = [0, 0, 0, 0x18, ...[..."ftyp" + brand].map((c) => c.charCodeAt(0)), 0, 0, 2, 0];
  return new File([new Uint8Array([...head, ...new Array(4096).fill(7)])], name, { type });
}
const meta = { width: 1920, height: 1080, durationSec: 42.37, title: "Walkaround" };

describe.skipIf(!hasTestDb)("product videos", () => {
  beforeEach(async () => {
    await resetDb();
    resetRequest();
    await createSignedInAdmin();
  });

  it("stores the file and poster, and rejects files whose contents don't match", async () => {
    const product = await prisma.product.create({ data: { name: "Ridge", slug: "ridge" } });
    const v = await createProductVideo(product.id, videoFile("ridge.mp4"), await imageFile("poster.jpg", 160, 90), meta);
    expect(v).toMatchObject({ mimeType: "video/mp4", width: 1920, height: 1080, durationSec: 42.4, title: "Walkaround", sortOrder: 0 });
    expect(v.storageKey).toMatch(/^media\/.+-ridge\.mp4$/);
    expect((await getStorage().get(v.storageKey))?.body.length).toBe(v.size);
    const poster = await prisma.media.findUniqueOrThrow({ where: { id: v.posterId! } });
    expect(poster).toMatchObject({ width: 160, height: 90, alt: "Walkaround" });

    // An iPhone-style .mov is accepted and served as MP4; a second video goes after the first.
    const mov = await createProductVideo(product.id, videoFile("IMG_1.MOV", "qt  ", "video/quicktime"), null, { ...meta, title: "" });
    expect(mov).toMatchObject({ mimeType: "video/mp4", sortOrder: 1, posterId: null });
    expect(mov.storageKey.endsWith(".mov")).toBe(true);

    const fake = new File([new Uint8Array(await (await imageFile()).arrayBuffer())], "sneaky.mp4", { type: "video/mp4" });
    await expect(createProductVideo(product.id, fake, null, meta)).rejects.toBeInstanceOf(UploadError);
    await expect(createProductVideo(product.id, videoFile("a.mp4"), null, { ...meta, durationSec: NaN })).rejects.toThrow(/length/);
    expect(await prisma.productVideo.count()).toBe(2);
  });

  it("renames, reorders and removes videos; files survive while a duplicate still uses them", async () => {
    const product = await prisma.product.create({ data: { name: "Ridge", slug: "ridge" } });
    const a = await createProductVideo(product.id, videoFile("a.mp4"), await imageFile("pa.jpg"), meta);
    const b = await createProductVideo(product.id, videoFile("b.mp4"), null, meta);

    expect((await actions.updateProductVideoTitle(product.id, a.id, "  Close-up  ")).ok).toBe(true);
    expect((await prisma.productVideo.findUniqueOrThrow({ where: { id: a.id } })).title).toBe("Close-up");
    await actions.reorderProductVideos(product.id, [b.id, a.id]);
    expect((await prisma.productVideo.findMany({ where: { productId: product.id }, orderBy: { sortOrder: "asc" } })).map((v) => v.id)).toEqual([b.id, a.id]);

    const dup = await actions.duplicateProduct(product.id);
    const copies = await prisma.productVideo.findMany({ where: { productId: dup.id! } });
    expect(copies.map((c) => c.storageKey).sort()).toEqual([a.storageKey, b.storageKey].sort());

    // Removing from the original keeps the file and poster (the copy still uses them).
    expect((await actions.removeProductVideo(product.id, a.id)).ok).toBe(true);
    expect(await getStorage().get(a.storageKey)).not.toBeNull();
    expect(await prisma.media.count({ where: { id: a.posterId! } })).toBe(1);

    // Deleting the copy removes the last references: files and poster go.
    expect((await actions.deleteProduct(dup.id!)).ok).toBe(true);
    expect(await getStorage().get(a.storageKey)).toBeNull();
    expect(await prisma.media.count({ where: { id: a.posterId! } })).toBe(0);
    expect(await getStorage().get(b.storageKey)).not.toBeNull(); // still on the original

    // A video can't be touched through another product's id.
    const other = await prisma.product.create({ data: { name: "Other", slug: "other" } });
    expect((await actions.removeProductVideo(other.id, b.id)).ok).toBe(false);
  });
});
