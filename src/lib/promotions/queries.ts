import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { lastSaleDay, siteLongDateLabel } from "@/lib/site-time";
import { DISMISS_COOKIE, dismissKey, parseDismissed, safeLinkUrl } from "./announcement";

export interface AnnouncementView {
  key: string;
  message: string;
  secondaryText: string | null;
  linkText: string | null;
  linkUrl: string | null;
  backgroundColor: string;
  textColor: string;
  /** "Ends October 6" when an end is set and shown. */
  endsLabel: string | null;
  dismissible: boolean;
  showOnDesktop: boolean;
  showOnMobile: boolean;
}

type AnnouncementRecord = Awaited<ReturnType<typeof prisma.announcement.findFirstOrThrow>>;

export function toAnnouncementView(a: AnnouncementRecord, now: Date = new Date()): AnnouncementView {
  return {
    key: dismissKey(a),
    message: a.message,
    secondaryText: a.secondaryText,
    linkText: a.linkText,
    // Re-checked on the way out, in case a record predates validation.
    linkUrl: a.linkUrl ? safeLinkUrl(a.linkUrl) : null,
    backgroundColor: a.backgroundColor,
    textColor: a.textColor,
    endsLabel: a.showEndDate && a.endsAt ? `Ends ${siteLongDateLabel(lastSaleDay(a.endsAt), undefined, now)}` : null,
    dismissible: a.dismissible,
    showOnDesktop: a.showOnDesktop,
    showOnMobile: a.showOnMobile,
  };
}

/**
 * The announcement to show this visitor right now: enabled, inside its
 * schedule (checked per request, so it appears and disappears on time with
 * no redeploy), visible on at least one device size, and not dismissed by
 * this visitor. The most recently started one wins when several overlap.
 */
export async function getActiveAnnouncement(now: Date = new Date(), dismissedCookie?: string | null): Promise<AnnouncementView | null> {
  const dismissed = new Set(parseDismissed(dismissedCookie === undefined ? (await cookies()).get(DISMISS_COOKIE)?.value : dismissedCookie));
  const candidates = await prisma.announcement.findMany({
    where: {
      enabled: true,
      OR: [{ showOnDesktop: true }, { showOnMobile: true }],
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    orderBy: [{ startsAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 10,
  });
  const a = candidates.find((c) => !dismissed.has(dismissKey(c)));
  return a ? toAnnouncementView(a, now) : null;
}
