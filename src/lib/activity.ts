import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export type ActivityType =
  | "product.created"
  | "product.updated"
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
  | "message.status_changed"
  | "order.production_status_changed"
  | "note.added"
  | "note.deleted"
  | "sample_content.removed";

/** Record an event for the dashboard's Recent Activity. Never throws. */
export async function logActivity(
  type: ActivityType,
  message: string,
  opts: { actorId?: string | null; entityType?: string; entityId?: string } = {},
) {
  try {
    await prisma.activityLog.create({
      data: { type, message: message.slice(0, 500), actorId: opts.actorId ?? null, entityType: opts.entityType, entityId: opts.entityId },
    });
  } catch (error) {
    logger.warn("Failed to record activity", { error, type });
  }
}
