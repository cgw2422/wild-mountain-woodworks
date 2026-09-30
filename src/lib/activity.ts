import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";

export type ActivityType =
  | "product.created"
  | "product.updated"
  | "product.sale_updated"
  | "product.sale_removed"
  | "product.published"
  | "product.unpublished"
  | "product.archived"
  | "product.duplicated"
  | "product.deleted"
  | "category.updated"
  | "option.updated"
  | "addon.updated"
  | "portfolio.updated"
  | "portfolio.published"
  | "quote.received"
  | "quote.status_changed"
  | "custom_request.received"
  | "custom_request.status_changed"
  | "message.received"
  | "media.uploaded"
  | "media.replaced"
  | "media.deleted"
  | "media.updated"
  | "portfolio.created"
  | "portfolio.unpublished"
  | "portfolio.archived"
  | "portfolio.deleted"
  | "faq.created"
  | "faq.deleted"
  | "admin.created"
  | "admin.updated"
  | "account.password_changed"
  | "page.updated"
  | "homepage.updated"
  | "faq.updated"
  | "settings.updated"
  | "admin.login"
  | "order.created"
  | "estimate.saved"
  | "estimate.archived"
  | "estimate.converted"
  | "pricing.settings_updated"
  | "message.status_changed"
  | "order.production_status_changed"
  | "note.added"
  | "note.deleted"
  | "sample_content.removed"
  // Security events
  | "admin.login_failed"
  | "admin.logout"
  | "admin.mfa_enabled"
  | "admin.mfa_failed"
  | "admin.mfa_reset"
  | "admin.backup_codes_regenerated"
  | "admin.backup_code_used"
  | "admin.sessions_revoked"
  | "admin.role_changed"
  | "admin.password_reset"
  | "admin.login_locked";

/**
 * Record an event in the audit log (also shown as the dashboard's Recent
 * Activity). Captures the originating IP and user agent when called during a
 * request. Never throws, and must never be given passwords, tokens, codes or
 * other secrets.
 */
export async function logActivity(
  type: ActivityType,
  message: string,
  opts: { actorId?: string | null; entityType?: string; entityId?: string } = {},
) {
  let ipAddress: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ipAddress = clientIpFromHeaders(h);
    userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  } catch {
    // Outside a request (scripts, background work): no origin to record.
  }
  try {
    await prisma.activityLog.create({
      data: { type, message: message.slice(0, 500), actorId: opts.actorId ?? null, entityType: opts.entityType, entityId: opts.entityId, ipAddress, userAgent },
    });
  } catch (error) {
    logger.warn("Failed to record activity", { error, type });
  }
}
