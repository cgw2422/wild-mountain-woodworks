import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Runs migration 20261015000000_wmw_numbering_brand on a scratch database
 * holding pre-change data: historical numbers and counters must stay exactly
 * as they were; only editable content's short business name is corrected.
 */
const base = process.env.TEST_DATABASE_URL;
const DB = "wm_wmw_numbering_migration_test";
const dir = path.resolve("prisma/migrations");
const TARGET = "20261015000000_wmw_numbering_brand";

describe.skipIf(!base)("WMW numbering migration", () => {
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
    for (const m of fs.readdirSync(dir).filter((d) => /^\d/.test(d)).sort()) {
      if (m >= TARGET) break;
      await c.query(fs.readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
    }
    // Historical sales records and their counters.
    await c.query(`UPDATE "Counter" SET "value" = 1001`);
    await c.query(`INSERT INTO "QuoteRequest" (id, reference, number, name, email, "zipCode", "updatedAt") VALUES ('q1', 'WM-Q-260901-ABCD', 'WMQ-1001', 'Pat Lee', 'pat@example.com', '43215', $1)`, [now]);
    await c.query(`INSERT INTO "Order" (id, number, "quoteId", "customerName", "customerEmail", "subtotalCents", "totalCents", "updatedAt") VALUES ('o1', 'WMO-1001', 'q1', 'Pat Lee', 'pat@example.com', 1000, 1000, $1)`, [now]);
    await c.query(`INSERT INTO "Invoice" (id, number, "orderId", "customerName", "customerEmail", "updatedAt", "customerNotes") VALUES ('i1', 'WMI-1001', 'o1', 'Pat Lee', 'pat@example.com', $1, 'Thanks from Wild Mountain')`, [now]);
    // An email already sent stays exactly as it was sent.
    await c.query(`INSERT INTO "EmailLog" (id, template, "to", subject, html, text) VALUES ('e1', 'quote_sent', 'pat@example.com', 'Your Wild Mountain quote WMQ-1001', '<p>Wild Mountain</p>', 'Wild Mountain')`);
    // Editable content.
    await c.query(`INSERT INTO "EmailTemplate" (key, name, subject, heading, body, "updatedAt") VALUES ('order_ready', 'Ready', 'Your Wild Mountain piece is ready', 'Wild Mountain''s workshop', 'Hi {{firstName}}, your Wild Mountain piece is ready. — Wild Mountain Woodworks', $1)`, [now]);
    await c.query(`INSERT INTO "SiteSetting" (id, "businessName", "updatedAt") VALUES ('default', 'Wild Mountain', $1) ON CONFLICT (id) DO UPDATE SET "businessName" = 'Wild Mountain'`, [now]);

    await c.query(fs.readFileSync(path.join(dir, TARGET, "migration.sql"), "utf8"));
  }, 60_000);

  afterAll(async () => {
    await c?.end();
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
  });

  const rows = async (sql: string) => (await c.query(sql)).rows;

  it("leaves every historical number and the old counters untouched, and adds the new counters at 2000", async () => {
    expect(await rows(`SELECT number FROM "QuoteRequest" UNION ALL SELECT number FROM "Order" UNION ALL SELECT number FROM "Invoice"`)).toEqual([{ number: "WMQ-1001" }, { number: "WMO-1001" }, { number: "WMI-1001" }]);
    expect(await rows(`SELECT key, value FROM "Counter" ORDER BY key`)).toEqual([
      { key: "WMWI", value: 2000 },
      { key: "WMWO", value: 2000 },
      { key: "WMWQ", value: 2000 },
      { key: "invoice", value: 1001 },
      { key: "order", value: 1001 },
      { key: "quote", value: 1001 },
    ]);
    // The next issued number (same upsert as nextNumber) is 2001.
    const next = await rows(`INSERT INTO "Counter" ("key", "value") VALUES ('WMWQ', 2001) ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1 RETURNING "value"`);
    expect(next).toEqual([{ value: 2001 }]);
  });

  it("corrects the short business name in editable content only", async () => {
    expect(await rows(`SELECT subject, heading, body FROM "EmailTemplate" WHERE key = 'order_ready'`)).toEqual([
      { subject: "Your Wild Mountain Woodworks piece is ready", heading: "Wild Mountain Woodworks' workshop", body: "Hi {{firstName}}, your Wild Mountain Woodworks piece is ready. — Wild Mountain Woodworks" },
    ]);
    expect(await rows(`SELECT "businessName" FROM "SiteSetting"`)).toEqual([{ businessName: "Wild Mountain Woodworks" }]);
    // History is never rewritten.
    expect(await rows(`SELECT subject, text FROM "EmailLog"`)).toEqual([{ subject: "Your Wild Mountain quote WMQ-1001", text: "Wild Mountain" }]);
    expect(await rows(`SELECT "customerNotes" FROM "Invoice"`)).toEqual([{ customerNotes: "Thanks from Wild Mountain" }]);
  });
});
