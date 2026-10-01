import { siteUrl } from "@/lib/site-url";

/** Customer-facing secure links (token only — never ids). */
export const customerLinks = {
  quote: (token: string) => siteUrl(`/quote/${token}`),
  invoice: (token: string) => siteUrl(`/invoice/${token}`),
  order: (token: string) => siteUrl(`/order/${token}`),
  /** Opens (or reuses) a Stripe Checkout for the unpaid deposit. */
  depositPay: (token: string) => siteUrl(`/order/${token}/pay`),
  /** Opens (or reuses) a Stripe Checkout for whatever is due on the invoice. */
  invoicePay: (token: string) => siteUrl(`/invoice/${token}/pay`),
};

export const adminLinks = {
  quote: (id: string) => siteUrl(`/admin/quotes/${id}`),
  invoice: (id: string) => siteUrl(`/admin/invoices/${id}`),
  order: (id: string) => siteUrl(`/admin/orders/${id}`),
  customer: (id: string) => siteUrl(`/admin/customers/${id}`),
};
