/**
 * Maintenance: re-render generated sample images in place (same Media ids),
 * e.g. after changing the placeholder renderer. Only touches isSample media.
 *   npx tsx scripts/rerender-sample-images.ts [key ...]
 */
import "dotenv/config";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createStorageFromEnv } from "../src/lib/storage/factory";
import { renderScene } from "../prisma/seed-data/images";
import { IMAGE_SPECS } from "../prisma/seed-data/catalog";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const storage = createStorageFromEnv();
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(IMAGE_SPECS);
  for (const key of keys) {
    const spec = IMAGE_SPECS[key];
    if (!spec) continue;
    const media = await prisma.media.findFirst({ where: { originalName: spec.name, isSample: true } });
    if (!media) continue;
    const buffer = await renderScene(spec.scene);
    const meta = await sharp(buffer).metadata();
    const blur = await sharp(buffer).resize(16, 16, { fit: "inside" }).webp({ quality: 40 }).toBuffer();
    await storage.put(media.storageKey, buffer, "image/jpeg");
    await prisma.media.update({
      where: { id: media.id },
      data: { width: meta.width!, height: meta.height!, size: buffer.length, blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}` },
    });
    console.log(`re-rendered ${key}`);
  }
  await prisma.$disconnect();
}
main();
