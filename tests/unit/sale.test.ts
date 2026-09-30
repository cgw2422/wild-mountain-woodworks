import { describe, expect, it } from "vitest";
import { priceConfiguration, startingPrice } from "@/lib/pricing/engine";
import { resolveConfigurableProduct } from "@/lib/pricing/resolve";
import { activeSale, percentOff, saleStatus } from "@/lib/pricing/sale";
import { buildConfigurationSnapshot } from "@/lib/pricing/snapshot";
import { lastSaleDay, siteDateInput, siteDayStart } from "@/lib/site-time";
import { ridgeRecord } from "../support/fixtures";

const NOW = new Date("2026-10-10T15:00:00Z");
const day = (iso: string) => new Date(iso);
const selection = { options: { size: "size-84", wood: "wood-walnut" }, addOns: { bench: 1 } };

describe("sale status", () => {
  it("is active inside the window and ignores open bounds", () => {
    expect(saleStatus({ basePriceCents: 120000, salePriceCents: 99500 }, NOW)).toBe("active");
    expect(saleStatus({ basePriceCents: 120000, salePriceCents: 99500, saleStartsAt: day("2026-10-01T04:00:00Z"), saleEndsAt: day("2026-10-15T04:00:00Z") }, NOW)).toBe("active");
  });

  it("is scheduled before the start and ended from the end instant (exclusive)", () => {
    expect(saleStatus({ basePriceCents: 120000, salePriceCents: 99500, saleStartsAt: day("2026-10-11T04:00:00Z") }, NOW)).toBe("scheduled");
    expect(saleStatus({ basePriceCents: 120000, salePriceCents: 99500, saleEndsAt: NOW }, NOW)).toBe("ended");
  });

  it("never applies a sale that isn't below the base price", () => {
    expect(saleStatus({ basePriceCents: 120000, salePriceCents: 120000 }, NOW)).toBe("invalid");
    expect(saleStatus({ basePriceCents: null, salePriceCents: 500 }, NOW)).toBe("invalid");
    expect(activeSale({ basePriceCents: 100000, salePriceCents: 150000 }, NOW)).toBeNull();
  });

  it("rounds the percent off down", () => {
    expect(percentOff(120000, 99500)).toBe(17);
    expect(percentOff(100000, 80000)).toBe(20);
  });
});

describe("pricing with a sale", () => {
  it("replaces only the base price; options and add-ons are unchanged", () => {
    const product = resolveConfigurableProduct(ridgeRecord({ salePriceCents: 99500 }), NOW);
    expect(product.basePriceCents).toBe(99500);
    expect(product.sale).toEqual({ regularBasePriceCents: 120000, endsAt: null });
    const r = priceConfiguration(product, selection);
    expect(r.totalCents).toBe(99500 + 30000 + 80000 + 35000);
    expect(r.savingsCents).toBe(20500);
    expect(r.lines[0]).toMatchObject({ kind: "base", detail: "Sale price", amountCents: 99500 });
    expect(startingPrice(product)).toBe(99500);
    expect(startingPrice(product, { regular: true })).toBe(120000);
  });

  it("uses the regular price outside the sale window", () => {
    const product = resolveConfigurableProduct(ridgeRecord({ salePriceCents: 99500, saleEndsAt: day("2026-10-01T04:00:00Z") }), NOW);
    expect(product.basePriceCents).toBe(120000);
    expect(product.sale).toBeNull();
    expect(priceConfiguration(product, selection).savingsCents).toBe(0);
  });

  it("records the sale in the immutable snapshot", () => {
    const product = resolveConfigurableProduct(ridgeRecord({ salePriceCents: 99500 }), NOW);
    const snap = buildConfigurationSnapshot(product, selection, priceConfiguration(product, selection), { priceShownToCustomer: true, now: NOW });
    expect(snap.basePriceCents).toBe(99500);
    expect(snap.sale).toEqual({ regularBasePriceCents: 120000, savingsCents: 20500 });
    const regular = resolveConfigurableProduct(ridgeRecord(), NOW);
    expect(buildConfigurationSnapshot(regular, selection, priceConfiguration(regular, selection), { priceShownToCustomer: true }).sale).toBeNull();
  });
});

describe("site calendar days", () => {
  it("maps a day to local midnight in the site time zone, across DST", () => {
    expect(siteDayStart("2026-10-01", 0, "America/New_York")!.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(siteDayStart("2026-12-01", 0, "America/New_York")!.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    // Sale "through Nov 1" (the DST change) ends at local midnight on Nov 2.
    expect(siteDayStart("2026-11-01", 1, "America/New_York")!.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(siteDayStart("2026-10-01", 0, "America/Denver")!.toISOString()).toBe("2026-10-01T06:00:00.000Z");
  });

  it("rejects impossible dates", () => {
    expect(siteDayStart("2026-02-30")).toBeNull();
    expect(siteDayStart("10/01/2026")).toBeNull();
  });

  it("round-trips the last day of a sale for the date input", () => {
    const end = siteDayStart("2026-10-14", 1, "America/New_York")!;
    expect(siteDateInput(lastSaleDay(end), "America/New_York")).toBe("2026-10-14");
  });
});
