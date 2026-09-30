import { describe, expect, it } from "vitest";
import { clientRules } from "@/lib/validation/shared";
import { acceptQuoteSchema, configurationQuoteSchema, contactSchema, customRequestSchema, declineQuoteSchema, generalQuoteSchema } from "@/lib/validation/forms";

/**
 * The browser uses lightweight validators (to keep Zod out of the client
 * bundle). These tests keep them in agreement with the authoritative Zod
 * schemas the server enforces.
 */
const base = { name: "Jamie Rivers", email: "jamie@example.com", phone: "", zipCode: "43215" };
const cases: Array<Record<string, string>> = [
  base,
  { ...base, name: "J" },
  { ...base, email: "not-an-email" },
  { ...base, email: "a@b" },
  { ...base, phone: "call me" },
  { ...base, phone: "+1 (614) 555-0100" },
  { ...base, zipCode: "4321" },
  { ...base, zipCode: "43215-1234" },
  { ...base, name: "x".repeat(121) },
];

function agree(clientFn: (v: Record<string, string>) => Record<string, string> | null, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } } }, extra: Record<string, string>) {
  for (const c of cases) {
    const input = { ...c, ...extra };
    const server = schema.safeParse(input);
    const client = clientFn(input);
    const serverFields = server.success ? [] : [...new Set(server.error!.issues.map((i) => String(i.path[0])))].sort();
    const clientFields = client ? Object.keys(client).sort() : [];
    expect({ input, fields: clientFields }).toEqual({ input, fields: serverFields });
  }
}

describe("client validators match the server schemas", () => {
  it("contact", () => {
    agree(clientRules.contact, contactSchema, { reason: "OTHER", message: "A question about delivery." });
    expect(clientRules.contact({ ...base, reason: "", message: "short" })).toMatchObject({ reason: expect.any(String), message: expect.any(String) });
  });
  it("custom request", () => {
    agree(clientRules.customRequest, customRequestSchema, { furnitureType: "Desk", description: "A walnut writing desk with drawers." });
  });
  it("general quote", () => {
    agree(clientRules.generalQuote, generalQuoteSchema, { interest: "Bench" });
  });
  it("configuration quote (quantity and optional delivery address)", () => {
    const extra = { productId: "p1", selection: "{}" };
    agree(clientRules.configurationQuote, configurationQuoteSchema, extra);
    for (const quantity of ["", "1", "20", "0", "21", "2.5", "abc"]) agree(clientRules.configurationQuote, configurationQuoteSchema, { ...extra, quantity });
    agree(clientRules.configurationQuote, configurationQuoteSchema, { ...extra, address: "x".repeat(301) });
  });
  it("accept and decline quote", () => {
    const ok = { revision: "2", name: "Jamie Rivers", agreeTerms: "on", agreeDeposit: "on" };
    for (const input of [ok, { ...ok, name: "J" }, { ...ok, agreeTerms: "" }, { ...ok, agreeDeposit: "" }, { ...ok, agreeTerms: "", agreeDeposit: "", name: "" }]) {
      const server = acceptQuoteSchema.safeParse(input);
      const serverFields = server.success ? [] : [...new Set(server.error.issues.map((i) => String(i.path[0])))].sort();
      expect(Object.keys(clientRules.acceptQuote(input) ?? {}).sort()).toEqual(serverFields);
    }
    for (const reason of ["", "Went another way", "x".repeat(1001)]) {
      const server = declineQuoteSchema.safeParse({ revision: "1", reason });
      expect(Boolean(clientRules.declineQuote({ reason }))).toBe(!server.success);
    }
  });
});
