import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createMediaFromFile, deleteMedia, getMediaUsage, getMediaUsageCounts, replaceMediaFile } from "@/lib/media/service";
import { getStorage } from "@/lib/storage";
import { hasTestDb, imageFile, resetDb } from "../support/db";

describe.skipIf(!hasTestDb)("media library safety", () => {
  beforeEach(resetDb);

  it("stores metadata in PostgreSQL and the binary in object storage", async () => {
    const media = await createMediaFromFile(await imageFile("hero.jpg", 120, 80), { alt: "Hero" });
    expect(media).toMatchObject({ width: 120, height: 80, mimeType: "image/jpeg", alt: "Hero" });
    expect(media.storageKey.startsWith("media/")).toBe(true);
    const stored = await getStorage().get(media.storageKey);
    expect(stored?.body.length).toBe(media.size);
  });

  it("strips embedded metadata such as GPS location from uploads", async () => {
    const sharp = (await import("sharp")).default;
    const withExif = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#7a5a42" } })
      .withExif({ IFD0: { Copyright: "Home workshop", Artist: "Owner's phone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 17/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const media = await createMediaFromFile(new File([new Uint8Array(withExif)], "shop.jpg", { type: "image/jpeg" }));
    const stored = await getStorage().get(media.storageKey);
    const meta = await sharp(stored!.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(stored!.body.includes(Buffer.from("Home workshop"))).toBe(false);
    expect({ width: meta.width, height: meta.height }).toEqual({ width: 80, height: 60 });
  });

  it("reports usage and refuses to delete an image that is in use", async () => {
    const media = await createMediaFromFile(await imageFile());
    const category = await prisma.category.create({ data: { name: "Benches", slug: "benches", imageId: media.id } });
    const product = await prisma.product.create({ data: { name: "Bench", slug: "bench", images: { create: { mediaId: media.id, isPrimary: true } } } });
    const page = await prisma.page.create({ data: { slug: "home", title: "Homepage", sections: { create: { key: "hero", imageId: media.id } } } });

    const usage = await getMediaUsage(media.id);
    expect(usage.map((u) => u.label)).toEqual(expect.arrayContaining(["Product: Bench", "Category: Benches", "Homepage → hero section"]));
    expect((await getMediaUsageCounts([media.id]))[media.id]).toBe(3);

    const refused = await deleteMedia(media.id);
    expect(refused.deleted).toBe(false);
    expect(refused.usage).toHaveLength(3);
    expect(await prisma.media.count()).toBe(1);

    // Forced delete detaches every reference — no broken image links remain.
    const forced = await deleteMedia(media.id, { force: true });
    expect(forced.deleted).toBe(true);
    expect(await prisma.productImage.count({ where: { productId: product.id } })).toBe(0);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).imageId).toBeNull();
    expect((await prisma.pageSection.findFirstOrThrow({ where: { pageId: page.id } })).imageId).toBeNull();
    expect(await getStorage().get(forced.usage.length ? media.storageKey : "")).toBeNull();
  });

  it("replaces a file everywhere it is used while keeping id, alt text and focal point", async () => {
    const media = await createMediaFromFile(await imageFile("old.jpg", 100, 100), { alt: "Walnut table" });
    await prisma.media.update({ where: { id: media.id }, data: { focalX: 30, focalY: 70 } });
    await prisma.category.create({ data: { name: "Tables", slug: "tables", imageId: media.id } });
    const replaced = await replaceMediaFile(media.id, await imageFile("new.jpg", 300, 200));
    expect(replaced.id).toBe(media.id);
    expect(replaced).toMatchObject({ width: 300, height: 200, alt: "Walnut table", focalX: 30, focalY: 70, originalName: "new.jpg" });
    expect(await getStorage().get(media.storageKey)).toBeNull();
    expect(await getStorage().get(replaced.storageKey)).not.toBeNull();
    expect((await prisma.category.findFirstOrThrow()).imageId).toBe(media.id);
  });

  it("rejects non-image uploads by content", async () => {
    const fake = new File([new TextEncoder().encode("GIF89a not really")], "x.png", { type: "image/png" });
    await expect(createMediaFromFile(fake)).rejects.toThrow();
    expect(await prisma.media.count()).toBe(0);
  });
});
