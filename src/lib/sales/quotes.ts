import "server-only";
import type { Prisma, QuoteSource, QuoteStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { formatCents } from "@/lib/money";
import type { ConfigurationSnapshot } from "@/lib/pricing/snapshot";
import { adminRecipient, sendTemplateEmail, type SendResult } from "@/lib/email/send";
import { getSettings, salesFlags } from "@/lib/settings";
import { siteDateLong } from "@/lib/site-time";
import { ACCEPT_DEPOSIT_LABEL, ACCEPT_NO_DEPOSIT_LABEL, ACCEPT_TERMS_LABEL } from "./acceptance";
import { findOrCreateCustomer, recordCustomerActivity } from "./customers";
import { SalesError } from "./errors";
import { VOIDED_QUOTE_MESSAGE } from "./voiding";
import { createInvoiceForOrder } from "./invoices";
import { adminLinks, customerLinks } from "./links";
import { nextNumber } from "./numbers";
import { createOrderFromRevision, type Actor } from "./orders";
import { QUOTE_STATUS_LABELS } from "./status";
import { newCustomerToken } from "./tokens";
import { computeTotals, formatBps, lineTotal, normalizeUnitPrice, type DepositType, type LineInput, type LineKind, type Totals } from "./totals";

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;

export type RevisionWithLines = Prisma.QuoteRevisionGetPayload<{ include: { lineItems: true } }>;

export interface CustomerMeta {
  ip: string | null;
  userAgent: string | null;
}

/* ------------------------------------------------------------------ lines */

export interface DraftLine {
  kind: LineKind;
  description: string;
  notes: string | null;
  quantity: number;
  unitPriceCents: number;
  taxable: boolean;
  productId: string | null;
  configuration: ConfigurationSnapshot | null;
}

/**
 * The starting lines for a configured request: the piece at its REGULAR
 * price (base + options), a separate sale discount line when a sale applied,
 * and one line per add-on. Their total equals the snapshot's total.
 */
export function linesFromSnapshot(s: ConfigurationSnapshot, quantity = 1): DraftLine[] {
  const qty = Math.max(1, Math.trunc(quantity));
  const optionsCents = s.options.reduce((sum, o) => sum + o.priceModifierCents, 0);
  const regularBase = s.sale?.regularBasePriceCents ?? s.basePriceCents ?? 0;
  const notes = s.options.map((o) => `${o.groupDisplayName}: ${o.valueDisplayName}${o.customDetails ? ` (${o.customDetails})` : ""}`).join("\n");
  const lines: DraftLine[] = [
    {
      kind: "PRODUCT",
      description: s.product.name,
      notes: notes || null,
      quantity: qty,
      unitPriceCents: s.basePriceCents == null ? 0 : regularBase + optionsCents,
      taxable: true,
      productId: s.product.id,
      configuration: s,
    },
  ];
  if (s.sale && s.sale.savingsCents > 0) {
    const pct = s.sale.percent != null ? ` (${s.sale.percent}% off)` : "";
    lines.push({ kind: "DISCOUNT", description: `${s.sale.label || "Sale"}${pct} — ${s.product.name}`, notes: null, quantity: qty, unitPriceCents: -s.sale.savingsCents, taxable: true, productId: null, configuration: null });
  }
  for (const a of s.addOns) {
    lines.push({ kind: "ADDON", description: a.name, notes: null, quantity: a.quantity * qty, unitPriceCents: a.unitPriceCents, taxable: true, productId: null, configuration: null });
  }
  return lines;
}

function lineCreates(lines: DraftLine[]) {
  return lines.map((l, i) => {
    const unit = normalizeUnitPrice(l.kind, l.unitPriceCents);
    return {
      position: i,
      kind: l.kind,
      description: l.description,
      notes: l.notes,
      quantity: Math.trunc(l.quantity),
      unitPriceCents: unit,
      lineTotalCents: lineTotal({ kind: l.kind, quantity: l.quantity, unitPriceCents: unit }),
      taxable: l.taxable,
      productId: l.productId,
      configuration: (l.configuration ?? undefined) as Prisma.InputJsonValue | undefined,
    };
  });
}

function totalsFields(t: Totals) {
  return {
    subtotalCents: t.subtotalCents,
    discountCents: t.discountCents,
    deliveryCents: t.deliveryCents,
    otherChargesCents: t.otherChargesCents,
    taxCents: t.taxCents,
    totalCents: t.totalCents,
    depositCents: t.depositCents,
    balanceCents: t.balanceCents,
  };
}

/* ------------------------------------------------------------ creation */

export interface NewQuoteInput {
  source: QuoteSource;
  name: string;
  email: string;
  phone: string | null;
  zipCode: string;
  address?: string | null;
  quantity?: number;
  productId?: string | null;
  productName?: string | null;
  configuration?: ConfigurationSnapshot | null;
  estimatedTotalCents?: number | null;
  requestedDimensions?: string | null;
  notes?: string | null;
  timeline?: string | null;
  attachments?: Prisma.AttachmentCreateWithoutQuoteRequestInput[];
  lines?: DraftLine[];
  /** Overrides the settings' default deposit. */
  deposit?: { depositType: DepositType; depositPercentBps: number | null; depositAmountCents: number | null };
  createdById?: string | null;
  status?: QuoteStatus;
}

/**
 * Create a quote (request) with its number, secure customer token, customer
 * record and a first DRAFT revision prefilled from what was requested.
 */
export async function createQuoteRecord(tx: Db, input: NewQuoteInput) {
  const settings = await tx.siteSetting.findUnique({ where: { id: "default" } });
  const customer = await findOrCreateCustomer(tx, { name: input.name, email: input.email, phone: input.phone, zipCode: input.zipCode, address: input.address });
  const number = await nextNumber("quote", tx);
  const status = input.status ?? "NEW";
  const quantity = Math.min(99, Math.max(1, Math.trunc(input.quantity ?? 1)));
  const quote = await tx.quoteRequest.create({
    data: {
      // New quotes use their number as the (legacy, unique) reference too.
      reference: number,
      number,
      status,
      source: input.source,
      customerId: customer.id,
      customerToken: newCustomerToken(),
      quantity,
      address: input.address ?? null,
      name: input.name,
      email: input.email,
      phone: input.phone,
      zipCode: input.zipCode,
      productId: input.productId ?? null,
      productName: input.productName ?? null,
      configuration: (input.configuration ?? undefined) as Prisma.InputJsonValue | undefined,
      estimatedTotalCents: input.estimatedTotalCents ?? null,
      requestedDimensions: input.requestedDimensions ?? null,
      notes: input.notes ?? null,
      timeline: input.timeline ?? null,
      createdById: input.createdById ?? null,
      attachments: input.attachments?.length ? { create: input.attachments } : undefined,
      statusEvents: { create: { toStatus: status, authorId: input.createdById ?? null } },
    },
  });
  const lines = input.lines ?? (input.configuration ? linesFromSnapshot(input.configuration, quantity) : []);
  const deposit = input.deposit ?? { depositType: (settings?.defaultDepositType ?? "PERCENTAGE") as DepositType, depositPercentBps: settings?.defaultDepositPercentBps ?? 5000, depositAmountCents: settings?.defaultDepositAmountCents ?? null };
  const revision = await tx.quoteRevision.create({
    data: {
      quoteId: quote.id,
      number: 1,
      status: "DRAFT",
      customerName: input.name,
      customerEmail: input.email,
      customerPhone: input.phone,
      customerAddress: input.address ?? null,
      terms: settings?.defaultQuoteTerms ?? null,
      ...deposit,
      ...totalsFields(computeTotals(lines, deposit)),
      createdById: input.createdById ?? null,
      lineItems: { create: lineCreates(lines) },
    },
  });
  await tx.quoteRequest.update({ where: { id: quote.id }, data: { currentRevisionId: revision.id } });
  await recordCustomerActivity(tx, {
    customerId: customer.id,
    type: input.createdById ? "quote.created" : "quote.requested",
    message: `${input.createdById ? "Quote created" : "Quote requested"}: ${number}${input.productName ? ` — ${input.productName}` : ""}`,
    quoteId: quote.id,
    actorId: input.createdById ?? null,
  });
  return { ...quote, currentRevisionId: revision.id };
}

/** Admin-created quote (phone, email, walk-in). */
export async function createManualQuote(
  actor: Actor,
  input: Pick<NewQuoteInput, "name" | "email" | "phone" | "zipCode" | "address" | "notes" | "lines" | "deposit" | "productId" | "productName" | "requestedDimensions" | "estimatedTotalCents"> & { source?: QuoteSource },
  tx?: Db,
) {
  const create = (db: Db) => createQuoteRecord(db, { ...input, source: input.source ?? "MANUAL", createdById: actor.id, status: "DRAFT" });
  const quote = tx ? await create(tx) : await prisma.$transaction(create);
  await logActivity("quote.created", `${actor.name} created quote ${quote.number} for ${input.name}`, { actorId: actor.id, entityType: "quote", entityId: quote.id });
  return quote;
}

/**
 * Quotes created before revisions existed get their first DRAFT revision
 * (prefilled from the stored request snapshot), a number, a customer and a
 * customer token the first time they are opened in admin.
 */
export async function ensureQuoteReady(quoteId: string) {
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, select: { id: true, currentRevisionId: true, customerToken: true, number: true, customerId: true } });
  if (!quote) return null;
  if (quote.currentRevisionId && quote.customerToken && quote.number && quote.customerId) return quote;
  await prisma.$transaction(async (tx) => {
    const q = await tx.quoteRequest.findUniqueOrThrow({ where: { id: quoteId } });
    const settings = await tx.siteSetting.findUnique({ where: { id: "default" } });
    const data: Prisma.QuoteRequestUpdateInput = {};
    if (!q.number) data.number = await nextNumber("quote", tx);
    if (!q.customerToken) data.customerToken = newCustomerToken();
    if (!q.customerId) {
      const c = await findOrCreateCustomer(tx, { name: q.name, email: q.email, phone: q.phone, zipCode: q.zipCode, address: q.address });
      data.customer = { connect: { id: c.id } };
    }
    if (!q.currentRevisionId) {
      const existing = await tx.quoteRevision.findFirst({ where: { quoteId }, orderBy: { number: "desc" } });
      if (existing) {
        data.currentRevision = { connect: { id: existing.id } };
      } else {
        const snap = q.configuration as ConfigurationSnapshot | null;
        const lines = snap && typeof snap === "object" && "product" in snap ? linesFromSnapshot(snap, q.quantity) : [];
        const deposit = { depositType: (settings?.defaultDepositType ?? "PERCENTAGE") as DepositType, depositPercentBps: settings?.defaultDepositPercentBps ?? 5000, depositAmountCents: settings?.defaultDepositAmountCents ?? null };
        const rev = await tx.quoteRevision.create({
          data: {
            quoteId,
            number: 1,
            customerName: q.name,
            customerEmail: q.email,
            customerPhone: q.phone,
            customerAddress: q.address,
            terms: settings?.defaultQuoteTerms ?? null,
            ...deposit,
            ...totalsFields(computeTotals(lines, deposit)),
            lineItems: { create: lineCreates(lines) },
          },
        });
        data.currentRevision = { connect: { id: rev.id } };
      }
    }
    await tx.quoteRequest.update({ where: { id: quoteId }, data });
  });
  return prisma.quoteRequest.findUnique({ where: { id: quoteId }, select: { id: true, currentRevisionId: true, customerToken: true, number: true, customerId: true } });
}

/* ------------------------------------------------------------ editing */

export interface RevisionLineInput {
  /** An existing line (any revision of this quote) whose product link and configuration snapshot carry over. */
  sourceId: string | null;
  kind: LineKind;
  description: string;
  notes: string | null;
  quantity: number;
  unitPriceCents: number;
  taxable: boolean;
  productId: string | null;
}

export interface RevisionInput {
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerAddress: string | null;
  customerNotes: string | null;
  terms: string | null;
  expiresAt: Date | null;
  leadTime: string | null;
  estimatedCompletion: string | null;
  deliveryDetails: string | null;
  depositType: DepositType;
  depositPercentBps: number | null;
  depositAmountCents: number | null;
  taxCents: number;
  lines: RevisionLineInput[];
}

/**
 * Save the DRAFT revision. Sent revisions are never edited. Totals are
 * recomputed here from the lines; product links are checked against the
 * database and configuration snapshots only come from existing lines of this
 * quote — never from the browser. Price changes are written to the audit log.
 */
export async function saveRevision(actor: Actor, quoteId: string, input: RevisionInput) {
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { currentRevision: { include: { lineItems: true } }, revisions: { select: { id: true } } } });
  if (!quote || !quote.currentRevision) throw new SalesError("That quote no longer exists.");
  assertNotVoided(quote);
  const rev = quote.currentRevision;
  if (rev.status !== "DRAFT") throw new SalesError("This revision has been sent and can't be changed. Create a new revision to make changes.");
  if (["ACCEPTED", "CONVERTED_TO_INVOICE", "COMPLETED", "CANCELED"].includes(quote.status)) throw new SalesError(`This quote is ${QUOTE_STATUS_LABELS[quote.status].toLowerCase()} and can't be edited.`);

  const settings = await getSettings();
  const revisionIds = quote.revisions.map((r) => r.id);
  const sourceIds = input.lines.map((l) => l.sourceId).filter((x): x is string => Boolean(x));
  const sources = sourceIds.length ? await prisma.quoteLineItem.findMany({ where: { id: { in: sourceIds }, revisionId: { in: revisionIds } } }) : [];
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const productIds = [...new Set(input.lines.map((l) => l.productId).filter((x): x is string => Boolean(x)))];
  const validProducts = new Set((productIds.length ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } }) : []).map((p) => p.id));

  const lines: DraftLine[] = input.lines.map((l) => {
    const src = l.sourceId ? sourceById.get(l.sourceId) : undefined;
    const productId = l.productId && validProducts.has(l.productId) ? l.productId : (src?.productId ?? null);
    return {
      kind: l.kind,
      description: l.description,
      notes: l.notes,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      taxable: l.taxable,
      productId,
      configuration: src && src.productId === productId ? (src.configuration as ConfigurationSnapshot | null) : null,
    };
  });
  const deposit = { depositType: input.depositType, depositPercentBps: input.depositType === "PERCENTAGE" ? input.depositPercentBps : null, depositAmountCents: input.depositType === "FIXED_AMOUNT" ? input.depositAmountCents : null };
  const totals = computeTotals(lines, deposit, settings.taxEnabled ? input.taxCents : 0);
  if (totals.totalCents < 0) throw new SalesError("Discounts can't be larger than the quote total.");

  // Audit manual price changes line by line (description + unit price).
  const changes: string[] = [];
  const prevById = new Map(rev.lineItems.map((l) => [l.id, l]));
  for (const l of input.lines) {
    const prev = l.sourceId ? prevById.get(l.sourceId) : undefined;
    const unit = normalizeUnitPrice(l.kind, l.unitPriceCents);
    if (prev && (prev.unitPriceCents !== unit || prev.quantity !== l.quantity)) {
      changes.push(`${l.description}: ${prev.quantity} × ${formatCents(prev.unitPriceCents)} → ${l.quantity} × ${formatCents(unit)}`);
    } else if (!prev) {
      changes.push(`added ${l.description} ${l.quantity} × ${formatCents(unit)}`);
    }
  }
  const keptIds = new Set(input.lines.map((l) => l.sourceId));
  for (const prev of rev.lineItems) if (!keptIds.has(prev.id)) changes.push(`removed ${prev.description}`);

  await prisma.$transaction(async (tx) => {
    await tx.quoteLineItem.deleteMany({ where: { revisionId: rev.id } });
    await tx.quoteRevision.update({
      where: { id: rev.id },
      data: {
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        customerAddress: input.customerAddress,
        customerNotes: input.customerNotes,
        terms: input.terms,
        expiresAt: input.expiresAt,
        leadTime: input.leadTime,
        estimatedCompletion: input.estimatedCompletion,
        deliveryDetails: input.deliveryDetails,
        ...deposit,
        ...totalsFields(totals),
        lineItems: { create: lineCreates(lines) },
      },
    });
    if (quote.status === "NEW") {
      await tx.quoteRequest.update({ where: { id: quoteId }, data: { status: "DRAFT", statusEvents: { create: { fromStatus: "NEW", toStatus: "DRAFT", authorId: actor.id } } } });
    }
  });

  if (changes.length || totals.totalCents !== rev.totalCents) {
    await logActivity(
      "quote.pricing_changed",
      `${actor.name} edited ${quote.number} rev ${rev.number}: total ${formatCents(rev.totalCents)} → ${formatCents(totals.totalCents)}${changes.length ? `; ${changes.slice(0, 6).join("; ")}${changes.length > 6 ? "; …" : ""}` : ""}`,
      { actorId: actor.id, entityType: "quote", entityId: quoteId },
    );
  }
  return totals;
}

/** Start a new DRAFT revision from the latest one (sent revisions stay untouched). */
export async function createRevision(actor: Actor, quoteId: string) {
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
  if (!quote?.currentRevision) throw new SalesError("That quote no longer exists.");
  assertNotVoided(quote);
  if (quote.currentRevision.status === "DRAFT") return quote.currentRevision;
  if (["ACCEPTED", "CONVERTED_TO_INVOICE", "COMPLETED"].includes(quote.status)) throw new SalesError("This quote has been accepted. Duplicate it to quote something new.");
  const prev = quote.currentRevision;
  const rev = await prisma.$transaction(async (tx) => {
    const created = await tx.quoteRevision.create({
      data: {
        quoteId,
        number: prev.number + 1,
        status: "DRAFT",
        customerName: prev.customerName,
        customerEmail: prev.customerEmail,
        customerPhone: prev.customerPhone,
        customerAddress: prev.customerAddress,
        customerNotes: prev.customerNotes,
        terms: prev.terms,
        expiresAt: null,
        leadTime: prev.leadTime,
        estimatedCompletion: prev.estimatedCompletion,
        deliveryDetails: prev.deliveryDetails,
        depositType: prev.depositType,
        depositPercentBps: prev.depositPercentBps,
        depositAmountCents: prev.depositAmountCents,
        taxCents: prev.taxCents,
        subtotalCents: prev.subtotalCents,
        discountCents: prev.discountCents,
        deliveryCents: prev.deliveryCents,
        otherChargesCents: prev.otherChargesCents,
        totalCents: prev.totalCents,
        depositCents: prev.depositCents,
        balanceCents: prev.balanceCents,
        createdById: actor.id,
        lineItems: {
          create: prev.lineItems.map((l) => ({
            position: l.position,
            kind: l.kind,
            description: l.description,
            notes: l.notes,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            lineTotalCents: l.lineTotalCents,
            taxable: l.taxable,
            productId: l.productId,
            configuration: (l.configuration ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
        },
      },
    });
    await tx.quoteRequest.update({ where: { id: quoteId }, data: { currentRevisionId: created.id } });
    return created;
  });
  await logActivity("quote.revised", `${actor.name} started revision ${rev.number} of ${quote.number}`, { actorId: actor.id, entityType: "quote", entityId: quoteId });
  return rev;
}

/** The revision the customer sees: the newest one that has been sent (drafts are never shown). */
export function customerRevisionOf<T extends { status: string; number: number }>(revisions: T[]): T | null {
  return [...revisions].filter((r) => r.status !== "DRAFT" && r.status !== "SUPERSEDED").sort((a, b) => b.number - a.number)[0] ?? null;
}

/**
 * Send the current DRAFT revision to the customer: it becomes SENT (read-only
 * forever), any earlier sent revision becomes SUPERSEDED (no longer
 * acceptable), and the customer is emailed a link to /quote/[token].
 */
export async function sendQuote(actor: Actor, quoteId: string): Promise<SendResult> {
  await ensureQuoteReady(quoteId);
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { currentRevision: { include: { lineItems: true } }, revisions: true } });
  if (!quote?.currentRevision) throw new SalesError("That quote no longer exists.");
  const rev = quote.currentRevision;
  assertNotVoided(quote);
  if (rev.status !== "DRAFT") throw new SalesError("This revision was already sent. Create a new revision to send changes, or resend the email.");
  if (["ACCEPTED", "CONVERTED_TO_INVOICE", "COMPLETED", "CANCELED"].includes(quote.status)) throw new SalesError(`This quote is ${QUOTE_STATUS_LABELS[quote.status].toLowerCase()}.`);
  if (rev.lineItems.length === 0) throw new SalesError("Add at least one line item before sending.");
  if (rev.totalCents <= 0) throw new SalesError("The quote total must be more than $0.");
  if (!rev.customerEmail) throw new SalesError("Add the customer's email address.");
  const settings = await getSettings();
  const now = new Date();
  if (rev.expiresAt && rev.expiresAt <= now) throw new SalesError("The expiration date is in the past.");
  const expiresAt = rev.expiresAt ?? new Date(now.getTime() + settings.quoteValidDays * DAY);
  const wasSentBefore = quote.revisions.some((r) => r.id !== rev.id && r.sentAt);
  const superseded = quote.revisions.filter((r) => r.id !== rev.id && (r.status === "SENT" || r.status === "DECLINED"));

  await prisma.$transaction(async (tx) => {
    await tx.quoteRevision.updateMany({ where: { quoteId, id: { not: rev.id }, status: { in: ["SENT", "DECLINED"] } }, data: { status: "SUPERSEDED" } });
    await tx.quoteRevision.update({ where: { id: rev.id }, data: { status: "SENT", sentAt: now, expiresAt } });
    await tx.quoteRequest.update({ where: { id: quoteId }, data: { status: "SENT", statusEvents: { create: { fromStatus: quote.status, toStatus: "SENT", authorId: actor.id } } } });
    await recordCustomerActivity(tx, { customerId: quote.customerId, type: "quote.sent", message: `Quote ${quote.number} revision ${rev.number} sent (${formatCents(rev.totalCents)})`, quoteId, actorId: actor.id });
  });
  await logActivity("quote.sent", `${actor.name} sent ${quote.number} rev ${rev.number} (${formatCents(rev.totalCents)}) to ${rev.customerEmail}`, { actorId: actor.id, entityType: "quote", entityId: quoteId });
  for (const old of superseded) {
    await logActivity("quote.superseded", `${quote.number} rev ${old.number} superseded by rev ${rev.number} (sent by ${actor.name}); kept for history, no longer acceptable`, { actorId: actor.id, entityType: "quote", entityId: quoteId });
  }
  return emailQuote(quoteId, wasSentBefore ? "quote_revised" : "quote_sent");
}

async function emailQuote(quoteId: string, template: "quote_sent" | "quote_revised"): Promise<SendResult> {
  const quote = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quoteId }, include: { revisions: true } });
  const rev = customerRevisionOf(quote.revisions);
  if (!rev || !quote.customerToken) throw new SalesError("Send the quote first.");
  return sendTemplateEmail({
    template,
    to: rev.customerEmail,
    vars: {
      customerName: rev.customerName,
      quoteNumber: quote.number,
      revisionNumber: rev.number,
      total: formatCents(rev.totalCents),
      deposit: rev.depositCents > 0 ? formatCents(rev.depositCents) : "No deposit",
      expiresOn: rev.expiresAt ? siteDateLong(new Date(rev.expiresAt.getTime() - 1)) : null,
    },
    actionUrl: customerLinks.quote(quote.customerToken),
    links: { customerId: quote.customerId, quoteId },
  });
}

/** Re-send the quote email for the revision the customer currently sees. */
export async function resendQuote(actor: Actor, quoteId: string) {
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { revisions: true } });
  if (!quote) throw new SalesError("That quote no longer exists.");
  assertNotVoided(quote);
  const rev = customerRevisionOf(quote.revisions);
  if (!rev) throw new SalesError("This quote hasn't been sent yet.");
  const result = await emailQuote(quoteId, rev.number > 1 ? "quote_revised" : "quote_sent");
  await logActivity("quote.sent", `${actor.name} resent ${quote.number} to ${rev.customerEmail}`, { actorId: actor.id, entityType: "quote", entityId: quoteId });
  return result;
}

/* ------------------------------------------------------------ customer actions */

/** Mark SENT/VIEWED quotes whose customer revision has passed its expiration as EXPIRED. */
export async function expireDueQuotes(now = new Date()) {
  const due = await prisma.quoteRequest.findMany({
    where: { status: { in: ["SENT", "VIEWED"] }, revisions: { some: { status: "SENT", expiresAt: { lte: now } } } },
    include: { revisions: true },
  });
  let expired = 0;
  for (const q of due) {
    const rev = customerRevisionOf(q.revisions);
    if (!rev || rev.status !== "SENT" || !rev.expiresAt || rev.expiresAt > now) continue;
    await prisma.$transaction(async (tx) => {
      const res = await tx.quoteRequest.updateMany({ where: { id: q.id, status: { in: ["SENT", "VIEWED"] } }, data: { status: "EXPIRED" } });
      if (!res.count) return;
      await tx.statusEvent.create({ data: { quoteRequestId: q.id, fromStatus: q.status, toStatus: "EXPIRED" } });
      await recordCustomerActivity(tx, { customerId: q.customerId, type: "quote.expired", message: `Quote ${q.number} expired`, quoteId: q.id });
      expired++;
    });
  }
  return expired;
}

/** First view of a sent revision by the customer (SENT → VIEWED). */
export async function recordQuoteView(quoteId: string, revisionId: string, meta: CustomerMeta) {
  const now = new Date();
  const res = await prisma.quoteRevision.updateMany({ where: { id: revisionId, quoteId, status: "SENT", viewedAt: null }, data: { viewedAt: now } });
  if (!res.count) return false;
  const quote = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quoteId } });
  await prisma.$transaction(async (tx) => {
    if (quote.status === "SENT") {
      await tx.quoteRequest.update({ where: { id: quoteId }, data: { status: "VIEWED", statusEvents: { create: { fromStatus: "SENT", toStatus: "VIEWED" } } } });
    }
    await recordCustomerActivity(tx, { customerId: quote.customerId, type: "quote.viewed", message: `Quote ${quote.number} viewed by the customer`, quoteId });
  });
  await logActivity("quote.viewed", `Customer viewed ${quote.number}`, { entityType: "quote", entityId: quoteId });
  void meta;
  return true;
}

/** Why a quote can't be accepted right now, or null if it can. */
export function acceptBlocker(
  quote: { status: QuoteStatus; archivedAt: Date | null },
  rev: { status: string; expiresAt: Date | null } | null,
  now = new Date(),
): string | null {
  if (quote.status === "VOIDED") return VOIDED_QUOTE_MESSAGE;
  if (!rev) return "This quote isn't ready yet.";
  if (quote.archivedAt || quote.status === "CANCELED") return "This quote has been canceled.";
  if (["ACCEPTED", "CONVERTED_TO_INVOICE", "COMPLETED"].includes(quote.status) || rev.status === "ACCEPTED") return "This quote has already been accepted.";
  if (quote.status === "DECLINED" || rev.status === "DECLINED") return "This quote was declined.";
  if (rev.status === "SUPERSEDED") return "This quote has been updated. Please review the latest version.";
  if (quote.status === "EXPIRED" || (rev.expiresAt && rev.expiresAt <= now)) return "This quote has expired. Please contact us and we'll be glad to update it.";
  if (rev.status !== "SENT" || !["SENT", "VIEWED"].includes(quote.status)) return "This quote can't be accepted right now.";
  return null;
}

export interface AcceptedSnapshot {
  version: 1;
  quoteNumber: string | null;
  revisionNumber: number;
  acceptedAt: string;
  acceptedName: string;
  method: "online" | "manual";
  agreements: string[];
  customer: { name: string; email: string; phone: string | null; address: string | null };
  lines: Array<{ kind: string; description: string; notes: string | null; quantity: number; unitPriceCents: number; lineTotalCents: number }>;
  totals: Totals;
  deposit: { type: string; percentBps: number | null; amountCents: number | null; label: string };
  terms: string | null;
  expiresAt: string | null;
  leadTime: string | null;
  estimatedCompletion: string | null;
  deliveryDetails: string | null;
  customerNotes: string | null;
}

export function depositLabel(rev: { depositType: string; depositPercentBps: number | null; depositCents: number }) {
  if (rev.depositType === "PERCENTAGE" && rev.depositPercentBps != null) return `${formatBps(rev.depositPercentBps)} deposit (${formatCents(rev.depositCents)})`;
  if (rev.depositType === "FIXED_AMOUNT") return `${formatCents(rev.depositCents)} deposit`;
  return "No deposit";
}

function acceptedSnapshot(quote: { number: string | null }, rev: RevisionWithLines, at: Date, name: string, method: "online" | "manual", agreements: string[]): AcceptedSnapshot {
  return {
    version: 1,
    quoteNumber: quote.number,
    revisionNumber: rev.number,
    acceptedAt: at.toISOString(),
    acceptedName: name,
    method,
    agreements,
    customer: { name: rev.customerName, email: rev.customerEmail, phone: rev.customerPhone, address: rev.customerAddress },
    lines: [...rev.lineItems].sort((a, b) => a.position - b.position).map((l) => ({ kind: l.kind, description: l.description, notes: l.notes, quantity: l.quantity, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents })),
    totals: {
      subtotalCents: rev.subtotalCents,
      discountCents: rev.discountCents,
      deliveryCents: rev.deliveryCents,
      otherChargesCents: rev.otherChargesCents,
      taxCents: rev.taxCents,
      totalCents: rev.totalCents,
      depositCents: rev.depositCents,
      balanceCents: rev.balanceCents,
    },
    deposit: { type: rev.depositType, percentBps: rev.depositPercentBps, amountCents: rev.depositAmountCents, label: depositLabel(rev) },
    terms: rev.terms,
    expiresAt: rev.expiresAt?.toISOString() ?? null,
    leadTime: rev.leadTime,
    estimatedCompletion: rev.estimatedCompletion,
    deliveryDetails: rev.deliveryDetails,
    customerNotes: rev.customerNotes,
  };
}

async function finalizeAcceptance(
  quoteId: string,
  revisionId: string,
  opts: { name: string; method: "online" | "manual"; agreements: string[]; meta: CustomerMeta; actorId: string | null; online: boolean },
) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const quote = await tx.quoteRequest.findUniqueOrThrow({ where: { id: quoteId }, include: { revisions: true } });
    const rev = await tx.quoteRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { lineItems: true } });
    const current = customerRevisionOf(quote.revisions);
    if (!current || current.id !== rev.id) throw new SalesError("This quote has been updated. Please review the latest version.");
    const blocker = acceptBlocker(quote, rev, now);
    if (blocker) throw new SalesError(blocker);
    // Conditional update: only one acceptance can ever win, even if two arrive at once.
    const won = await tx.quoteRevision.updateMany({
      where: { id: rev.id, status: "SENT" },
      data: {
        status: "ACCEPTED",
        acceptedAt: now,
        acceptedName: opts.name,
        acceptedIp: opts.meta.ip,
        acceptedUserAgent: opts.meta.userAgent,
        acceptedManuallyById: opts.actorId,
        acceptedSnapshot: acceptedSnapshot(quote, rev, now, opts.name, opts.method, opts.agreements) as unknown as Prisma.InputJsonValue,
      },
    });
    if (!won.count) throw new SalesError("This quote has already been accepted.");
    // Never accept a quote that was voided a moment ago.
    const accepted = await tx.quoteRequest.updateMany({ where: { id: quoteId, status: quote.status }, data: { status: "ACCEPTED", acceptedRevisionId: rev.id } });
    if (!accepted.count) throw new SalesError("This quote just changed. Please reload the page.");
    await tx.statusEvent.create({ data: { quoteRequestId: quoteId, fromStatus: quote.status, toStatus: "ACCEPTED", authorId: opts.actorId } });
    const order = await createOrderFromRevision(tx, quote, rev);
    // The deposit is requested straight away (no draft for staff to send):
    // online it's paid through Stripe Checkout right after acceptance.
    let depositInvoice = null;
    if (rev.depositCents > 0) depositInvoice = await createInvoiceForOrder(tx, order.id, "DEPOSIT", opts.actorId, { issue: true, online: opts.online });
    await recordCustomerActivity(tx, {
      customerId: quote.customerId,
      type: "quote.accepted",
      message: `Quote ${quote.number} revision ${rev.number} accepted ${opts.method === "manual" ? "(recorded by staff)" : "online"} by ${opts.name}`,
      quoteId,
      orderId: order.id,
      actorId: opts.actorId,
    });
    return { quote, rev, order, depositInvoice };
  });
}

/**
 * Emails after acceptance. When the customer is about to pay the deposit
 * online (Stripe Checkout right now), their confirmation is sent after the
 * verified payment instead ("deposit_received") — never a promise of an
 * invoice they don't need.
 */
async function afterAcceptance(r: Awaited<ReturnType<typeof finalizeAcceptance>>, opts: { payingNow: boolean; online: boolean }) {
  const { quote, rev, order } = r;
  const deposit = rev.depositCents > 0 ? formatCents(rev.depositCents) : null;
  const settings = await getSettings();
  const vars = {
    customerName: rev.customerName,
    quoteNumber: quote.number,
    orderNumber: order.number,
    total: formatCents(rev.totalCents),
    deposit,
    nextStep: !deposit
      ? "We'll be in touch shortly to confirm the details and schedule your piece."
      : opts.online
        ? `Your ${deposit} deposit is due to begin. You can pay it securely from your order page at any time.`
        : `Your ${deposit} deposit is due to begin. ${settings.paymentInstructions?.trim() || "Payment details are on your order page."}`,
  };
  const links = { customerId: quote.customerId, quoteId: quote.id, orderId: order.id };
  if (!opts.payingNow) {
    await sendTemplateEmail({ template: "quote_accepted", to: rev.customerEmail, vars, actionUrl: order.customerToken ? customerLinks.order(order.customerToken) : null, links });
  }
  await sendTemplateEmail({ template: "admin_quote_accepted", to: await adminRecipient(), vars, actionUrl: adminLinks.order(order.id), links: { quoteId: quote.id, orderId: order.id } });
}

/**
 * Customer acceptance from /quote/[token]. Requires the typed name and both
 * confirmations; records time, IP, user agent, revision and a frozen copy of
 * everything accepted. Creates the order and, when a deposit is required,
 * the deposit request. `payNow`: continue straight to Stripe Checkout.
 */
export async function acceptQuote(token: string, input: { revisionNumber: number; name: string; agreeTerms: boolean; agreeDeposit: boolean }, meta: CustomerMeta) {
  const quote = await prisma.quoteRequest.findUnique({ where: { customerToken: token }, include: { revisions: true } });
  if (!quote) throw new SalesError("This quote link is not valid.");
  const rev = customerRevisionOf(quote.revisions);
  if (!rev || rev.number !== input.revisionNumber) throw new SalesError("This quote has been updated. Please review the latest version.");
  if (!input.agreeTerms || !input.agreeDeposit) throw new SalesError("Please confirm both statements to accept.", { ...(input.agreeTerms ? {} : { agreeTerms: "Required." }), ...(input.agreeDeposit ? {} : { agreeDeposit: "Required." }) });
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new SalesError("Please type your full name to accept.", { name: "Type your full name." });
  const agreements = [ACCEPT_TERMS_LABEL, rev.depositCents > 0 ? ACCEPT_DEPOSIT_LABEL : ACCEPT_NO_DEPOSIT_LABEL];
  const online = salesFlags(await getSettings()).onlinePayments;
  const result = await finalizeAcceptance(quote.id, rev.id, { name, method: "online", agreements, meta, actorId: null, online });
  const payNow = online && rev.depositCents > 0;
  await logActivity("quote.accepted", `${name} accepted ${quote.number} rev ${rev.number} online (${formatCents(rev.totalCents)}); order ${result.order.number} created${payNow ? "; continuing to deposit payment" : ""}`, {
    entityType: "quote",
    entityId: quote.id,
  });
  await afterAcceptance(result, { payingNow: payNow, online });
  return { order: result.order, payNow };
}

/** Staff record an acceptance received by phone, email or in person. */
export async function acceptQuoteManually(actor: Actor, quoteId: string, note: string) {
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { revisions: true } });
  if (!quote) throw new SalesError("That quote no longer exists.");
  assertNotVoided(quote);
  const rev = customerRevisionOf(quote.revisions);
  if (!rev) throw new SalesError("Send the quote before recording an acceptance.");
  const online = salesFlags(await getSettings()).onlinePayments;
  const result = await finalizeAcceptance(quote.id, rev.id, { name: rev.customerName, method: "manual", agreements: [`Recorded by ${actor.name}: ${note}`], meta: { ip: null, userAgent: null }, actorId: actor.id, online });
  await logActivity("quote.accepted", `${actor.name} recorded acceptance of ${quote.number} rev ${rev.number}: ${note}`.slice(0, 480), { actorId: actor.id, entityType: "quote", entityId: quote.id });
  await afterAcceptance(result, { payingNow: false, online });
  return result.order;
}

/** Customer declines from /quote/[token] (reason optional). */
export async function declineQuote(token: string, input: { revisionNumber: number; reason: string | null }, meta: CustomerMeta) {
  const quote = await prisma.quoteRequest.findUnique({ where: { customerToken: token }, include: { revisions: true } });
  if (!quote) throw new SalesError("This quote link is not valid.");
  const rev = customerRevisionOf(quote.revisions);
  if (!rev || rev.number !== input.revisionNumber) throw new SalesError("This quote has been updated. Please review the latest version.");
  const blocker = acceptBlocker(quote, rev);
  if (blocker && !blocker.includes("expired")) throw new SalesError(blocker);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const res = await tx.quoteRevision.updateMany({ where: { id: rev.id, status: "SENT" }, data: { status: "DECLINED", declinedAt: now, declineReason: input.reason } });
    if (!res.count) throw new SalesError("This quote can't be declined now.");
    await tx.quoteRequest.update({ where: { id: quote.id }, data: { status: "DECLINED", statusEvents: { create: { fromStatus: quote.status, toStatus: "DECLINED" } } } });
    await recordCustomerActivity(tx, { customerId: quote.customerId, type: "quote.declined", message: `Quote ${quote.number} declined${input.reason ? `: ${input.reason}` : ""}`, quoteId: quote.id });
  });
  await logActivity("quote.declined", `Customer declined ${quote.number}${meta.ip ? ` (from ${meta.ip})` : ""}`, { entityType: "quote", entityId: quote.id });
  await sendTemplateEmail({
    template: "admin_quote_declined",
    to: await adminRecipient(),
    vars: { customerName: rev.customerName, quoteNumber: quote.number, reason: input.reason || "No reason given" },
    actionUrl: adminLinks.quote(quote.id),
    links: { quoteId: quote.id, customerId: quote.customerId },
  });
}

/* ------------------------------------------------------------ admin actions */

/** Give the customer more time: sets a new expiration on the sent revision and reopens an EXPIRED quote. */
export async function extendQuote(actor: Actor, quoteId: string, expiresAt: Date) {
  if (expiresAt <= new Date()) throw new SalesError("Choose a date in the future.", { expiresOn: "Must be in the future." });
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { revisions: true } });
  if (!quote) throw new SalesError("That quote no longer exists.");
  assertNotVoided(quote);
  const rev = customerRevisionOf(quote.revisions);
  if (!rev || rev.status !== "SENT") throw new SalesError("Only a sent, unanswered quote can be extended.");
  const reopen = quote.status === "EXPIRED";
  const to: QuoteStatus = rev.viewedAt ? "VIEWED" : "SENT";
  await prisma.$transaction(async (tx) => {
    await tx.quoteRevision.update({ where: { id: rev.id }, data: { expiresAt } });
    if (reopen) await tx.quoteRequest.update({ where: { id: quoteId }, data: { status: to, statusEvents: { create: { fromStatus: "EXPIRED", toStatus: to, authorId: actor.id } } } });
    await recordCustomerActivity(tx, { customerId: quote.customerId, type: "quote.extended", message: `Quote ${quote.number} extended to ${siteDateLong(new Date(expiresAt.getTime() - 1))}`, quoteId, actorId: actor.id });
  });
  await logActivity("quote.extended", `${actor.name} extended ${quote.number} to ${siteDateLong(new Date(expiresAt.getTime() - 1))}`, { actorId: actor.id, entityType: "quote", entityId: quoteId });
}

/** Statuses an admin may set directly; the others result from sending, accepting and invoicing. */
/** (Canceling is now "Void quote", which records who, when and why.) */
export const MANUAL_QUOTE_STATUSES: QuoteStatus[] = ["NEW", "REVIEWING", "DRAFT", "DECLINED", "EXPIRED", "COMPLETED"];

export async function setQuoteStatus(actor: Actor, quoteId: string, status: QuoteStatus, note: string | null) {
  if (!MANUAL_QUOTE_STATUSES.includes(status)) throw new SalesError("That status is set automatically.");
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  if (!quote) throw new SalesError("That quote no longer exists.");
  if (quote.status === "VOIDED") throw new SalesError("This quote is voided. Reopen it (if allowed) or duplicate it instead.");
  if (quote.status === status) return;
  if (["ACCEPTED", "CONVERTED_TO_INVOICE"].includes(quote.status) && status !== "COMPLETED" && status !== "CANCELED") {
    throw new SalesError("This quote was accepted — manage it from its order.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.quoteRequest.update({ where: { id: quoteId }, data: { status, readAt: quote.readAt ?? new Date(), statusEvents: { create: { fromStatus: quote.status, toStatus: status, authorId: actor.id } } } });
    if (note) await tx.internalNote.create({ data: { body: note, authorId: actor.id, quoteRequestId: quoteId } });
  });
  await logActivity("quote.status_changed", `${actor.name} changed ${quote.number ?? quote.reference} from ${QUOTE_STATUS_LABELS[quote.status]} to ${QUOTE_STATUS_LABELS[status]}`, { actorId: actor.id, entityType: "quote", entityId: quoteId });
}

/** Copy a quote into a brand-new one (new number and link). Acceptance, invoices and payments are never copied. */
export async function duplicateQuote(actor: Actor, quoteId: string) {
  const src = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { currentRevision: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
  if (!src) throw new SalesError("That quote no longer exists.");
  const rev = src.currentRevision;
  const lines: DraftLine[] = (rev?.lineItems ?? []).map((l) => ({
    kind: l.kind as LineKind,
    description: l.description,
    notes: l.notes,
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    taxable: l.taxable,
    productId: l.productId,
    configuration: l.configuration as ConfigurationSnapshot | null,
  }));
  const copy = await prisma.$transaction(async (tx) => {
    const q = await createQuoteRecord(tx, {
      source: "MANUAL",
      name: rev?.customerName ?? src.name,
      email: rev?.customerEmail ?? src.email,
      phone: rev?.customerPhone ?? src.phone,
      zipCode: src.zipCode,
      address: rev?.customerAddress ?? src.address,
      quantity: src.quantity,
      productId: src.productId,
      productName: src.productName,
      notes: `Duplicated from ${src.number ?? src.reference}`,
      lines,
      createdById: actor.id,
      status: "DRAFT",
    });
    if (rev) {
      const deposit = { depositType: rev.depositType as DepositType, depositPercentBps: rev.depositPercentBps, depositAmountCents: rev.depositAmountCents };
      await tx.quoteRevision.update({
        where: { id: q.currentRevisionId },
        data: {
          customerNotes: rev.customerNotes,
          terms: rev.terms,
          leadTime: rev.leadTime,
          estimatedCompletion: rev.estimatedCompletion,
          deliveryDetails: rev.deliveryDetails,
          ...deposit,
          ...totalsFields(computeTotals(lines as LineInput[], deposit, rev.taxCents)),
        },
      });
    }
    return q;
  });
  await logActivity("quote.duplicated", `${actor.name} duplicated ${src.number ?? src.reference} as ${copy.number}`, { actorId: actor.id, entityType: "quote", entityId: copy.id });
  return copy;
}

export async function setQuoteArchived(actor: Actor, quoteId: string, archived: boolean) {
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId } });
  if (!quote) throw new SalesError("That quote no longer exists.");
  await prisma.quoteRequest.update({ where: { id: quoteId }, data: { archivedAt: archived ? new Date() : null } });
  await logActivity("quote.status_changed", `${actor.name} ${archived ? "archived" : "restored"} ${quote.number ?? quote.reference}`, { actorId: actor.id, entityType: "quote", entityId: quoteId });
}

/* ------------------------------------------------------------ voiding */

function assertNotVoided(quote: { status: QuoteStatus }) {
  if (quote.status === "VOIDED") throw new SalesError("This quote is voided and can't be changed, sent or accepted. Duplicate it to quote again.");
}

/**
 * Void a quote: it stays in history with every revision, customer detail and
 * acceptance record, but can no longer be accepted, invoiced or paid. A quote
 * with a live order or an active invoice must have those dealt with first
 * (cancel the order; void the invoices, refunding any payments), so money
 * records always stay consistent.
 */
export async function voidQuote(actor: Actor, quoteId: string, reason: string) {
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { orders: true, invoices: true } });
  if (!quote) throw new SalesError("That quote no longer exists.");
  if (quote.status === "VOIDED") throw new SalesError("This quote is already voided.");
  const label = quote.number ?? quote.reference;
  const liveOrder = quote.orders.find((o) => o.productionStatus !== "CANCELED");
  if (liveOrder) throw new SalesError(`Order ${liveOrder.number} was created from this quote. Cancel the order (and void or refund its invoices) before voiding the quote.`);
  const liveInvoice = quote.invoices.find((i) => i.status !== "VOID" && i.status !== "CANCELED");
  if (liveInvoice) throw new SalesError(`Invoice ${liveInvoice.number} is still active. Void it first${liveInvoice.amountPaidCents > 0 ? " — it has payments, so record a refund before voiding" : ""}.`);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Conditional: loses cleanly to an acceptance arriving at the same moment.
    const res = await tx.quoteRequest.updateMany({
      where: { id: quoteId, status: quote.status },
      data: { status: "VOIDED", voidedAt: now, voidedById: actor.id, voidReason: reason, voidedFromStatus: quote.status },
    });
    if (!res.count) throw new SalesError("This quote just changed. Reload the page and try again.");
    await tx.statusEvent.create({ data: { quoteRequestId: quoteId, fromStatus: quote.status, toStatus: "VOIDED", authorId: actor.id } });
    await recordCustomerActivity(tx, { customerId: quote.customerId, type: "quote.voided", message: `Quote ${label} voided: ${reason}`, quoteId, actorId: actor.id });
  });
  await logActivity("quote.voided", `${actor.name} voided quote ${label} (was ${QUOTE_STATUS_LABELS[quote.status]}). Reason: ${reason}`.slice(0, 480), { actorId: actor.id, entityType: "quote", entityId: quoteId });
}

/** Statuses a voided quote can safely return to. Anything that got as far as acceptance stays voided. */
const REOPENABLE: QuoteStatus[] = ["NEW", "REVIEWING", "DRAFT", "SENT", "VIEWED", "DECLINED", "EXPIRED"];

/**
 * Owner/Admin: undo a void when nothing has happened since that would make
 * the quote ambiguous. If it ever reached acceptance (order or invoices),
 * duplicate it into a new quote instead.
 */
export async function reopenQuote(actor: Actor, quoteId: string) {
  const quote = await prisma.quoteRequest.findUnique({ where: { id: quoteId }, include: { orders: { select: { id: true } }, invoices: { select: { id: true } } } });
  if (!quote) throw new SalesError("That quote no longer exists.");
  if (quote.status !== "VOIDED") throw new SalesError("Only a voided quote can be reopened.");
  const label = quote.number ?? quote.reference;
  const to = quote.voidedFromStatus;
  if (!to || !REOPENABLE.includes(to) || quote.acceptedRevisionId || quote.orders.length || quote.invoices.length) {
    throw new SalesError("This quote was accepted or invoiced before it was voided, so reopening it would be ambiguous. Duplicate it to create a new quote instead.");
  }
  await prisma.$transaction(async (tx) => {
    const res = await tx.quoteRequest.updateMany({ where: { id: quoteId, status: "VOIDED" }, data: { status: to, voidedAt: null, voidedById: null, voidReason: null, voidedFromStatus: null } });
    if (!res.count) throw new SalesError("This quote just changed. Reload the page and try again.");
    await tx.statusEvent.create({ data: { quoteRequestId: quoteId, fromStatus: "VOIDED", toStatus: to, authorId: actor.id } });
    await recordCustomerActivity(tx, { customerId: quote.customerId, type: "quote.reopened", message: `Quote ${label} reopened`, quoteId, actorId: actor.id });
  });
  await logActivity("quote.reopened", `${actor.name} reopened voided quote ${label} → ${QUOTE_STATUS_LABELS[to]} (it had been voided: ${quote.voidReason ?? "no reason"})`.slice(0, 480), { actorId: actor.id, entityType: "quote", entityId: quoteId });
  // A sent quote may have passed its expiration while voided.
  if (to === "SENT" || to === "VIEWED") await expireDueQuotes();
}
