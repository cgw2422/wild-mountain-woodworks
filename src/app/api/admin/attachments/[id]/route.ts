import { prisma } from "@/lib/db";
import { guardAdminApi } from "@/lib/admin/api";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Attachments are validated images at upload; anything else is served as a
// download-only octet stream as a defense in depth.
const SAFE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

function sanitizeFilename(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/_+/g, "_")
    .trim()
    .slice(0, 120);
  return cleaned || "attachment";
}

/** Stream a private customer reference image to a signed-in admin. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminApi(request, "inbox");
  if ("error" in guard) return guard.error;

  const { id } = await params;
  if (!id || id.length > 64) return new Response("Not found", { status: 404 });
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) return new Response("Not found", { status: 404 });

  let object;
  try {
    object = await getStorage().get(attachment.storageKey);
  } catch (error) {
    logger.error("Attachment read failed", { error, id });
    return new Response("Could not load attachment", { status: 502 });
  }
  if (!object) return new Response("Not found", { status: 404 });

  const contentType = SAFE_TYPES.has(attachment.mimeType) ? attachment.mimeType : "application/octet-stream";
  const filename = sanitizeFilename(attachment.filename);
  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(object.body.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${contentType === "application/octet-stream" ? "attachment" : "inline"}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
