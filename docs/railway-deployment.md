# Railway deployment: current setup and Infrastructure as Code migration

**Status (September 2026):** this service is configured with `railway.json`, Railway's *Config as Code*. Railway has deprecated Config as Code in favour of *Infrastructure as Code*, and existing Config as Code services have a **hard cutoff on December 1, 2026**.

**Plan:** migrate **by November 15, 2026**, leaving two weeks to spare. Try it on a staging environment first (step 3).

**Nothing has been migrated yet.** `railway.json` is still what production uses. Don't delete or rename it until the replacement has been verified (see the checklist).

This note records exactly what the current deployment does, what any replacement must keep, and how to migrate safely. It doesn't give the Infrastructure as Code syntax: take that from Railway's current documentation when you do the migration.

## Incident, September 30, 2026: pre-deploy didn't run

**What happened:**
- Deploy `1a8f24d` moved migrations from the start script to the pre-deploy step.
- On Railway the pre-deploy step didn't run, so the three migrations that followed were never applied.
- Pages that read the new product columns returned errors (home, `/furniture`, `/furniture/sale`, product pages). Pages without products (About, FAQ, Contact) kept working.
- The health check only verified that the core tables existed, so Railway marked the deploys healthy.

**What changed:**
- **Health check:** it now fails (503 `migrations_pending`) whenever any shipped migration is missing.
- **Start script:** it repeats migrations and the production-safe seed as a safety net before starting.

**Still to confirm in the Railway dashboard:** why the pre-deploy command didn't run (see step 1 of the checklist, and section 4). With the safety net, the site stays correct either way.

---

## 1. Current setup: `railway.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "RAILPACK", "buildCommand": "npm run build" },
  "deploy": {
    "preDeployCommand": ["npm run deploy:prepare"],
    "startCommand": "npm run start:production",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

## 2. The deployment contract: what must stay the same

Every row must have an equivalent after the migration. `tests/unit/deploy-config.test.ts` checks these values in `railway.json` today; point it at the new configuration when you migrate.

| Setting | Value | Why | If it's lost |
| --- | --- | --- | --- |
| Builder | Railpack | Detects Node and installs dependencies, including `tsx` and the `prisma` CLI, which pre-deploy needs | The build may use a different toolchain or fail |
| Build command | `npm run build` | `prisma generate` + `next build`. Needs no database access | No Prisma client, so the build fails |
| **Pre-deploy command** | **`npm run deploy:prepare`** | Runs `scripts/predeploy.sh`: `prisma migrate deploy`, then the production-safe seed (`scripts/seed-production.ts`). Once per deploy, before traffic switches; any failure stops the deploy | **Most dangerous loss.** The new code starts against an **unmigrated database**, and required pages/settings for new features are never created. There's no loud failure: pages that use new columns start erroring |
| Start command | `npm run start:production` | Safety net: repeats `prisma migrate deploy` and the production-safe seed (no-ops when pre-deploy ran), then starts Next.js on `$PORT`. A failure exits before Next.js starts | Without pre-deploy, nothing applies migrations |
| Health check path | `/api/health` | Returns 200 only when the database is configured, reachable and has **every migration this build ships** (503 `migrations_pending` with the list otherwise) | Railway can switch traffic to a deploy whose pages fail |
| Health check timeout | 300 s | Gives the first request time to boot | Slow boots are marked failed |
| Restart policy | `ON_FAILURE`, max 5 retries | Recovers from crashes without restart loops | Crashed instances stay down, or loop forever |

**Pre-deploy must stay one command: `npm run deploy:prepare`.** Don't split it into separate "migrate" and "seed" entries in the new format. The script already runs them in the right order and stops at the first failure.

### Settings that live in the Railway dashboard, not in `railway.json`

The migration shouldn't change these, but record them before you start, because Infrastructure as Code may begin managing some of them:

- **Variables** (names only here; keep the values in your password manager):
  - Always: `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (the private-network reference), `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `STORAGE_DRIVER`, and the `R2_*` variables.
  - Optional: `SITE_TIME_ZONE`, `ADMIN_URL`, `TRUST_CLOUDFLARE`, `ADMIN_SESSION_*`, and the `EMAIL_*`/provider keys.
  - `ADMIN_EMAIL`/`ADMIN_PASSWORD` are needed only for the very first deploy.
  - See README → Environment variables.
- **Source:** the GitHub repository, the deploy branch, and "Wait for CI" if you enabled it.
- **Networking:**
  - The custom domain(s) and the Railway domain.
  - The **Postgres public TCP proxy stays off**: the database is reachable only over private networking.
- **Postgres service:** plan, backups, region.
- **Replicas / region**, and a Volume if you use local storage instead of R2.

**Secrets must never go into a committed IaC file.** Keep them as Railway variables (or whatever secret mechanism Railway's IaC documents), referenced by name.

## 3. Migration checklist

Do these in order. Stop at any step that doesn't behave as described.

1. **Read Railway's current Infrastructure as Code docs.** Confirm and write down:
   - how a service's build command, **pre-deploy command**, start command, health check and restart policy are expressed;
   - that the pre-deploy step still runs once per deploy, before traffic switches, with the service's variables and private network, and that a non-zero exit stops the deploy;
   - which wins when both `railway.json` and the new configuration exist, and whether Railway offers an automatic conversion;
   - whether IaC also manages variables, domains or the Postgres service, and how it handles secrets.
2. **Back up first.**
   - Take a database dump (README → Backups and recovery).
   - Screenshot each tab of the service's Settings.
   - Note the ID of the current successful deployment, so you can roll back.
3. **Create a staging environment.** In Railway, add an environment (for example `staging`) with its own Postgres. Don't point it at the production database. Set the same variables, with a different `NEXT_PUBLIC_SITE_URL`.
4. **Write the IaC configuration** so it covers every row of the contract table. Use Railway's conversion tool if it offers one, then check the result against the table line by line. It must include the pre-deploy command `npm run deploy:prepare`.
5. **Update the guard test.** Point `tests/unit/deploy-config.test.ts` at the new configuration and check the same values. Run `npm run check`.
6. **Deploy to staging and verify** (section 4). Also check that a deliberately broken pre-deploy (for example a temporary bad `DATABASE_URL` on staging only) **stops** the deploy.
7. **Switch production**, following the precedence rules you found in step 1. In one commit, add the IaC configuration and remove `railway.json`, unless the docs say to keep both during a transition. Deploy, then verify production (section 4).
8. **Update this note** and the README's "Deploying to Railway" section to describe the new setup. Remove the deprecation warning.

### Rollback

If production misbehaves after the switch, first redeploy the previous successful deployment from the dashboard. That restores the old code, and a still-present `railway.json` if it was in that commit.

The production seed only inserts records. Migrations normally only add to the schema. The one exception is `20261005000000_sales_quotes_invoices_orders` (see below): it renames and replaces columns while keeping the data. Code from before it can't run against a database that has it.

### The sales migration (quote → invoice → order)

`20261005000000_sales_quotes_invoices_orders` runs automatically in pre-deploy and keeps all existing data:

- **Quote statuses.** Every existing quote request is kept. Statuses are mapped: CONTACTED → REVIEWING and QUOTED → SENT.
- **Quote numbers.** Quotes that existed before the sales system are numbered WMQ-1001… by date (their old `WM-Q-…` references still work). Records created after migration `20261015000000_wmw_numbering_brand` use WMWQ-2001…, WMWO-2001… and WMWI-2001…; earlier numbers are never rewritten.
- **Customers.** One customer is created per exact email address, and quotes are linked to it.
- **Revisions.** Each old quote gets its first draft revision (and secure link) the first time it's opened in admin.
- **Settings.** `ecommerceEnabled` is renamed to `stripeInvoicingEnabled` (it was never on).
- **Orders.** Legacy order statuses map into separate production, payment and delivery statuses. No orders are expected in production.

Take a database backup before deploying it. If you need to roll back past it, restore that backup together with the previous deployment.

After it deploys, the seed adds the editable email templates and the starter quote terms. Nothing else is needed. Online payments (Stripe) stay off until you set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and turn on the Settings switch (see README → Sales).

## 4. Verifying a deploy

In the **deploy logs**, in this order:

```
[predeploy] applying database migrations…
… All migrations have been successfully applied.   (or "No pending migrations to apply.")
[predeploy] inserting missing required content (production-safe, insert-only)…
[seed:production] done — …
[predeploy] done.
[start] ensuring database migrations are applied (normally already done by pre-deploy)…
… No pending migrations to apply.
[start] ensuring required content exists (production-safe, insert-only)…
[seed:production] done — everything required already exists; nothing changed.
[start] starting Next.js on port …
```

Then:

- `GET /api/health` returns `{"status":"ok","database":"ok","adminAuth":"ok",…}`.
- The home page, `/furniture`, `/furniture/sale` and a product page load.
- Admin sign-in with two-factor works, and Admin → Promotions and Pages → Sale collection open.
- Admin → Quotes, Orders, Invoices, Payments, Customers and Emails open; existing quote requests are listed with their original WMQ numbers; new ones get WMWQ numbers.

If the `[predeploy]` lines are **missing**, the pre-deploy command isn't running. The start script's safety net keeps the site working, but fix the configuration: in Railway → the web service → **Settings → Deploy → Pre-deploy Command**, it should read `npm run deploy:prepare`. When pre-deploy runs, the `[start]` step reports "No pending migrations" and "nothing changed".
