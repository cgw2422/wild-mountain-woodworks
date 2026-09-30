import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { getStorage } from "@/lib/storage";
import { LocalStorageDriver, contentTypeFor } from "@/lib/storage/local";

/**
 * Serves public media when using the local storage driver (development, or a
 * Railway Volume). With R2, media URLs point straight at the R2 public
 * domain/CDN and this route is unused.
 *
 * Files are streamed from disk, and HTTP Range requests are honoured so
 * videos can play and seek (Safari requires ranged responses for video).
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((seg) => seg === ".." || seg.includes("\\"))) return new Response("Not found", { status: 404 });
  const storage = getStorage();
  if (!(storage instanceof LocalStorageDriver)) return new Response("Not found", { status: 404 });

  let file: string;
  let size: number;
  try {
    file = storage.pathFor(`media/${path.join("/")}`);
    const stat = await fs.stat(file);
    if (!stat.isFile()) return new Response("Not found", { status: 404 });
    size = stat.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": contentTypeFor(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m?.[1] ? Number(m[1]) : NaN;
    let end = m?.[2] ? Number(m[2]) : NaN;
    if (m && !m[1] && m[2]) {
      // Suffix range: the last N bytes.
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else if (Number.isNaN(end) || end >= size) {
      end = size - 1;
    }
    if (!m || Number.isNaN(start) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
}
