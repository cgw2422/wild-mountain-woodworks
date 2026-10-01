import "server-only";
import { formatCents } from "@/lib/money";
import { snapshotOptionLabel, type ConfigurationSnapshot } from "@/lib/pricing/snapshot";
import { getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { sendEmailSafely } from "./provider";

/**
 * Custom-request and contact-message emails. Quote, invoice, payment and
 * order emails use the editable templates in src/lib/email/send.ts.
 *
 * Business notification emails. Every function is fire-and-forget safe:
 * failures are logged, never surfaced to the customer, because the
 * submission itself is already stored and visible in admin.
 */

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, lines: string[]) {
  const body = lines
    .map((l) => (l === "" ? "<br/>" : `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`))
    .join("");
  return `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1f1e1c;background:#f7f3ec;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border:1px solid #e6dfd3">
<p style="letter-spacing:.2em;font-size:12px;margin:0 0 24px">WILD MOUNTAIN WOODWORKS</p>
<h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 16px">${escapeHtml(title)}</h1>
${body}</div></body></html>`;
}

export function describeSnapshot(s: ConfigurationSnapshot, showPrices: boolean): string[] {
  const lines = [`Piece: ${s.product.name}`];
  for (const o of s.options) {
    lines.push(`${o.groupDisplayName}: ${snapshotOptionLabel(o)}${o.customDetails ? ` — ${o.customDetails}` : ""}`);
  }
  for (const a of s.addOns) lines.push(`Add-on: ${a.name}${a.quantity > 1 ? ` × ${a.quantity}` : ""}`);
  if (showPrices && s.totalCents != null) {
    lines.push(`Estimated price: ${formatCents(s.totalCents)}${s.requiresCustomQuote ? " (custom details priced separately)" : ""}`);
    if (s.sale) lines.push(`Sale price applied — ${formatCents(s.sale.savingsCents)} off the regular price.`);
  }
  return lines;
}

async function adminRecipient() {
  const s = await getSettings();
  return s.notificationEmail || s.email || process.env.ADMIN_NOTIFICATION_EMAIL || null;
}

export async function notifyCustomRequest(r: {
  id: string;
  reference: string;
  name: string;
  email: string;
  furnitureType: string;
  description: string;
}) {
  const to = await adminRecipient();
  if (!to) return;
  const lines = [
    `Reference: ${r.reference}`,
    `From: ${r.name} <${r.email}>`,
    `Furniture: ${r.furnitureType}`,
    "",
    r.description,
    "",
    `Open in admin: ${siteUrl(`/admin/custom-requests/${r.id}`)}`,
  ];
  await sendEmailSafely({ to, replyTo: r.email, subject: `New custom build request ${r.reference}`, text: lines.join("\n"), html: layout("New custom build request", lines) });
}

export async function sendCustomRequestConfirmation(r: { reference: string; name: string; email: string }) {
  const settings = await getSettings();
  const lines = [
    `Hi ${r.name.split(" ")[0]},`,
    "",
    "Thank you for telling us about the piece you have in mind. We'll review the details and reach out to talk through next steps.",
    "",
    `Your reference number is ${r.reference}.`,
    "",
    settings.businessName,
  ];
  await sendEmailSafely({ to: r.email, replyTo: settings.email ?? undefined, subject: `Your custom build request — ${r.reference}`, text: lines.join("\n"), html: layout("We received your custom build request", lines) });
}

export async function notifyContactMessage(m: { id: string; name: string; email: string; reason: string; message: string }) {
  const to = await adminRecipient();
  if (!to) return;
  const lines = [`From: ${m.name} <${m.email}>`, `Reason: ${m.reason}`, "", m.message, "", `Open in admin: ${siteUrl(`/admin/messages/${m.id}`)}`];
  await sendEmailSafely({ to, replyTo: m.email, subject: `New message from ${m.name}`, text: lines.join("\n"), html: layout("New contact message", lines) });
}

export async function sendContactConfirmation(m: { name: string; email: string }) {
  const settings = await getSettings();
  const lines = [`Hi ${m.name.split(" ")[0]},`, "", "Thanks for reaching out. We've received your message and will reply soon.", "", settings.businessName];
  await sendEmailSafely({ to: m.email, replyTo: settings.email ?? undefined, subject: "We received your message", text: lines.join("\n"), html: layout("Thanks for reaching out", lines) });
}
