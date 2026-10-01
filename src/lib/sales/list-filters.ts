import type { InvoiceStatus, Prisma, QuoteStatus } from "@/generated/prisma/client";

/*
 * Admin list filters for quotes and invoices. Voided records are never
 * deleted: they're kept out of the default "Active" view, but they have their
 * own filter, appear under "All", and a search always looks through every
 * record (voided included) by quote/invoice/order number, customer or email.
 */

export interface ListTab<W> {
  key: string;
  label: string;
  where: W;
}

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

export const QUOTE_TABS: ListTab<Prisma.QuoteRequestWhereInput>[] = [
  { key: "", label: "Active", where: { status: { not: "VOIDED" }, archivedAt: null } },
  { key: "action", label: "Needs action", where: { status: { in: ["NEW", "REVIEWING", "DRAFT"] }, archivedAt: null } },
  { key: "waiting", label: "Waiting on customer", where: { status: { in: ["SENT", "VIEWED"] }, archivedAt: null } },
  { key: "accepted", label: "Accepted", where: { status: { in: ["ACCEPTED", "CONVERTED_TO_INVOICE"] }, archivedAt: null } },
  { key: "declined", label: "Declined", where: { status: "DECLINED", archivedAt: null } },
  { key: "expired", label: "Expired", where: { status: "EXPIRED" } },
  { key: "superseded", label: "Superseded", where: { revisions: { some: { status: "SUPERSEDED" } } } },
  { key: "closed", label: "Completed / canceled", where: { status: { in: ["COMPLETED", "CANCELED"] as QuoteStatus[] }, archivedAt: null } },
  { key: "voided", label: "Voided", where: { status: "VOIDED" } },
  { key: "archived", label: "Archived", where: { archivedAt: { not: null } } },
  { key: "all", label: "All", where: {} },
];

export function quoteSearch(q: string): Prisma.QuoteRequestWhereInput {
  if (!q) return {};
  return {
    OR: [
      { number: contains(q) },
      { reference: contains(q) },
      { name: contains(q) },
      { email: contains(q) },
      { phone: { contains: q } },
      { productName: contains(q) },
      { customer: { is: { OR: [{ name: contains(q) }, { email: contains(q) }] } } },
      { revisions: { some: { OR: [{ customerName: contains(q) }, { customerEmail: contains(q) }] } } },
      { orders: { some: { number: contains(q) } } },
      { invoices: { some: { number: contains(q) } } },
    ],
  };
}

/** The default tab only narrows when nothing is searched; a search covers every quote, voided included. */
export function quoteListWhere(tabKey: string, q: string): Prisma.QuoteRequestWhereInput {
  const tab = QUOTE_TABS.find((t) => t.key === tabKey) ?? QUOTE_TABS[0]!;
  const scope = q && tab.key === "" ? {} : tab.where;
  return { AND: [scope, quoteSearch(q)] };
}

export const INVOICE_TABS: ListTab<Prisma.InvoiceWhereInput>[] = [
  { key: "", label: "Active", where: { status: { notIn: ["VOID", "CANCELED"] } } },
  { key: "draft", label: "Drafts", where: { status: "DRAFT" } },
  { key: "unpaid", label: "Unpaid", where: { status: { in: ["SENT", "OPEN", "PARTIALLY_PAID", "PAST_DUE"] as InvoiceStatus[] } } },
  { key: "pastdue", label: "Past due", where: { status: "PAST_DUE" } },
  { key: "paid", label: "Paid", where: { status: "PAID" } },
  { key: "void", label: "Voided", where: { status: { in: ["VOID", "CANCELED"] } } },
  { key: "all", label: "All", where: {} },
];

export function invoiceSearch(q: string): Prisma.InvoiceWhereInput {
  if (!q) return {};
  return {
    OR: [
      { number: contains(q) },
      { customerName: contains(q) },
      { customerEmail: contains(q) },
      { order: { is: { number: contains(q) } } },
      { quote: { is: { number: contains(q) } } },
      { customer: { is: { OR: [{ name: contains(q) }, { email: contains(q) }] } } },
    ],
  };
}

export function invoiceListWhere(tabKey: string, q: string): Prisma.InvoiceWhereInput {
  const tab = INVOICE_TABS.find((t) => t.key === tabKey) ?? INVOICE_TABS[0]!;
  const scope = q && tab.key === "" ? {} : tab.where;
  return { AND: [scope, invoiceSearch(q)] };
}
