import { getStorage } from "@/lib/storage";

/**
 * Serves public media when using the local storage driver (development, or a
 * Railway Volume). With R2, media URLs point straight at the R2 public
 * domain/CDN and this route is unused.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((seg) => seg === ".." || seg.includes("\\"))) return new Response("Not found", { status: 404 });
  const storage = getStorage();
  if (storage.name !== "local") return new Response("Not found", { status: 404 });
  const obj = await storage.get(`media/${path.join("/")}`);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": obj.contentType,
      "Content-Length": String(obj.body.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
