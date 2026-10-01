/**
 * Transactional email templates. The copy below is only the starting text:
 * it is inserted into the EmailTemplate table once (src/lib/seed/defaults.ts)
 * and edited in Admin → Settings → Emails after that.
 *
 * Bodies are plain text with blank lines between paragraphs and "- " for
 * bullet lines. {{placeholders}} are filled in (HTML-escaped) when sent; the
 * branded layout, logo and button are added automatically.
 */

export type EmailAudience = "customer" | "admin";

export interface EmailTemplateDefinition {
  key: string;
  name: string;
  description: string;
  audience: EmailAudience;
  /** Placeholders available in subject, heading and body. */
  variables: string[];
  subject: string;
  heading: string;
  body: string;
  /** Button text; the button links to {{actionUrl}}. Null = no button. */
  buttonLabel: string | null;
}

const COMMON = ["customerName", "firstName", "businessName"];

export const EMAIL_TEMPLATES: EmailTemplateDefinition[] = [
  {
    key: "quote_request_received",
    name: "Quote request received",
    description: "Sent to the customer right after they request a quote.",
    audience: "customer",
    variables: [...COMMON, "quoteNumber", "summary", "confirmationText"],
    subject: "We received your request — {{quoteNumber}}",
    heading: "Thank you for your request",
    body: "Hi {{firstName}},\n\n{{confirmationText}}\n\nYour quote number is {{quoteNumber}}.\n\n{{summary}}\n\n{{businessName}}",
    buttonLabel: null,
  },
  {
    key: "admin_new_quote_request",
    name: "New quote request (to you)",
    description: "Notifies Wild Mountain Woodworks about a new quote request.",
    audience: "admin",
    variables: [...COMMON, "quoteNumber", "customerEmail", "customerPhone", "zipCode", "summary", "notes"],
    subject: "New quote request {{quoteNumber}} — {{customerName}}",
    heading: "New quote request",
    body: "{{customerName}} ({{customerEmail}} {{customerPhone}}) requested a quote. ZIP {{zipCode}}.\n\n{{summary}}\n\n{{notes}}",
    buttonLabel: "Open in admin",
  },
  {
    key: "quote_sent",
    name: "Quote ready",
    description: "Sends the customer a link to view and accept their quote.",
    audience: "customer",
    variables: [...COMMON, "quoteNumber", "revisionNumber", "total", "deposit", "expiresOn"],
    subject: "Your quote from {{businessName}} — {{quoteNumber}}",
    heading: "Your quote is ready",
    body: "Hi {{firstName}},\n\nThank you for your patience. Your quote {{quoteNumber}} is ready to review.\n\n- Total: {{total}}\n- Deposit to begin: {{deposit}}\n- Valid through: {{expiresOn}}\n\nYou can review every detail, ask a question or accept the quote online.\n\n{{businessName}}",
    buttonLabel: "View Quote",
  },
  {
    key: "quote_revised",
    name: "Quote revised",
    description: "Sent when an updated revision of a quote is sent.",
    audience: "customer",
    variables: [...COMMON, "quoteNumber", "revisionNumber", "total", "deposit", "expiresOn"],
    subject: "Updated quote {{quoteNumber}} (revision {{revisionNumber}})",
    heading: "Your quote has been updated",
    body: "Hi {{firstName}},\n\nWe've updated your quote {{quoteNumber}}. The new total is {{total}}, with a deposit of {{deposit}} to begin. This version replaces any earlier one.\n\nValid through {{expiresOn}}.\n\n{{businessName}}",
    buttonLabel: "View Updated Quote",
  },
  {
    key: "quote_accepted",
    name: "Quote accepted (to customer)",
    description: "Confirms to the customer that their acceptance was received.",
    audience: "customer",
    variables: [...COMMON, "quoteNumber", "orderNumber", "total", "deposit", "nextStep"],
    subject: "Thank you — quote {{quoteNumber}} accepted",
    heading: "Thank you for your order",
    body: "Hi {{firstName}},\n\nWe've received your acceptance of quote {{quoteNumber}}. Your order number is {{orderNumber}}.\n\n{{nextStep}}\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "admin_quote_accepted",
    name: "Quote accepted (to you)",
    description: "Tells Wild Mountain Woodworks a customer accepted a quote.",
    audience: "admin",
    variables: [...COMMON, "quoteNumber", "orderNumber", "total"],
    subject: "Quote {{quoteNumber}} accepted by {{customerName}}",
    heading: "Quote accepted",
    body: "{{customerName}} accepted quote {{quoteNumber}} ({{total}}). Order {{orderNumber}} was created. Any deposit is collected online from the customer's order page — no invoice to send.",
    buttonLabel: "Open order",
  },
  {
    key: "admin_quote_declined",
    name: "Quote declined (to you)",
    description: "Tells Wild Mountain Woodworks a customer declined a quote.",
    audience: "admin",
    variables: [...COMMON, "quoteNumber", "reason"],
    subject: "Quote {{quoteNumber}} declined",
    heading: "Quote declined",
    body: "{{customerName}} declined quote {{quoteNumber}}.\n\nReason: {{reason}}",
    buttonLabel: "Open in admin",
  },
  {
    key: "deposit_received",
    name: "Quote accepted & deposit paid",
    description: "Sent once Stripe confirms the deposit a customer paid right after accepting a quote.",
    audience: "customer",
    variables: [...COMMON, "quoteNumber", "orderNumber", "amountPaid", "balanceRemaining"],
    subject: "Thank you — order {{orderNumber}} is confirmed",
    heading: "Thank you for your order",
    body: "Hi {{firstName}},\n\nThank you for your order. We've received your acceptance of quote {{quoteNumber}} and your {{amountPaid}} deposit. Your order number is {{orderNumber}}.\n\nYour piece is now ready to move into the next stage of production.\n\nRemaining balance: {{balanceRemaining}}, invoiced before delivery.\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "deposit_payment_request",
    name: "Deposit payment link",
    description: "Sends the secure link to pay an order's deposit (resent from admin, or once after an unfinished checkout).",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "amountDue"],
    subject: "Your deposit for order {{orderNumber}}",
    heading: "Your deposit is due",
    body: "Hi {{firstName}},\n\nYour order {{orderNumber}} is reserved and waiting on its {{amountDue}} deposit. Production begins as soon as it's paid.\n\nUse the button below to pay securely by card — the link always opens a fresh, secure payment page.\n\n{{businessName}}",
    buttonLabel: "Pay Deposit",
  },
  {
    key: "invoice_sent",
    name: "Invoice link",
    description: "Sends (or resends) the link to the customer's Wild Mountain Woodworks invoice page.",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "total", "amountPaid", "balanceRemaining", "amountDue", "paymentInstructions"],
    subject: "Invoice {{invoiceNumber}} — {{businessName}}",
    heading: "Your invoice",
    body: "Hi {{firstName}},\n\nHere is your invoice {{invoiceNumber}} for order {{orderNumber}}.\n\n- Total: {{total}}\n- Paid so far: {{amountPaid}}\n- Remaining balance: {{balanceRemaining}}\n\n{{paymentInstructions}}\n\n{{businessName}}",
    buttonLabel: "View Invoice",
  },
  {
    key: "invoice_reminder",
    name: "Invoice reminder",
    description: "A friendly reminder for an unpaid balance (sent manually).",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "amountDue", "balanceRemaining", "paymentInstructions"],
    subject: "Reminder: invoice {{invoiceNumber}}",
    heading: "A friendly reminder",
    body: "Hi {{firstName}},\n\nThis is a reminder that {{amountDue}} is due on invoice {{invoiceNumber}}. If you've already paid, thank you — please disregard this note.\n\n{{paymentInstructions}}\n\n{{businessName}}",
    buttonLabel: "View Invoice & Pay",
  },
  {
    key: "balance_due",
    name: "Final balance due",
    description: "Sent when you mark the balance due. Links to the same Wild Mountain Woodworks invoice page, where the customer can pay.",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "total", "amountPaid", "balanceRemaining", "amountDue"],
    subject: "Your final balance is ready — order {{orderNumber}}",
    heading: "Your final balance is ready",
    body: "Hi {{firstName}},\n\nYour Wild Mountain Woodworks order {{orderNumber}} is nearing completion.\n\n- Order total: {{total}}\n- Paid so far: {{amountPaid}}\n- Remaining balance: {{balanceRemaining}}\n\nYou can review your invoice and pay the remaining balance securely from the button below.\n\n{{businessName}}",
    buttonLabel: "View Invoice & Pay Balance",
  },
  {
    key: "payment_received",
    name: "Payment received",
    description: "Receipt sent to the customer when a payment is confirmed or recorded.",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "amountPaid", "paymentMethod", "paymentFor", "balanceRemaining"],
    subject: "Payment received — thank you",
    heading: "Payment received",
    body: "Hi {{firstName}},\n\nWe received your payment of {{amountPaid}} ({{paymentMethod}}) toward invoice {{invoiceNumber}}.\n\nRemaining balance on order {{orderNumber}}: {{balanceRemaining}}.\n\n{{businessName}}",
    buttonLabel: "View Invoice",
  },
  {
    key: "admin_payment_received",
    name: "Payment received (to you)",
    description: "Tells Wild Mountain Woodworks an online payment was confirmed by Stripe.",
    audience: "admin",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "amountPaid"],
    subject: "Payment {{amountPaid}} received — {{invoiceNumber}}",
    heading: "Payment received",
    body: "{{customerName}} paid {{amountPaid}} on invoice {{invoiceNumber}} (order {{orderNumber}}).",
    buttonLabel: "Open invoice",
  },
  {
    key: "order_confirmed",
    name: "Status: Order confirmed",
    description: "Sent when an order moves to Order confirmed (not when the deposit confirmation already said so).",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "status", "estimatedCompletion"],
    subject: "Your order {{orderNumber}} is confirmed",
    heading: "Your order is confirmed",
    body: "Hi {{firstName}},\n\nWe've received everything needed to move your Wild Mountain Woodworks piece forward. Order {{orderNumber}} is confirmed and in our queue.\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "order_in_production",
    name: "Status: In production",
    description: "Sent when an order moves to In production.",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "status", "estimatedCompletion"],
    subject: "Your furniture is in production — order {{orderNumber}}",
    heading: "Your furniture is now in production",
    body: "Hi {{firstName}},\n\nWe're actively working on your Wild Mountain Woodworks piece (order {{orderNumber}}).\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "order_ready",
    name: "Status: Ready for delivery",
    description: "Sent when an order moves to Ready for delivery.",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "status"],
    subject: "Your furniture is ready — order {{orderNumber}}",
    heading: "Your furniture is ready",
    body: "Hi {{firstName}},\n\nYour Wild Mountain Woodworks piece is complete and ready for pickup or delivery scheduling. We'll be in touch to arrange a time.\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "delivery_scheduled",
    name: "Status: Delivery scheduled",
    description: "Sent when an order moves to Delivery scheduled; includes the date, time window and method.",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "status", "deliveryDetails", "deliveryNotes"],
    subject: "Your delivery is scheduled — order {{orderNumber}}",
    heading: "Your delivery has been scheduled",
    body: "Hi {{firstName}},\n\nYour order {{orderNumber}} is scheduled:\n\n- {{deliveryDetails}}\n\n{{deliveryNotes}}\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "order_completed",
    name: "Status: Completed",
    description: "Thanks the customer when an order is complete.",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "status"],
    subject: "Thank you — order {{orderNumber}} is complete",
    heading: "Your Wild Mountain Woodworks order is complete",
    body: "Hi {{firstName}},\n\nThank you for trusting us with order {{orderNumber}}. We hope it brings you many years of use. Care instructions are always on our website.\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "order_canceled",
    name: "Status: Canceled",
    description: "Sent when an order is canceled (unless you untick the email).",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "status"],
    subject: "Order {{orderNumber}} has been canceled",
    heading: "Your order has been canceled",
    body: "Hi {{firstName}},\n\nYour order {{orderNumber}} has been canceled. If you have questions about any payment already made, just reply to this email and we'll help.\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
];

export const EMAIL_TEMPLATE_KEYS = EMAIL_TEMPLATES.map((t) => t.key);

export function templateDefinition(key: string): EmailTemplateDefinition | undefined {
  return EMAIL_TEMPLATES.find((t) => t.key === key);
}
