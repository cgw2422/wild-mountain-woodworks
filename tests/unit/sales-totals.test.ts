import { describe, expect, it } from "vitest";
import { computeTotals, depositFor, formatBps, lineTotal, parsePercentToBps } from "@/lib/sales/totals";
import { renderEmail, fill } from "@/lib/email/render";
import { isTokenShape, newCustomerToken } from "@/lib/sales/tokens";
import { invoiceMoney, invoiceStatusFor, netPaid, orderPaymentStatusFor } from "@/lib/sales/ledger";
import { EMAIL_TEMPLATES } from "@/lib/email/template-definitions";

describe("quote totals (integer cents)", () => {
  it("groups lines into subtotal, discounts, delivery and other charges", () => {
    const t = computeTotals(
      [
        { kind: "PRODUCT", quantity: 2, unitPriceCents: 129500 },
        { kind: "ADDON", quantity: 1, unitPriceCents: 35000 },
        { kind: "CUSTOM", quantity: 1, unitPriceCents: 10000 },
        { kind: "DISCOUNT", quantity: 1, unitPriceCents: 25000 }, // sign normalized
        { kind: "DELIVERY", quantity: 1, unitPriceCents: 15000 },
        { kind: "INSTALLATION", quantity: 1, unitPriceCents: 5000 },
        { kind: "FEE", quantity: 1, unitPriceCents: 1000 },
      ],
      { depositType: "PERCENTAGE", depositPercentBps: 5000 },
      1234,
    );
    expect(t).toEqual({
      subtotalCents: 304000,
      discountCents: 25000,
      deliveryCents: 15000,
      otherChargesCents: 6000,
      taxCents: 1234,
      totalCents: 301234,
      depositCents: 150617,
      balanceCents: 150617,
    });
    expect(lineTotal({ kind: "DISCOUNT", quantity: 3, unitPriceCents: 500 })).toBe(-1500);
  });

  it("computes deposits: percentage (half-up), fixed (capped) or none — never a hardcoded 50%", () => {
    expect(depositFor(100001, { depositType: "PERCENTAGE", depositPercentBps: 5000 })).toBe(50001); // 500.005 → 500.01
    expect(depositFor(100000, { depositType: "PERCENTAGE", depositPercentBps: 3333 })).toBe(33330);
    expect(depositFor(99999, { depositType: "PERCENTAGE", depositPercentBps: 2500 })).toBe(25000); // 249.9975 → 250.00
    expect(depositFor(50000, { depositType: "FIXED_AMOUNT", depositAmountCents: 20000 })).toBe(20000);
    expect(depositFor(50000, { depositType: "FIXED_AMOUNT", depositAmountCents: 90000 })).toBe(50000);
    expect(depositFor(50000, { depositType: "NONE" })).toBe(0);
    expect(depositFor(0, { depositType: "PERCENTAGE", depositPercentBps: 5000 })).toBe(0);
    expect(depositFor(10000, { depositType: "PERCENTAGE", depositPercentBps: 20000 })).toBe(10000); // clamped to 100%
  });

  it("parses and formats deposit percentages", () => {
    expect(parsePercentToBps("50")).toBe(5000);
    expect(parsePercentToBps("33.33%")).toBe(3333);
    expect(parsePercentToBps("12.5")).toBe(1250);
    expect(parsePercentToBps("abc")).toBeNaN();
    expect(parsePercentToBps("1.234")).toBeNaN();
    expect(formatBps(5000)).toBe("50%");
    expect(formatBps(1250)).toBe("12.5%");
  });
});

describe("payment state is derived, not typed", () => {
  it("nets refunds and ignores voided/failed/pending payments", () => {
    expect(netPaid({ amountCents: 1000, refundedCents: 0, status: "SUCCEEDED" })).toBe(1000);
    expect(netPaid({ amountCents: 1000, refundedCents: 250, status: "PARTIALLY_REFUNDED" })).toBe(750);
    expect(netPaid({ amountCents: 1000, refundedCents: 0, status: "VOIDED" })).toBe(0);
    expect(netPaid({ amountCents: 1000, refundedCents: 0, status: "PENDING" })).toBe(0);
  });
  it("derives invoice and order status from the balance", () => {
    const inv = { status: "OPEN" as const, totalCents: 1000, depositCents: 500, balanceDueAt: null };
    expect(invoiceStatusFor(inv, 0)).toBe("DEPOSIT_DUE");
    expect(invoiceStatusFor(inv, 499)).toBe("DEPOSIT_DUE");
    expect(invoiceStatusFor(inv, 500)).toBe("PARTIALLY_PAID");
    expect(invoiceStatusFor({ ...inv, balanceDueAt: new Date() }, 500)).toBe("BALANCE_DUE");
    expect(invoiceStatusFor({ ...inv, balanceDueAt: new Date() }, 1000)).toBe("PAID");
    expect(invoiceStatusFor({ ...inv, depositCents: 0 }, 0)).toBe("OPEN");
    expect(invoiceStatusFor({ ...inv, status: "VOIDED" }, 0)).toBe("VOIDED");
    expect(invoiceStatusFor({ ...inv, status: "DRAFT" }, 0)).toBe("DRAFT");
    const order = { productionStatus: "AWAITING_DEPOSIT" as const, totalCents: 1000, depositCents: 500 };
    expect(orderPaymentStatusFor(order, 0, false, false)).toBe("DEPOSIT_DUE");
    expect(orderPaymentStatusFor(order, 500, false, false)).toBe("PARTIALLY_PAID");
    expect(orderPaymentStatusFor(order, 500, false, true)).toBe("BALANCE_DUE");
    expect(orderPaymentStatusFor(order, 1000, false, true)).toBe("PAID");
    expect(orderPaymentStatusFor({ ...order, depositCents: 0 }, 0, false, false)).toBe("UNPAID");
    expect(orderPaymentStatusFor(order, 0, true, false)).toBe("REFUNDED");
    expect(orderPaymentStatusFor({ ...order, productionStatus: "CANCELED" }, 0, false, false)).toBe("CANCELED");
  });
  it("computes what's due now, holding pending payments against the balance", () => {
    const inv = { status: "OPEN" as const, totalCents: 200000, depositCents: 100000, balanceDueAt: null, amountPaidCents: 0, pendingCents: 0 };
    expect(invoiceMoney(inv)).toMatchObject({ remainingCents: 200000, collectibleCents: 200000, dueNowCents: 100000, dueNowType: "DEPOSIT" });
    expect(invoiceMoney({ ...inv, amountPaidCents: 100000 })).toMatchObject({ remainingCents: 100000, dueNowCents: 0, dueNowType: null });
    expect(invoiceMoney({ ...inv, amountPaidCents: 100000, balanceDueAt: new Date() })).toMatchObject({ dueNowCents: 100000, dueNowType: "FINAL_BALANCE" });
    // A $50,000 check waiting to clear: still owed, but not collectible twice.
    expect(invoiceMoney({ ...inv, amountPaidCents: 100000, pendingCents: 50000, balanceDueAt: new Date() })).toMatchObject({ remainingCents: 100000, collectibleCents: 50000, dueNowCents: 50000 });
    expect(invoiceMoney({ ...inv, amountPaidCents: 200000, balanceDueAt: new Date() })).toMatchObject({ remainingCents: 0, dueNowCents: 0 });
  });
});

describe("customer tokens", () => {
  it("are 256-bit, URL-safe and unique", () => {
    const a = newCustomerToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 200 }, newCustomerToken)).size).toBe(200);
    expect(isTokenShape(a)).toBe(true);
    expect(isTokenShape("123")).toBe(false);
    expect(isTokenShape("../../etc/passwd")).toBe(false);
  });
});

describe("email templates", () => {
  const brand = { businessName: "Wild Mountain Woodworks", logoUrl: "https://example.com/logo.png", siteUrl: "https://example.com/" };
  it("escape every placeholder and the admin-edited body", () => {
    const r = renderEmail({
      subject: "Quote {{quoteNumber}}",
      heading: "Hi {{customerName}}",
      body: "Hello <b>{{customerName}}</b>\n\n- Total: {{total}}\n- Deposit: {{deposit}}",
      buttonLabel: "View Quote",
      actionUrl: "https://example.com/quote/abc",
      vars: { customerName: '<script>alert("x")</script>', quoteNumber: "WMQ-1001", total: "$1,200", deposit: null },
      brand,
    });
    expect(r.subject).toBe("Quote WMQ-1001");
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<b>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain('href="https://example.com/quote/abc"');
    expect(r.html).toContain("https://example.com/logo.png");
    expect(r.text).not.toContain("Deposit:"); // empty bullet dropped
    expect(r.text).toContain("View Quote: https://example.com/quote/abc");
  });
  it("never renders a non-http button link", () => {
    const r = renderEmail({ subject: "s", heading: "h", body: "b", buttonLabel: "Go", actionUrl: "javascript:alert(1)", vars: {}, brand });
    expect(r.html).not.toContain("javascript:");
  });
  it("fills known placeholders and blanks unknown ones", () => {
    expect(fill("{{a}} {{ b }} {{missing}}!", { a: 1, b: "two" })).toBe("1 two !");
  });
  it("define about 14+ distinct events with unique keys", () => {
    const keys = EMAIL_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(14);
  });
});
