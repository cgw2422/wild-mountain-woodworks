import { describe, expect, it } from "vitest";
import { priceConfiguration, startingPrice } from "@/lib/pricing/engine";
import { resolveConfigurableProduct } from "@/lib/pricing/resolve";
import {
  activeSale,
  exactPercentSalePrice,
  parseSaleAmount,
  percentOff,
  percentSalePrice,
  saleCaption,
  saleInputValue,
  salePriceFor,
  saleStatus,
} from "@/lib/pricing/sale";
import { buildConfigurationSnapshot } from "@/lib/pricing/snapshot";
import { lastSaleDay, siteDateInput, siteDayStart } from "@/lib/site-time";
import { ridgeRecord } from "../support/fixtures";

const NOW = new Date("2026-10-10T15:00:00Z");
const day = (iso: string) => new Date(iso);
const selection = {
  options: { size: "size-84", wood: "wood-walnut" },
  addOns: { bench: 1 },
};

describe("sale status", () => {
  it("is active inside the window and ignores open bounds", () => {
    expect(
      saleStatus({ basePriceCents: 120000, salePriceCents: 99500 }, NOW),
    ).toBe("active");
    expect(
      saleStatus(
        {
          basePriceCents: 120000,
          salePriceCents: 99500,
          saleStartsAt: day("2026-10-01T04:00:00Z"),
          saleEndsAt: day("2026-10-15T04:00:00Z"),
        },
        NOW,
      ),
    ).toBe("active");
  });

  it("is scheduled before the start and ended from the end instant (exclusive)", () => {
    expect(
      saleStatus(
        {
          basePriceCents: 120000,
          salePriceCents: 99500,
          saleStartsAt: day("2026-10-11T04:00:00Z"),
        },
        NOW,
      ),
    ).toBe("scheduled");
    expect(
      saleStatus(
        { basePriceCents: 120000, salePriceCents: 99500, saleEndsAt: NOW },
        NOW,
      ),
    ).toBe("ended");
  });

  it("never applies a sale that isn't below the base price", () => {
    expect(
      saleStatus({ basePriceCents: 120000, salePriceCents: 120000 }, NOW),
    ).toBe("invalid");
    expect(saleStatus({ basePriceCents: null, salePriceCents: 500 }, NOW)).toBe(
      "invalid",
    );
    expect(
      activeSale({ basePriceCents: 100000, salePriceCents: 150000 }, NOW),
    ).toBeNull();
  });

  it("is off while the sale is switched off, whatever the dates", () => {
    expect(
      saleStatus(
        { basePriceCents: 120000, salePriceCents: 99500, saleEnabled: false },
        NOW,
      ),
    ).toBe("off");
    expect(
      activeSale(
        { basePriceCents: 120000, salePriceCents: 99500, saleEnabled: false },
        NOW,
      ),
    ).toBeNull();
    expect(
      activeSale(
        {
          basePriceCents: 120000,
          salePriceCents: 99500,
          saleEnabled: true,
          saleLabel: " Fall Sale ",
        },
        NOW,
      )?.label,
    ).toBe("Fall Sale");
  });

  it("derives the discount and caption (never stored)", () => {
    expect(percentOff(139900, 97900)).toBe(30);
    expect(saleCaption(null, 30)).toBe("Sale · 30% off");
    expect(saleCaption("Fall Sale", 30)).toBe("Fall Sale · 30% off");
  });

  it("parses dollars or a percentage, rejecting prices at or above regular", () => {
    expect(parseSaleAmount("979", 139900)).toEqual({
      kind: "FIXED_PRICE",
      cents: 97900,
    });
    expect(parseSaleAmount("$1,095.50", 139900)).toEqual({
      kind: "FIXED_PRICE",
      cents: 109550,
    });
    expect(parseSaleAmount("30%", 139900)).toEqual({
      kind: "PERCENT",
      bps: 3000,
      percent: 30,
      cents: 97900,
      exactCents: 97930,
    });
    expect(parseSaleAmount("12.5 %", 22500)).toMatchObject({
      kind: "PERCENT",
      bps: 1250,
      percent: 12.5,
    });
    expect(parseSaleAmount("12.345%", 22500)).toMatchObject({
      error: expect.any(String),
    });
    expect(parseSaleAmount("1399", 139900)).toMatchObject({
      error: expect.stringMatching(/lower than the regular/),
    });
    expect(parseSaleAmount("1500", 139900)).toMatchObject({
      error: expect.any(String),
    });
    expect(parseSaleAmount("0", 139900)).toMatchObject({
      error: expect.any(String),
    });
    expect(parseSaleAmount("-5", 139900)).toMatchObject({
      error: expect.any(String),
    });
    expect(parseSaleAmount("100%", 139900)).toMatchObject({
      error: expect.any(String),
    });
    expect(parseSaleAmount("979", null)).toMatchObject({
      error: expect.stringMatching(/regular price/),
    });
    expect(parseSaleAmount("  ", 139900)).toBeNull();
  });

  it("rounds the percent off down", () => {
    expect(percentOff(120000, 99500)).toBe(17);
    expect(percentOff(100000, 80000)).toBe(20);
  });
});

describe("pricing with a sale", () => {
  it("replaces only the base price; options and add-ons are unchanged", () => {
    const product = resolveConfigurableProduct(
      ridgeRecord({ salePriceCents: 99500 }),
      NOW,
    );
    expect(product.basePriceCents).toBe(99500);
    expect(product.sale).toEqual({
      regularBasePriceCents: 120000,
      endsAt: null,
      label: null,
      percent: null,
    });
    const r = priceConfiguration(product, selection);
    expect(r.totalCents).toBe(99500 + 30000 + 80000 + 35000);
    expect(r.savingsCents).toBe(20500);
    expect(r.lines[0]).toMatchObject({
      kind: "base",
      detail: "Sale price",
      amountCents: 99500,
    });
    expect(startingPrice(product)).toBe(99500);
    expect(startingPrice(product, { regular: true })).toBe(120000);
  });

  it("uses the regular price outside the sale window", () => {
    const product = resolveConfigurableProduct(
      ridgeRecord({
        salePriceCents: 99500,
        saleEndsAt: day("2026-10-01T04:00:00Z"),
      }),
      NOW,
    );
    expect(product.basePriceCents).toBe(120000);
    expect(product.sale).toBeNull();
    expect(priceConfiguration(product, selection).savingsCents).toBe(0);
  });

  it("records the sale in the immutable snapshot", () => {
    const product = resolveConfigurableProduct(
      ridgeRecord({ salePriceCents: 99500 }),
      NOW,
    );
    const snap = buildConfigurationSnapshot(
      product,
      selection,
      priceConfiguration(product, selection),
      { priceShownToCustomer: true, now: NOW },
    );
    expect(snap.basePriceCents).toBe(99500);
    expect(snap.sale).toEqual({
      regularBasePriceCents: 120000,
      savingsCents: 20500,
      label: null,
      percent: null,
    });
    const regular = resolveConfigurableProduct(ridgeRecord(), NOW);
    expect(
      buildConfigurationSnapshot(
        regular,
        selection,
        priceConfiguration(regular, selection),
        { priceShownToCustomer: true },
      ).sale,
    ).toBeNull();
  });
});

describe("percent sales keep the entered percentage", () => {
  const percentSale = (regular: number, pct: number) => ({
    basePriceCents: regular,
    saleEnabled: true,
    saleType: "PERCENT" as const,
    salePercentBps: pct * 100,
  });

  it("$225 at 30%: exact $157.50, rounded to $158 (half up), advertised 30% — never 29%", () => {
    expect(exactPercentSalePrice(22500, 3000)).toBe(15750);
    expect(percentSalePrice(22500, 3000)).toBe(15800);
    const parsed = parseSaleAmount("30%", 22500);
    expect(parsed).toEqual({
      kind: "PERCENT",
      bps: 3000,
      percent: 30,
      cents: 15800,
      exactCents: 15750,
    });
    const sale = activeSale(percentSale(22500, 30), NOW)!;
    expect(sale).toMatchObject({
      priceCents: 15800,
      regularPriceCents: 22500,
      percent: 30,
    });
    expect(saleCaption(null, sale.percent!)).toBe("Sale · 30% off");
    // What the old logic did — recalculating from the rounded price — would say 29%.
    expect(percentOff(22500, 15800)).toBe(29);
  });

  it("$1,399 at 30%: exact $979.30 → $979, advertised 30%", () => {
    expect(exactPercentSalePrice(139900, 3000)).toBe(97930);
    expect(activeSale(percentSale(139900, 30), NOW)).toMatchObject({
      priceCents: 97900,
      percent: 30,
    });
  });

  it("$225 at 31%: exact $155.25 → $155, advertised 31%", () => {
    expect(exactPercentSalePrice(22500, 3100)).toBe(15525);
    expect(activeSale(percentSale(22500, 31), NOW)).toMatchObject({
      priceCents: 15500,
      percent: 31,
    });
  });

  it("fractional percentages and fractional cents", () => {
    // $225 at 12.5% = $196.875 → $197; advertised 12.5%.
    const sale = activeSale(
      { ...percentSale(22500, 0), salePercentBps: 1250 },
      NOW,
    )!;
    expect(sale).toMatchObject({ priceCents: 19700, percent: 12.5 });
    expect(saleCaption("Fall Sale", sale.percent!)).toBe(
      "Fall Sale · 12.5% off",
    );
    // $1.00 at 50% rounds back up to $1 — not below the regular price, so never applied.
    expect(saleStatus(percentSale(100, 50), NOW)).toBe("invalid");
  });

  it("the percentage is the source of truth: the sale follows a new regular price", () => {
    expect(salePriceFor(percentSale(139900, 30))).toBe(97900);
    expect(salePriceFor(percentSale(150000, 30))).toBe(105000);
    expect(
      saleInputValue({ ...percentSale(22500, 0), salePercentBps: 1250 }),
    ).toBe("12.5%");
  });

  it("fixed-dollar sales derive the percentage from the two prices", () => {
    const fixed = {
      basePriceCents: 22500,
      saleEnabled: true,
      saleType: "FIXED_PRICE" as const,
      salePriceCents: 15800,
    };
    expect(activeSale(fixed, NOW)).toMatchObject({
      priceCents: 15800,
      percent: null,
    });
    expect(percentOff(22500, 15800)).toBe(29);
    expect(saleInputValue(fixed)).toBe("158");
    // Changing the regular price never moves a fixed sale price.
    expect(salePriceFor({ ...fixed, basePriceCents: 30000 })).toBe(15800);
  });

  it("prices configurations and snapshots at the rounded price with the entered percentage", () => {
    const product = resolveConfigurableProduct(
      ridgeRecord({
        basePriceCents: 22500,
        saleEnabled: true,
        saleType: "PERCENT",
        salePercentBps: 3000,
      }),
      NOW,
    );
    expect(product.basePriceCents).toBe(15800);
    expect(product.sale).toMatchObject({
      regularBasePriceCents: 22500,
      percent: 30,
    });
    const pricing = priceConfiguration(product, selection);
    expect(pricing.totalCents).toBe(15800 + 30000 + 80000 + 35000);
    expect(pricing.savingsCents).toBe(6700);
    expect(startingPrice(product)).toBe(15800);
    expect(startingPrice(product, { regular: true })).toBe(22500);
    const snap = buildConfigurationSnapshot(product, selection, pricing, {
      priceShownToCustomer: true,
      now: NOW,
    });
    expect(snap.sale).toEqual({
      regularBasePriceCents: 22500,
      savingsCents: 6700,
      label: null,
      percent: 30,
    });
  });
});

describe("site calendar days", () => {
  it("maps a day to local midnight in the site time zone, across DST", () => {
    expect(
      siteDayStart("2026-10-01", 0, "America/New_York")!.toISOString(),
    ).toBe("2026-10-01T04:00:00.000Z");
    expect(
      siteDayStart("2026-12-01", 0, "America/New_York")!.toISOString(),
    ).toBe("2026-12-01T05:00:00.000Z");
    // Sale "through Nov 1" (the DST change) ends at local midnight on Nov 2.
    expect(
      siteDayStart("2026-11-01", 1, "America/New_York")!.toISOString(),
    ).toBe("2026-11-02T05:00:00.000Z");
    expect(siteDayStart("2026-10-01", 0, "America/Denver")!.toISOString()).toBe(
      "2026-10-01T06:00:00.000Z",
    );
  });

  it("rejects impossible dates", () => {
    expect(siteDayStart("2026-02-30")).toBeNull();
    expect(siteDayStart("10/01/2026")).toBeNull();
  });

  it("round-trips the last day of a sale for the date input", () => {
    const end = siteDayStart("2026-10-14", 1, "America/New_York")!;
    expect(siteDateInput(lastSaleDay(end), "America/New_York")).toBe(
      "2026-10-14",
    );
  });
});
