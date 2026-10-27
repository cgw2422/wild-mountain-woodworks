import { describe, expect, it } from "vitest";
import { priceConfiguration } from "@/lib/pricing/engine";
import { resolveConfigurableProduct } from "@/lib/pricing/resolve";
import { configuredProductLines } from "@/lib/sales/configured-lines";
import { lineTotal } from "@/lib/sales/totals";
import { ridgeRecord } from "../support/fixtures";

const sum = (lines: Array<{ kind: "PRODUCT" | "ADDON" | "DISCOUNT" | "CUSTOM" | "DELIVERY" | "INSTALLATION" | "FEE"; quantity: number; unitPriceCents: number }>) => lines.reduce((s, l) => s + lineTotal(l), 0);

describe("quote lines from a configured product (shared by the quote editor and the server)", () => {
  it("total always equals the product page's price × pieces", () => {
    const p = resolveConfigurableProduct(ridgeRecord());
    for (const size of ["size-60", "size-84", "size-96"])
      for (const wood of ["wood-pine", "wood-walnut"])
        for (const bench of [0, 2])
          for (const qty of [1, 3]) {
            const sel = { options: { size, wood }, addOns: { bench, breadboard: 1 } };
            const r = configuredProductLines(p, sel, { quantity: qty, configGroup: "g" });
            if (!r.ok) throw new Error(r.message);
            expect(sum(r.lines), `${size} ${wood} ${bench} × ${qty}`).toBe(priceConfiguration(p, sel).totalCents! * qty);
            expect(r.lines.every((l) => l.configGroup === "g")).toBe(true);
          }
  });

  it("with a sale: the piece at regular price plus a sale line, totalling the sale price", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const p = resolveConfigurableProduct(ridgeRecord({ saleEnabled: true, saleType: "PERCENT", salePercentBps: 2500, saleStartsAt: new Date("2026-10-01"), saleEndsAt: new Date("2026-11-01") }), now);
    const sel = { options: { size: "size-84", wood: "wood-walnut" }, addOns: { bench: 1 } };
    const r = configuredProductLines(p, sel, { quantity: 2, configGroup: "g" });
    if (!r.ok) throw new Error(r.message);
    expect(r.lines.map((l) => l.kind)).toEqual(["PRODUCT", "DISCOUNT", "ADDON"]);
    expect(sum(r.lines)).toBe(priceConfiguration(p, sel).totalCents! * 2);
  });

  it("an override replaces the per-piece total, keeps add-on prices and the calculated price", () => {
    const p = resolveConfigurableProduct(ridgeRecord());
    const sel = { options: { size: "size-84", wood: "wood-walnut" }, addOns: { bench: 2 } };
    const r = configuredProductLines(p, sel, { quantity: 2, overrideTotalCents: 300000, configGroup: "g" });
    if (!r.ok) throw new Error(r.message);
    expect(sum(r.lines)).toBe(600000);
    expect(r.lines.find((l) => l.kind === "ADDON")).toMatchObject({ quantity: 4, unitPriceCents: 35000 });
    expect(r.snapshot.quotePricing).toEqual({ calculatedTotalCents: priceConfiguration(p, sel).totalCents, overrideTotalCents: 300000 });
    expect(r.calculatedTotalCents).toBe(priceConfiguration(p, sel).totalCents);
    expect(configuredProductLines(p, sel, { quantity: 1, overrideTotalCents: 100, configGroup: "g" })).toMatchObject({ ok: false });
  });

  it("refuses an incomplete configuration with the product page's message", () => {
    const p = resolveConfigurableProduct(ridgeRecord());
    expect(configuredProductLines(p, { options: {}, addOns: {} }, { quantity: 1, configGroup: "g" })).toMatchObject({ ok: false, message: expect.stringMatching(/choose a size/i) });
  });
});
