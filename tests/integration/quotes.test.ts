import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createConfigurationQuote, createCustomRequest, createGeneralQuote, SubmissionError } from "@/lib/services/submissions";
import { parseSnapshot } from "@/lib/pricing/snapshot";
import { getStorage } from "@/lib/storage";
import { hasTestDb, imageFile, resetDb, seedRidge } from "../support/db";

const customer = { name: "Jamie Rivers", email: "jamie@example.com", phone: null, zipCode: "43215", timeline: null, notes: "Test" };

describe.skipIf(!hasTestDb)("quote requests", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.siteSetting.create({ data: { id: "default" } });
  });

  it("re-prices server-side from the database and stores an immutable snapshot", async () => {
    const { product, ids } = await seedRidge();
    const quote = await createConfigurationQuote({
      ...customer,
      productId: product.id,
      selection: { options: { [ids.size]: ids.s84, [ids.wood]: ids.walnut }, addOns: { [ids.bench]: 2 }, customDetails: {} },
    });
    expect(quote.number).toBe("WMQ-1001");
    expect(quote.reference).toBe("WMQ-1001");
    expect(quote.customerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(quote.status).toBe("NEW");
    // 1200 + 300 + 600 (product override, not the global 800) + 2×350
    expect(quote.estimatedTotalCents).toBe(120000 + 30000 + 60000 + 70000);

    const snapshot = parseSnapshot(quote.configuration)!;
    expect(snapshot.product.name).toBe("The Ridge Dining Table");
    expect(snapshot.options.find((o) => o.groupName === "Wood Species")!.priceModifierCents).toBe(60000);
    expect(snapshot.addOns[0]).toMatchObject({ name: "Matching Bench", quantity: 2, totalCents: 70000 });
    expect(await prisma.statusEvent.count({ where: { quoteRequestId: quote.id } })).toBe(1);
    expect(await prisma.activityLog.count({ where: { type: "quote.received" } })).toBe(1);

    // Later catalog edits never rewrite what the customer requested.
    await prisma.product.update({ where: { id: product.id }, data: { name: "Renamed Table", basePriceCents: 999900 } });
    await prisma.optionValue.update({ where: { id: ids.walnut }, data: { displayName: "Black Walnut", priceModifierCents: 1 } });
    const reloaded = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } });
    const again = parseSnapshot(reloaded.configuration)!;
    expect(again.product.name).toBe("The Ridge Dining Table");
    expect(again.options.find((o) => o.groupName === "Wood Species")!.valueDisplayName).toBe("Walnut");
    expect(reloaded.estimatedTotalCents).toBe(280000);
  });

  it("keeps the quote (and its snapshot) when the product is later deleted", async () => {
    const { product, ids } = await seedRidge();
    const quote = await createConfigurationQuote({
      ...customer,
      productId: product.id,
      selection: { options: { [ids.size]: ids.s60, [ids.wood]: ids.pine }, addOns: {}, customDetails: {} },
    });
    await prisma.product.delete({ where: { id: product.id } });
    const reloaded = await prisma.quoteRequest.findUniqueOrThrow({ where: { id: quote.id } });
    expect(reloaded.productId).toBeNull();
    expect(reloaded.productName).toBe("The Ridge Dining Table");
    expect(parseSnapshot(reloaded.configuration)!.product.sku).toBe("WM-RDT");
  });

  it("rejects invalid, tampered or disabled selections", async () => {
    const { product, ids } = await seedRidge();
    await prisma.productOptionValue.create({
      data: {
        productOptionGroupId: (await prisma.productOptionGroup.findFirstOrThrow({ where: { productId: product.id, optionGroupId: ids.size } })).id,
        optionValueId: ids.s84,
        enabled: false,
      },
    });
    const attempt = (options: Record<string, string>, customDetails: Record<string, string> = {}) =>
      createConfigurationQuote({ ...customer, productId: product.id, selection: { options, addOns: {}, customDetails } });

    await expect(attempt({ [ids.size]: ids.s84, [ids.wood]: ids.pine })).rejects.toBeInstanceOf(SubmissionError); // disabled for this product
    await expect(attempt({ [ids.size]: ids.s60 })).rejects.toBeInstanceOf(SubmissionError); // missing required group
    await expect(attempt({ [ids.size]: ids.sCustom, [ids.wood]: ids.pine })).rejects.toBeInstanceOf(SubmissionError); // custom without details
    const ok = await attempt({ [ids.size]: ids.sCustom, [ids.wood]: ids.pine }, { [ids.size]: "80 x 42" });
    expect(ok.requestedDimensions).toBe("80 x 42");
    expect(await prisma.quoteRequest.count()).toBe(1);
  });

  it.each(["DRAFT", "ARCHIVED"] as const)("does not accept configuration requests for %s products", async (status) => {
    const { product, ids } = await seedRidge(status);
    await expect(
      createConfigurationQuote({ ...customer, productId: product.id, selection: { options: { [ids.size]: ids.s60, [ids.wood]: ids.pine }, addOns: {}, customDetails: {} } }),
    ).rejects.toThrow(/no longer available/);
  });

  it("respects the Quotes Enabled / Custom Orders Enabled flags", async () => {
    await prisma.siteSetting.update({ where: { id: "default" }, data: { quotesEnabled: false, customOrdersEnabled: false } });
    await expect(createGeneralQuote({ ...customer, interest: "Bench", requestedDimensions: null })).rejects.toThrow(/unavailable/);
    await expect(
      createCustomRequest({ ...customer, furnitureType: "Desk", approximateDimensions: null, woodPreference: null, finishPreference: null, description: "A walnut desk for a small office." }),
    ).rejects.toThrow(/unavailable/);
  });

  it("stores validated reference images privately and rejects disguised files", async () => {
    const request = await createCustomRequest(
      { ...customer, furnitureType: "Desk", approximateDimensions: "60 x 30", woodPreference: "Walnut", finishPreference: null, description: "A walnut desk for a small office." },
      [await imageFile("room.jpg")],
    );
    const attachments = await prisma.attachment.findMany({ where: { customRequestId: request.id } });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.storageKey.startsWith("private/")).toBe(true);
    expect(await getStorage().get(attachments[0]!.storageKey)).not.toBeNull();

    const fake = new File([new TextEncoder().encode("<script>alert(1)</script>")], "evil.jpg", { type: "image/jpeg" });
    await expect(createGeneralQuote({ ...customer, interest: "Bench", requestedDimensions: null }, [fake])).rejects.toThrow(/could not be read/);
    expect(await prisma.quoteRequest.count()).toBe(0);
  });
});
