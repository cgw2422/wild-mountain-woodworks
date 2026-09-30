import "server-only";
import { cache } from "react";
import { draftMode } from "next/headers";
import { getCurrentAdmin, type CurrentAdmin } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";

/**
 * Secure previews of unpublished content (draft and archived pages). Uses Next.js Draft Mode, which can only be switched on by
 * /api/admin/preview after the session and permission are checked — and is
 * never trusted on its own: every render re-validates the admin session and
 * role here. A copied Draft Mode cookie without a valid staff session shows
 * nothing.
 */
export const isPreviewing = cache(async (): Promise<boolean> => {
  try {
    return (await draftMode()).isEnabled;
  } catch {
    return false;
  }
});

/** The staff user previewing with `permission`, or null (default deny). */
export async function getPreviewer(permission: Permission): Promise<CurrentAdmin | null> {
  if (!(await isPreviewing())) return null;
  const admin = await getCurrentAdmin();
  return admin && can(admin.role, permission) ? admin : null;
}

/** Only same-site paths may be previewed (no open redirects). */
export function safePreviewPath(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || v.startsWith("/api/") || v.startsWith("/admin")) return "/";
  return v;
}
