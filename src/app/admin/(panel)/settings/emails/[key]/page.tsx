import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { renderEmail } from "@/lib/email/render";
import { templateDefinition } from "@/lib/email/template-definitions";
import { getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { ActionForm, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Card, PageHeader } from "@/components/admin/ui";
import { saveEmailTemplateAction } from "../../../sales-actions";

type Props = { params: Promise<{ key: string }> };

export const metadata: Metadata = { title: "Edit email" };

const SAMPLE: Record<string, string> = {
  customerName: "Jamie Rivers",
  firstName: "Jamie",
  quoteNumber: "WMQ-1042",
  revisionNumber: "2",
  orderNumber: "WMO-1018",
  invoiceNumber: "WMI-1031",
  total: "$3,450",
  deposit: "$1,725",
  amountDue: "$1,725.00",
  amountPaid: "$1,725.00",
  balanceRemaining: "$1,725.00",
  dueDate: "October 30, 2026",
  expiresOn: "November 1, 2026",
  deliveryDate: "December 4, 2026",
  deliveryNotes: "We'll call the day before with a delivery window.",
  status: "In production",
  estimatedCompletion: "Late November",
  paymentMethod: "Check",
  paymentInstructions: "Checks payable to Wild Mountain Woodworks.",
  reason: "Went with a smaller table",
  summary: "Piece: The Ridge Dining Table\nSize: 84 × 38\nWood: Walnut",
  confirmationText: "Thank you for your request. We review every request personally and will be in touch soon.",
  customerEmail: "jamie@example.com",
  customerPhone: "(614) 555-0100",
  zipCode: "43215",
  notes: "Notes: Please call after 5.",
  nextStep: "Next, we'll send an invoice for the $1,725 deposit.",
};

export default async function EditEmailTemplatePage({ params }: Props) {
  await requirePermission("settings");
  const { key } = await params;
  const def = templateDefinition(key);
  const t = def ? await prisma.emailTemplate.findUnique({ where: { key } }) : null;
  if (!def || !t) notFound();
  const settings = await getSettings();
  const preview = renderEmail({
    subject: t.subject,
    heading: t.heading,
    body: t.body,
    buttonLabel: t.buttonLabel,
    actionUrl: siteUrl("/quote/example"),
    vars: { ...SAMPLE, businessName: settings.businessName },
    brand: { businessName: settings.businessName, logoUrl: "/brand/wild-mountain-horizontal-dark.png", siteUrl: siteUrl("/"), footer: settings.businessName },
  });
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Settings", href: "/admin/settings" }, { label: "Emails", href: "/admin/settings/emails" }, { label: t.name }]} title={t.name} description={def.description} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Template">
          <ActionForm action={saveEmailTemplateAction.bind(null, key)} className="space-y-4">
            <Toggle name="enabled" label="Send this email" defaultChecked={t.enabled} description="When off, this email is skipped (nothing else changes)." />
            <TextInput name="subject" label="Subject" required defaultValue={t.subject} maxLength={200} />
            <TextInput name="heading" label="Heading" required defaultValue={t.heading} maxLength={200} />
            <TextArea name="body" label="Message" rows={12} required defaultValue={t.body} maxLength={10000} help='Plain text. Blank line = new paragraph; lines starting with "- " become a list.' />
            {def.buttonLabel !== null ? <TextInput name="buttonLabel" label="Button text" defaultValue={t.buttonLabel ?? ""} maxLength={60} help="The button links to the quote, invoice or order automatically." /> : null}
            <div className="rounded bg-neutral-50 p-3 text-xs text-neutral-600">
              <p className="font-medium text-neutral-800">Placeholders you can use</p>
              <p className="mt-1 font-mono">{def.variables.map((v) => `{{${v}}}`).join("  ")}</p>
            </div>
            <div className="flex justify-end border-t border-neutral-100 pt-4">
              <SubmitButton>Save email</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card title="Preview" description={`With sample details. Subject: ${preview.subject}`} bodyClassName="p-0">
          <iframe title="Email preview" srcDoc={preview.html} sandbox="allow-same-origin" className="h-[40rem] w-full rounded-b-md bg-white" />
        </Card>
      </div>
    </>
  );
}
