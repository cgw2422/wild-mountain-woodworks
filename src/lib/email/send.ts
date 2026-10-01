import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { getEmailProvider } from "./provider";
import { renderEmail, type TemplateVars } from "./render";
import { templateDefinition } from "./template-definitions";

export interface EmailLinks {
  customerId?: string | null;
  quoteId?: string | null;
  invoiceId?: string | null;
  orderId?: string | null;
}

export type SendResult = { status: "SENT" | "FAILED" | "SKIPPED"; logId: string | null; error?: string };

/** Where "to you" notifications go. */
export async function adminRecipient(): Promise<string | null> {
  const s = await getSettings();
  return s.notificationEmail || s.email || process.env.ADMIN_NOTIFICATION_EMAIL || null;
}

async function loadTemplate(key: string) {
  const stored = await prisma.emailTemplate.findUnique({ where: { key } });
  if (stored) return stored;
  const def = templateDefinition(key);
  if (!def) throw new Error(`Unknown email template "${key}"`);
  return { key, name: def.name, subject: def.subject, heading: def.heading, body: def.body, buttonLabel: def.buttonLabel, enabled: true };
}

async function deliver(logId: string, to: string, subject: string, html: string, text: string, replyTo?: string | null): Promise<SendResult> {
  try {
    await getEmailProvider().send({ to, subject, html, text, replyTo: replyTo ?? undefined });
    await prisma.emailLog.update({ where: { id: logId }, data: { status: "SENT", sentAt: new Date(), error: null, attempts: { increment: 1 } } });
    return { status: "SENT", logId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
    logger.error("Email delivery failed", { error, template: logId });
    await prisma.emailLog.update({ where: { id: logId }, data: { status: "FAILED", error: message, attempts: { increment: 1 } } }).catch(() => undefined);
    return { status: "FAILED", logId, error: message };
  }
}

/**
 * Render and send a template email. The email is recorded in EmailLog BEFORE
 * sending, so a provider failure never loses anything: the quote/invoice is
 * already saved and the email can be resent from admin. Never throws.
 */
export async function sendTemplateEmail(opts: {
  template: string;
  to: string | null | undefined;
  vars: TemplateVars;
  actionUrl?: string | null;
  links?: EmailLinks;
  replyTo?: string | null;
  /** Button text used if the editable template has none — keeps a required link (e.g. "View Your Order") from being edited away. */
  requiredButton?: string;
}): Promise<SendResult> {
  try {
    if (!opts.to) return { status: "SKIPPED", logId: null };
    const [template, settings] = await Promise.all([loadTemplate(opts.template), getSettings()]);
    if (!template.enabled) return { status: "SKIPPED", logId: null };
    const vars: TemplateVars = {
      businessName: settings.businessName,
      firstName: String(opts.vars.customerName ?? "").split(" ")[0] || "there",
      ...opts.vars,
    };
    const rendered = renderEmail({
      subject: template.subject,
      heading: template.heading,
      body: template.body,
      buttonLabel: template.buttonLabel?.trim() || (opts.actionUrl ? (opts.requiredButton ?? null) : null),
      actionUrl: opts.actionUrl,
      vars,
      brand: { businessName: settings.businessName, logoUrl: siteUrl("/brand/wild-mountain-horizontal-dark.png"), siteUrl: siteUrl("/"), footer: [settings.businessName, settings.email, settings.phone].filter(Boolean).join(" · ") },
    });
    const log = await prisma.emailLog.create({
      data: {
        template: opts.template,
        to: opts.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        customerId: opts.links?.customerId ?? null,
        quoteId: opts.links?.quoteId ?? null,
        invoiceId: opts.links?.invoiceId ?? null,
        orderId: opts.links?.orderId ?? null,
      },
    });
    return await deliver(log.id, opts.to, rendered.subject, rendered.html, rendered.text, opts.replyTo ?? settings.email);
  } catch (error) {
    logger.error("Could not prepare email", { error, template: opts.template });
    return { status: "FAILED", logId: null, error: "Could not prepare email" };
  }
}

/** Re-send a logged email exactly as it was rendered. */
export async function resendLoggedEmail(logId: string): Promise<SendResult> {
  const log = await prisma.emailLog.findUnique({ where: { id: logId } });
  if (!log) return { status: "FAILED", logId: null, error: "Email not found" };
  await prisma.emailLog.update({ where: { id: logId }, data: { status: "PENDING" } });
  const settings = await getSettings();
  return deliver(log.id, log.to, log.subject, log.html, log.text, settings.email);
}
