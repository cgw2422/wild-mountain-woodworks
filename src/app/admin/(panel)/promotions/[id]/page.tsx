import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { announcementStatus } from "@/lib/promotions/announcement";
import { siteDateTimeInput, siteTimeZone } from "@/lib/site-time";
import { ConfirmAction } from "@/components/admin/forms";
import { Badge, PageHeader } from "@/components/admin/ui";
import { deleteAnnouncement, saveAnnouncement } from "../actions";
import { AnnouncementForm } from "./AnnouncementForm";

export const metadata: Metadata = { title: "Announcement" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AnnouncementPage({ params }: Props) {
  await requireAdmin();
  const { id } = await params;
  const a = await prisma.announcement.findUnique({ where: { id } });
  if (!a) notFound();
  const status = announcementStatus(a);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Promotions", href: "/admin/promotions" }, { label: a.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.name}
            {status === "live" ? <Badge tone="green">Showing now</Badge> : status === "scheduled" ? <Badge tone="blue">Scheduled</Badge> : <Badge tone="neutral">{status === "ended" ? "Ended" : "Off"}</Badge>}
          </span>
        }
        description="The slim bar above the main navigation on every public page."
        actions={
          <ConfirmAction
            action={deleteAnnouncement.bind(null, a.id)}
            label="Delete"
            title={`Delete “${a.name}”?`}
            body="It's removed from the site immediately. To pause it instead, switch it off."
            confirmLabel="Delete"
            redirectTo="/admin/promotions"
          />
        }
      />
      <AnnouncementForm
        action={saveAnnouncement.bind(null, a.id)}
        timeZoneLabel={siteTimeZone().replace(/_/g, " ")}
        initial={{
          name: a.name,
          enabled: a.enabled,
          message: a.message,
          secondaryText: a.secondaryText ?? "",
          linkText: a.linkText ?? "",
          linkUrl: a.linkUrl ?? "",
          backgroundColor: a.backgroundColor,
          textColor: a.textColor,
          startsAt: siteDateTimeInput(a.startsAt),
          endsAt: siteDateTimeInput(a.endsAt),
          showEndDate: a.showEndDate,
          dismissible: a.dismissible,
          showOnDesktop: a.showOnDesktop,
          showOnMobile: a.showOnMobile,
        }}
      />
    </>
  );
}
