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
    description: "Notifies Wild Mountain about a new quote request.",
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
    description: "Tells Wild Mountain a customer accepted a quote.",
    audience: "admin",
    variables: [...COMMON, "quoteNumber", "orderNumber", "total"],
    subject: "Quote {{quoteNumber}} accepted by {{customerName}}",
    heading: "Quote accepted",
    body: "{{customerName}} accepted quote {{quoteNumber}} ({{total}}). Order {{orderNumber}} was created. Next step: send the deposit invoice.",
    buttonLabel: "Open order",
  },
  {
    key: "admin_quote_declined",
    name: "Quote declined (to you)",
    description: "Tells Wild Mountain a customer declined a quote.",
    audience: "admin",
    variables: [...COMMON, "quoteNumber", "reason"],
    subject: "Quote {{quoteNumber}} declined",
    heading: "Quote declined",
    body: "{{customerName}} declined quote {{quoteNumber}}.\n\nReason: {{reason}}",
    buttonLabel: "Open in admin",
  },
  {
    key: "deposit_invoice",
    name: "Deposit invoice",
    description: "Sends the deposit invoice with a link to view and pay.",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "amountDue", "dueDate", "paymentInstructions"],
    subject: "Deposit invoice {{invoiceNumber}} — {{businessName}}",
    heading: "Your deposit invoice",
    body: "Hi {{firstName}},\n\nHere is the deposit invoice for order {{orderNumber}}.\n\n- Amount due: {{amountDue}}\n- Due: {{dueDate}}\n\n{{paymentInstructions}}\n\n{{businessName}}",
    buttonLabel: "View & Pay Invoice",
  },
  {
    key: "balance_invoice",
    name: "Final balance invoice",
    description: "Sends the final balance invoice before delivery.",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "amountDue", "dueDate", "paymentInstructions"],
    subject: "Final invoice {{invoiceNumber}} — {{businessName}}",
    heading: "Your piece is nearly ready",
    body: "Hi {{firstName}},\n\nYour order {{orderNumber}} is almost ready. Here is the invoice for the remaining balance.\n\n- Amount due: {{amountDue}}\n- Due: {{dueDate}}\n\n{{paymentInstructions}}\n\n{{businessName}}",
    buttonLabel: "View & Pay Invoice",
  },
  {
    key: "invoice_sent",
    name: "Invoice (other)",
    description: "Sends any other invoice (full payment or custom).",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "amountDue", "dueDate", "paymentInstructions"],
    subject: "Invoice {{invoiceNumber}} — {{businessName}}",
    heading: "Your invoice",
    body: "Hi {{firstName}},\n\nHere is invoice {{invoiceNumber}}.\n\n- Amount due: {{amountDue}}\n- Due: {{dueDate}}\n\n{{paymentInstructions}}\n\n{{businessName}}",
    buttonLabel: "View & Pay Invoice",
  },
  {
    key: "invoice_reminder",
    name: "Invoice reminder",
    description: "A friendly reminder for an unpaid invoice (sent manually).",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "amountDue", "dueDate", "paymentInstructions"],
    subject: "Reminder: invoice {{invoiceNumber}}",
    heading: "A friendly reminder",
    body: "Hi {{firstName}},\n\nThis is a reminder that invoice {{invoiceNumber}} for {{amountDue}} was due {{dueDate}}. If you've already paid, thank you — please disregard this note.\n\n{{paymentInstructions}}\n\n{{businessName}}",
    buttonLabel: "View & Pay Invoice",
  },
  {
    key: "payment_received",
    name: "Payment received",
    description: "Receipt sent to the customer when a payment is recorded.",
    audience: "customer",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "amountPaid", "paymentMethod", "balanceRemaining"],
    subject: "Payment received — thank you",
    heading: "Payment received",
    body: "Hi {{firstName}},\n\nWe received your payment of {{amountPaid}} ({{paymentMethod}}) for invoice {{invoiceNumber}}.\n\nRemaining balance on order {{orderNumber}}: {{balanceRemaining}}.\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "admin_payment_received",
    name: "Payment received (to you)",
    description: "Tells Wild Mountain an online payment was confirmed by Stripe.",
    audience: "admin",
    variables: [...COMMON, "invoiceNumber", "orderNumber", "amountPaid"],
    subject: "Payment {{amountPaid}} received — {{invoiceNumber}}",
    heading: "Payment received",
    body: "{{customerName}} paid {{amountPaid}} on invoice {{invoiceNumber}} (order {{orderNumber}}).",
    buttonLabel: "Open invoice",
  },
  {
    key: "order_update",
    name: "Order progress update",
    description: "Optional update when an order moves to a new production step.",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "status", "estimatedCompletion"],
    subject: "Update on your order {{orderNumber}}",
    heading: "Your piece is progressing",
    body: "Hi {{firstName}},\n\nA quick update on order {{orderNumber}}: {{status}}.\n\nEstimated completion: {{estimatedCompletion}}\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "delivery_scheduled",
    name: "Delivery scheduled",
    description: "Confirms the delivery date with the customer.",
    audience: "customer",
    variables: [...COMMON, "orderNumber", "deliveryDate", "deliveryNotes"],
    subject: "Delivery scheduled — order {{orderNumber}}",
    heading: "Your delivery is scheduled",
    body: "Hi {{firstName}},\n\nYour piece is scheduled for delivery on {{deliveryDate}}.\n\n{{deliveryNotes}}\n\n{{businessName}}",
    buttonLabel: "View Your Order",
  },
  {
    key: "order_completed",
    name: "Order completed",
    description: "Thanks the customer when an order is complete.",
    audience: "customer",
    variables: [...COMMON, "orderNumber"],
    subject: "Thank you — order {{orderNumber}} is complete",
    heading: "Enjoy your new piece",
    body: "Hi {{firstName}},\n\nThank you for trusting us with order {{orderNumber}}. We hope it brings you many years of use. Care instructions are always on our website.\n\n{{businessName}}",
    buttonLabel: null,
  },
];

export const EMAIL_TEMPLATE_KEYS = EMAIL_TEMPLATES.map((t) => t.key);

export function templateDefinition(key: string): EmailTemplateDefinition | undefined {
  return EMAIL_TEMPLATES.find((t) => t.key === key);
}
