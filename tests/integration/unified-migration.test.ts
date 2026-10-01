import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Runs the real migration SQL on a scratch database: every migration before
 * the unified invoice model, then legacy rows (old production stages,
 * separate deposit/balance invoices, Stripe/cash/check payments, status
 * history), then the two unified-model migrations — and checks nothing is
 * lost or merged.
 */
const base = process.env.TEST_DATABASE_URL;
const DB = "wm_unified_migration_test";
const dir = path.resolve("prisma/migrations");
const migrations = fs.readdirSync(dir).filter((d) => /^\d/.test(d)).sort();
const UNIFIED = ["20261012000000_unified_invoice_schema", "20261012000100_unified_invoice_data"];

const OLD_TO_NEW: Array<[string, string]> = [
  ["DEPOSIT_PAID", "ORDER_CONFIRMED"],
  ["DESIGN_CONFIRMATION", "ORDER_CONFIRMED"],
  ["MATERIALS_ORDERED", "IN_PRODUCTION"],
  ["MATERIALS_READY", "IN_PRODUCTION"],
  ["IN_PRODUCTION", "IN_PRODUCTION"],
  ["SANDING", "IN_PRODUCTION"],
  ["FINISHING", "IN_PRODUCTION"],
  ["CURING", "IN_PRODUCTION"],
  ["READY_FOR_DELIVERY", "READY_FOR_DELIVERY"],
  ["DELIVERY_SCHEDULED", "DELIVERY_SCHEDULED"],
  ["COMPLETED", "COMPLETED"],
  ["CANCELED", "CANCELED"],
  ["AWAITING_DEPOSIT", "AWAITING_DEPOSIT"],
];

describe.skipIf(!base)("unified invoice migration on legacy data", () => {
  let c: pg.Client;
  const now = "2026-09-01T12:00:00Z";

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();
    c = new pg.Client({ connectionString: base!.replace(/\/[^/?]+(\?|$)/, `/${DB}$1`) });
    await c.connect();
    for (const m of migrations) {
      if (UNIFIED.includes(m) || m > UNIFIED[1]!) break;
      await c.query(fs.readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
    }

    const order = (id: string, status: string, total = 200000, deposit = 100000) =>
      c.query(`INSERT INTO "Order" (id, number, "customerName", "customerEmail", "subtotalCents", "totalCents", "depositCents", "productionStatus", "paymentStatus", "updatedAt") VALUES ($1, $2, 'Pat Lee', 'pat@example.com', $3, $3, $4, $5, 'DEPOSIT_DUE', $6)`, [id, `WMO-${id}`, total, deposit, status, now]);
    const invoice = (id: string, orderId: string, kind: string, status: string, total: number, paid: number, sent = true) =>
      c.query(`INSERT INTO "Invoice" (id, number, "orderId", kind, status, "customerName", "customerEmail", "totalCents", "amountPaidCents", "sentAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, 'Pat Lee', 'pat@example.com', $6, $7, $8, $9)`, [id, `WMI-${id}`, orderId, kind, status, total, paid, sent ? now : null, now]);
    const payment = (id: string, invoiceId: string, orderId: string, amount: number, method: string, status = "SUCCEEDED", source = "MANUAL") =>
      c.query(`INSERT INTO "Payment" (id, "invoiceId", "orderId", "amountCents", method, source, status, "receivedAt", reference, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ref-' || $1, 'note ' || $1)`, [id, invoiceId, orderId, amount, method, source, status, now]);

    // One order in every old stage (each with its deposit paid, except the awaiting ones).
    for (const [old] of OLD_TO_NEW) {
      const id = `o_${old.toLowerCase()}`;
      await order(id, old);
      if (old !== "AWAITING_DEPOSIT") {
        await invoice(`d_${old.toLowerCase()}`, id, "DEPOSIT", "PAID", 100000, 100000);
        await payment(`p_${old.toLowerCase()}`, `d_${old.toLowerCase()}`, id, 100000, "STRIPE", "SUCCEEDED", "STRIPE");
      }
    }
    // QUOTE_ACCEPTED splits on whether the deposit is still owed.
    await order("o_qa_unpaid", "QUOTE_ACCEPTED");
    await invoice("d_qa_unpaid", "o_qa_unpaid", "DEPOSIT", "OPEN", 100000, 0);
    await order("o_qa_paid", "QUOTE_ACCEPTED");
    await invoice("d_qa_paid", "o_qa_paid", "DEPOSIT", "PAID", 100000, 100000);
    await payment("p_qa_paid", "d_qa_paid", "o_qa_paid", 100000, "CHECK");
    await order("o_qa_nodeposit", "QUOTE_ACCEPTED", 50000, 0);

    // A legacy order with a sent final-balance invoice, part paid by a pending check and cash.
    await order("o_split", "FINISHING");
    await invoice("d_split", "o_split", "DEPOSIT", "PAID", 100000, 100000);
    await payment("p_split_dep", "d_split", "o_split", 100000, "STRIPE", "SUCCEEDED", "STRIPE");
    await invoice("b_split", "o_split", "BALANCE", "PARTIALLY_PAID", 100000, 25000);
    await payment("p_split_cash", "b_split", "o_split", 25000, "CASH");
    await payment("p_split_check", "b_split", "o_split", 30000, "CHECK", "PENDING");
    await invoice("b_draft", "o_split", "BALANCE", "DRAFT", 100000, 0, false);
    await invoice("v_void", "o_split", "CUSTOM", "VOID", 5000, 0);

    // Existing production history.
    await c.query(`INSERT INTO "StatusEvent" (id, "orderId", "fromStatus", "toStatus", "createdAt") VALUES ('h1', 'o_split', 'MATERIALS_ORDERED', 'SANDING', $1), ('h2', 'o_split', 'SANDING', 'FINISHING', $1)`, [now]);

    for (const m of UNIFIED) await c.query(fs.readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
  }, 60_000);

  afterAll(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
  });

  const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];

  it("maps every old production stage to the simplified stages", async () => {
    for (const [old, now] of OLD_TO_NEW) {
      expect([old, (await one(`SELECT "productionStatus" s FROM "Order" WHERE id = $1`, [`o_${old.toLowerCase()}`])).s]).toEqual([old, now]);
    }
    expect((await one(`SELECT "productionStatus" s FROM "Order" WHERE id = 'o_qa_unpaid'`)).s).toBe("AWAITING_DEPOSIT");
    expect((await one(`SELECT "productionStatus" s FROM "Order" WHERE id = 'o_qa_paid'`)).s).toBe("ORDER_CONFIRMED");
    expect((await one(`SELECT "productionStatus" s FROM "Order" WHERE id = 'o_qa_nodeposit'`)).s).toBe("ORDER_CONFIRMED");
    const labels = (await c.query(`SELECT unnest(enum_range(NULL::"ProductionStatus"))::text v`)).rows.map((r) => r.v);
    expect(labels).toEqual(["AWAITING_DEPOSIT", "ORDER_CONFIRMED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "DELIVERY_SCHEDULED", "COMPLETED", "CANCELED"]);
  });

  it("keeps the old status history and records each remap", async () => {
    const events = (await c.query(`SELECT id, "fromStatus", "toStatus" FROM "StatusEvent" WHERE "orderId" = 'o_split' ORDER BY id`)).rows;
    expect(events).toEqual(
      expect.arrayContaining([
        { id: "h1", fromStatus: "MATERIALS_ORDERED", toStatus: "SANDING" },
        { id: "h2", fromStatus: "SANDING", toStatus: "FINISHING" },
        { id: expect.stringMatching(/^mig_/), fromStatus: "FINISHING", toStatus: "IN_PRODUCTION" },
      ]),
    );
    // Unchanged orders get no migration event.
    expect(Number((await one(`SELECT count(*) n FROM "StatusEvent" WHERE "orderId" = 'o_completed'`)).n)).toBe(0);
  });

  it("keeps every invoice and payment — nothing merged, no amounts changed", async () => {
    expect(Number((await one(`SELECT count(*) n FROM "Invoice"`)).n)).toBe(18);
    expect(Number((await one(`SELECT count(*) n FROM "Payment"`)).n)).toBe(16);
    const split = (await c.query(`SELECT id, kind, status, "totalCents", "amountPaidCents", "pendingCents", "depositCents", "balanceDueAt" IS NOT NULL due FROM "Invoice" WHERE "orderId" = 'o_split' ORDER BY id`)).rows;
    expect(split).toEqual([
      { id: "b_draft", kind: "BALANCE", status: "DRAFT", totalCents: 100000, amountPaidCents: 0, pendingCents: 0, depositCents: 0, due: false },
      { id: "b_split", kind: "BALANCE", status: "BALANCE_DUE", totalCents: 100000, amountPaidCents: 25000, pendingCents: 30000, depositCents: 0, due: true },
      { id: "d_split", kind: "DEPOSIT", status: "PAID", totalCents: 100000, amountPaidCents: 100000, pendingCents: 0, depositCents: 100000, due: false },
      { id: "v_void", kind: "CUSTOM", status: "VOIDED", totalCents: 5000, amountPaidCents: 0, pendingCents: 0, depositCents: 0, due: false },
    ]);
    expect((await one(`SELECT status, "depositCents" FROM "Invoice" WHERE id = 'd_qa_unpaid'`)).status).toBe("DEPOSIT_DUE");
    expect((await one(`SELECT "paymentStatus" s FROM "Order" WHERE id = 'o_split'`)).s).toBe("BALANCE_DUE");
  });

  it("gives payments a method and purpose, keeping references, notes and pending checks", async () => {
    const rows = (await c.query(`SELECT id, method, type, status, reference, notes, "amountCents" FROM "Payment" WHERE "orderId" = 'o_split' ORDER BY id`)).rows;
    expect(rows).toEqual([
      { id: "p_split_cash", method: "CASH", type: "FINAL_BALANCE", status: "SUCCEEDED", reference: "ref-p_split_cash", notes: "note p_split_cash", amountCents: 25000 },
      { id: "p_split_check", method: "CHECK", type: "FINAL_BALANCE", status: "PENDING", reference: "ref-p_split_check", notes: "note p_split_check", amountCents: 30000 },
      { id: "p_split_dep", method: "STRIPE_ONLINE", type: "DEPOSIT", status: "SUCCEEDED", reference: "ref-p_split_dep", notes: "note p_split_dep", amountCents: 100000 },
    ]);
    expect(Number((await one(`SELECT count(*) n FROM "Payment" WHERE method::text = 'STRIPE'`)).n)).toBe(0);
  });

  it("protects the new notification log from deletion", async () => {
    await c.query(`INSERT INTO "StatusNotification" (id, "orderId", "toStatus", email, status) VALUES ('n1', 'o_split', 'IN_PRODUCTION', 'pat@example.com', 'SENT')`);
    await expect(c.query(`DELETE FROM "StatusNotification" WHERE id = 'n1'`)).rejects.toThrow();
    await expect(c.query(`DELETE FROM "Payment" WHERE id = 'p_split_cash'`)).rejects.toThrow();
  });
});
