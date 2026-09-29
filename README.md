# Wild Mountain Woodworks

**Built by hand. Made to belong.**

The website and business admin for Wild Mountain Woodworks, a handcrafted furniture company in Ohio.

It launches as a **quote-first furniture catalog**. Customers browse pieces, configure them (size, wood, finish, base, add-ons) and send **Request This Configuration**. Every request lands in the admin with an exact, immutable record of what was chosen.

It is built as an **e-commerce platform with purchasing turned off**. Server-side pricing, cart pricing, orders, Stripe Checkout and the webhook already exist behind feature flags. Turning on online sales later won't require rebuilding the catalog or the database.

---

## Contents

1. [What's included](#whats-included)
2. [Tech stack](#tech-stack)
3. [Local development](#local-development)
4. [Admin accounts](#admin-accounts)
5. [How the site is organized](#how-the-site-is-organized)
6. [Images, media library and cropping](#images-media-library-and-cropping)
7. [Products, options, add-ons and pricing](#products-options-add-ons-and-pricing)
8. [Quotes and historical snapshots](#quotes-and-historical-snapshots)
9. [Feature flags and future e-commerce](#feature-flags-and-future-e-commerce)
10. [Email notifications](#email-notifications)
11. [Environment variables](#environment-variables)
12. [Deploying to Railway](#deploying-to-railway)
13. [Cloudflare R2 setup](#cloudflare-r2-setup)
14. [Backups and recovery](#backups-and-recovery)
15. [Security](#security)
16. [Testing and QA](#testing-and-qa)
17. [Sample content](#sample-content)
18. [Brand assets](#brand-assets)
19. [Before launch: owner checklist](#before-launch-owner-checklist)

---

## What's included

**Public site**
- Pages: home, furniture catalog (`/furniture`), category pages (`/furniture/dining-tables`), product pages (`/furniture/ridge-dining-table`), custom furniture, Our Work portfolio with project pages, about, FAQ, contact and request-a-quote.
- Customer care and policy pages: shipping and delivery, returns and cancellations, warranty, wood characteristics, furniture care, privacy and terms.
- **Product configurator:**
  - Option inputs: buttons, image tiles, finish swatches, dropdown and radio.
  - Add-ons with quantities.
  - A live estimate.
  - Custom-size details.
  - An inline request form with optional reference photos.
  - On phones, a sticky "Request" bar.
- **SEO:**
  - Per-page titles and descriptions, canonical URLs, OpenGraph and Twitter cards.
  - `sitemap.xml` and `robots.txt`.
  - Breadcrumbs.
  - Structured data: Product (with made-to-order offers), FurnitureStore, FAQPage and BreadcrumbList.
- **Accessibility:**
  - Semantic landmarks and a skip link.
  - Visible focus states and labelled form fields.
  - Keyboard-operable configurator, gallery and lightbox; menus and dialogs use native `<dialog>`; accordions use native `<details>`.
  - Reduced-motion support.

**Admin (`/admin`)**
- **Dashboard:** real counts only, recent activity and a launch checklist. No invented analytics.
- **Products:**
  - Editor sections: basic info, pricing, gallery, options, add-ons, specifications, production, delivery, SEO and publishing.
  - Publishing actions: save draft, preview, publish, unpublish, archive, restore, delete (only when safe) and duplicate.
  - Gallery: unlimited images, drag-and-drop ordering and a primary image.
- **Categories, Options (global library with per-product overrides) and Add-ons** (reusable, with per-product overrides).
- **Homepage editor:** each section's copy, images, calls to action and visibility; which products, projects and categories are featured.
- **Pages:** structured section editors plus Markdown policy bodies, SEO and social images, and "needs owner/legal review" flags.
- **Portfolio / Our Work, FAQs** (with categories), and **Media library:**
  - Upload, search and filter.
  - Alt text, focal-point cropping and replacing a file everywhere it's used.
  - Usage tracking and safe delete.
- **Quotes, Custom Requests and Messages:** statuses, status history, internal notes and private reference images.
- **Settings:** business details, social links, SEO defaults and feature flags. Also your account password, admin users and a system status panel.
- **Future Orders:** the order-management screens, ready for when checkout is enabled.
- **Pricing Calculator:** internal cost-and-margin pricing for custom work ([details](#internal-pricing-calculator)).

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, React 19, Server Components, Server Actions, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 with design tokens in `src/app/globals.css` |
| Database | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) |
| Validation | Zod (the same schemas run in the browser and on the server) |
| Images | `next/image` + `sharp`; object storage on Cloudflare R2 (S3 API) or local disk |
| Auth | Custom admin sessions: bcrypt password hashes, a random session token in an httpOnly cookie, and only a SHA-256 hash of the token stored in PostgreSQL |
| Tests | Vitest (unit and database integration tests), Playwright (site QA crawler) |
| Hosting | Railway |

Fonts: Cormorant Garamond (display serif) and Manrope (sans). Both are self-hosted under the SIL Open Font License.

## Local development

**Requirements:** Node.js 22 or later, and PostgreSQL 14 or later.

```bash
cp .env.example .env            # then edit DATABASE_URL (and TEST_DATABASE_URL for tests)
npm install                     # also generates the Prisma client
npx prisma migrate dev          # create the database schema
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-unique-passphrase-1' npm run db:seed
npm run dev                     # http://localhost:3000  ·  admin at /admin
```

The seed:
- Is safe to run repeatedly and never overwrites content you've edited.
- Creates the settings row with the launch feature flags, and every CMS page and section.
- Creates your first admin account, if one doesn't exist yet.
- Adds **sample content** into an empty catalog.

Useful scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run check` | Lint + typecheck + tests |
| `npm run lint`, `npm run typecheck`, `npm test` | Individually |
| `npm run db:migrate` | Apply migrations (production) |
| `npm run db:migrate:dev` | Create and apply a migration (development) |
| `npm run db:seed` | Seed (idempotent) |
| `npm run admin:create -- --email … --name "…"` | Create an admin, or reset a password with `--reset` |
| `npm run qa` | Crawl the running site for errors, overflow, broken images and links |
| `npm run brand` | Regenerate the logo files from the brand fonts |

## Admin accounts

There are no customer accounts. Only administrators sign in, at `/admin/login`.

**First admin.** Choose one:
- Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (and optionally `ADMIN_NAME`) and run `npm run db:seed`. The account is created only if that email doesn't exist yet.
- Run `npm run admin:create -- --email owner@example.com --name "Your Name"`. It prompts for a hidden password.

**Password rules:** at least 12 characters, with letters and at least one number or symbol.

**Forgotten password:** `npm run admin:create -- --email owner@example.com --reset`. This also signs out that user's existing sessions.

**More admins:** owners can add, deactivate and reactivate admins in **Settings → Admin users**. Everyone can change their own password in **Settings → Your account**.

Sessions last 7 days and extend while you use them. Login is rate-limited per IP address and per email.

**How admin pages are protected:**
- A lightweight `src/proxy.ts` redirects signed-out visitors away from `/admin`.
- The real check is `requireAdmin()`. It validates the session against the database on every admin page, server action and admin API route.

## How the site is organized

```
prisma/                 schema, migrations, seed (+ seed-data/: copy, catalog, generated sample imagery)
scripts/                brand generator, admin CLI, QA crawler, maintenance helpers
src/app/(site)/         public pages (server components) + public server actions
src/app/admin/          admin (login, (panel) pages, preview routes)
src/app/api/            health check, admin media/attachment APIs, Stripe webhook
src/components/         brand, ui, site, product, portfolio, forms, media, admin/*
src/lib/                domain logic:
  pricing/              configuration engine, override resolver, snapshots (pure + tested)
  catalog/              public read models, slug rules
  cms/                  page/section definitions + reader
  media/                upload validation, processing, usage tracking, image slots
  storage/              object storage abstraction (R2 / local)
  services/             quote, custom request and contact submission services
  commerce/             cart pricing, checkout, Stripe provider (dormant)
  email/                provider abstraction + notification templates
  auth/                 passwords, sessions, tokens
```

**The CMS is structured, not a page builder.** `src/lib/cms/definitions.ts` lists every page, its sections, which fields each section has, and the display ratio for each image location. All the copy, images, calls to action and visibility are stored in the database and edited in admin.

If a section is added to the code later, the site still renders it with empty values until you fill it in.

**Public pages are rendered on each request.** Admin changes show up immediately, and builds never need the database.

## Images, media library and cropping

- **Binaries are never stored in PostgreSQL.** Files go to object storage: Cloudflare R2 in production, or local disk in development. PostgreSQL stores only metadata: storage key, URL, filename, size, dimensions, alt text, focal point and a tiny blur placeholder.
- **Every public photograph is chosen in admin.** Images are referenced by foreign keys: product and portfolio galleries, category images, page sections and items, option swatches, add-ons, and social images. None are hardcoded. (The only static images are the brand logo files and the generic fallback social card.)
- **Images never break layouts.** Each design location has a fixed display ratio (`src/lib/media/slots.ts`). The original upload is never altered; it's cropped at display time around the image's **focal point**. You set the focal point in **Media → (image)**, with live previews of every crop.
- **Replace** swaps the file behind an image everywhere it's used, keeping its alt text and focal point.
- **Safe delete:** "This image is currently used in N locations" is shown with links. Deleting then requires you to choose either Replace, or "Remove from all locations and delete".
- **Upload checks:** JPG, PNG, WebP and AVIF only. The extension, the declared type and the actual file contents must all agree, and there are size and pixel limits. Customer reference photos are stored under a private prefix and are only ever served to signed-in admins.
- Optimized images are served by `next/image`: AVIF/WebP in responsive sizes, lazy-loaded below the fold.

## Products, options, add-ons and pricing

- **Product statuses** are `DRAFT`, `ACTIVE` and `ARCHIVED`.
  - Only ACTIVE products appear publicly.
  - Saving never publishes.
  - Drafts can be previewed securely at `/admin/preview/product/{id}`.
  - Products referenced by quotes or orders can only be archived, never deleted.
- **Slugs** are generated once and never change automatically when a name changes. They're unique across both products and categories, which share `/furniture/[slug]`.
- **Option library.** Global option groups (for example Wood Species or Standard Finishes) hold values with price modifiers, images or swatches, and a "custom" flag.
  - Products attach groups and can **disable values, override prices, override the order and choose a default**, per product.
  - Values without an override follow the library automatically.
- **Add-ons** are reusable or product-specific, with required, minimum and maximum quantities. Products can override the price, required flag and quantities.
- **Pricing engine** (`src/lib/pricing/engine.ts`): base price + option modifiers + add-ons × quantity.
  - The same pure function gives the live estimate in the browser.
  - The server always re-prices from the database before storing anything. **Prices sent by a browser are never trusted** — there isn't even a price field to send.
- **Showing prices.** Prices appear when Settings → Show prices *and* the product's own Show price setting are both on.

## Internal pricing calculator

**Admin → Pricing Calculator** (`/admin/pricing-calculator`) is a staff-only decision-support tool. Customers never see it, and it never publishes a price or changes a product on its own.

- **Inputs:** project details (product type, dimensions, wood species), board-foot lumber lines (thickness × width × length ÷ 12 × quantity, with a waste factor), material line items tagged either *Material* or *Finishing / shop supply*, other direct costs (delivery, installation, outsourced work, other), labor as build hours × shop rate or by phase, overhead as a percentage of direct costs *or* monthly overhead ÷ expected projects, and a target margin (presets 25–45%).
- **Material cost** means every direct physical material in the piece: lumber, legs/bases, chairs if included, hardware, drawer slides, hinges, fasteners, epoxy/resin and purchased components. Finishing consumables and shop supplies are tracked separately, so nothing is counted twice. Labor never counts toward the floor.
- **Pricing method** (`src/lib/pricing/estimator.ts`):
  1. *30% pricing floor* = material cost ÷ 0.30.
  2. *Detailed cost-based price* = total cost ÷ (1 − margin). Margin is not markup: $1,000 of cost at a 35% margin is $1,538.46, not $1,350.
  3. *Base recommended price* = MAX(floor, detailed). The two are never averaged.
  4. *Value adjustments* are optional $ or % premiums (custom design, complexity, premium hardwood, rush order and so on). They are added only when you enter them. The result is optionally rounded **up** to the nearest $10, $25, $50 or $100, so it never lands below the floor. This gives the *Final recommended price*.
  5. *Final selling price* is either the recommendation or your manual override. An override is never blocked. Below the floor, the calculator shows "WARNING: This price is below the 30% material-cost pricing floor." together with the material cost, the floor, your price and the materials share.
- **Profit breakdown:** selling price, material cost and its % of the sale, labor, other direct costs, gross profit and gross margin. Overhead and net profit are shown separately. Also includes a visual breakdown and advisory warnings.
- **Deposit:** the default is 50%, editable per estimate and in the defaults. The calculator shows the deposit due and the remaining balance. It also shows whether the deposit covers the material cost and how much is left after materials.
- **Estimates** can be saved, duplicated, archived, started from a product (loading its internal material-cost and labor-hour estimates) or from a quote, and converted into a quote. **Update product pricing** is a deliberate action that pushes only the values you tick to the product.
- **Defaults** (shop labor rate, waste %, overhead, target margin, warning thresholds, rounding, deposit %) live in **Settings → Pricing calculator defaults** (`/admin/settings/pricing`).

## Quotes and historical snapshots

When a customer sends a configuration request, the server:
1. Validates it (the same rules run in the browser for convenience).
2. Checks the honeypot, a minimum fill time and a per-IP rate limit.
3. Reloads the product and re-prices it.
4. Stores a `QuoteRequest` with an **immutable configuration snapshot**: the product name and SKU, every option and value name, custom details, the add-ons and every price at that moment (`src/lib/pricing/snapshot.ts`).

Editing or deleting the product later never changes what the customer asked for. Future order items use the same snapshot format.

Reference numbers look like `WM-Q-260927-7KD4` (quotes) and `WM-C-…` (custom requests).

## Feature flags and future e-commerce

**Settings → Features:**

| Flag | Launch value | Effect |
| --- | --- | --- |
| Show prices | on | Show "From" prices and live estimates |
| Quotes enabled | on | "Request This Configuration" and `/request-quote`. When off, customers are pointed to Contact |
| Custom orders enabled | on | Custom build form |
| E-commerce enabled | **off** | See below |

E-commerce is only **effective** when all three of these are true. Until then the site stays in quote mode, so turning the switch on early can never expose a half-built checkout.
1. The Settings switch is on.
2. The Stripe keys are configured.
3. The cart and checkout pages have shipped: `CHECKOUT_UI_READY` in `src/lib/commerce/config.ts`.

**Already built for commerce:**
- `Order`, `OrderItem` (with snapshots), status and production-status history, and the admin order screens.
- `priceCart()`, which re-prices every line from the database.
- `startCheckout()`, which creates a `PENDING_PAYMENT` order and hands off to Stripe-hosted Checkout.
- `StripeCheckoutProvider`: guest checkout, no Stripe Customer, and **no `setup_future_usage`, so cards are never saved**.
- A signature-verified webhook at `/api/stripe/webhook`. It is inert without `STRIPE_WEBHOOK_SECRET`, and it is the only thing that can mark an order PAID.

**To launch online sales later:**
1. Build the cart and checkout pages that call `priceCart` / `startCheckout`, then set `CHECKOUT_UI_READY = true`.
2. Set `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`, and point a Stripe webhook at `/api/stripe/webhook` for `checkout.session.completed`.
3. Decide on tax (e.g. Stripe Tax) and delivery charges in `startCheckout`.
4. Turn on **Settings → E-commerce**. Product buttons switch from "Request This Configuration" to "Add to Cart" automatically.

Card numbers never touch this application.

## Email notifications

`src/lib/email/` separates the email provider from the notification templates. It includes:
- A new-quote notification to you, and a quote confirmation to the customer.
- A custom-request notification to you, and a confirmation to the customer.
- A contact-message notification to you, and a confirmation to the customer.
- A future order confirmation.

Supported providers are **Resend** and **Postmark** (via HTTP, no SDK), selected with `EMAIL_PROVIDER`. Without a provider, emails are only logged.

**Submissions are always stored first and are visible in admin whether or not email is configured.** Email failures are logged and never shown to customers.

Notifications go to Settings → Notification email, or else Settings → Email, or else `ADMIN_NOTIFICATION_EMAIL`.

## Environment variables

See `.env.example` for a commented template.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | PostgreSQL connection string. On Railway: `${{Postgres.DATABASE_URL}}` |
| `NEXT_PUBLIC_SITE_URL` | **yes (prod)** | Public origin, e.g. `https://wildmountainwoodworks.com`. Used for canonical URLs, sitemap, OpenGraph and email links. If missing, `RAILWAY_PUBLIC_DOMAIN` is used |
| `STORAGE_DRIVER` | yes (prod) | `r2` in production, `local` in development |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | with R2 | Keep these secret |
| `R2_PUBLIC_URL` | with R2 | Public bucket URL or custom domain. **Must be available at build time** (it configures `next/image`) |
| `LOCAL_STORAGE_DIR` | no | Local driver folder (default `./storage`). On Railway, only use it with a mounted Volume |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | no | First admin, created by the seed |
| `SEED_SAMPLE_CONTENT` | no | `false` to skip sample content |
| `EMAIL_PROVIDER` | no | `resend` or `postmark` |
| `EMAIL_FROM` | with email | e.g. `Wild Mountain Woodworks <hello@yourdomain.com>` |
| `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN` | with email | Keep secret |
| `ADMIN_NOTIFICATION_EMAIL` | no | Fallback recipient for notifications |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | no (future) | **Not needed now.** The site runs fully without them |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error` |
| `DATABASE_POOL_SIZE` | no | Default 10 |
| `TEST_DATABASE_URL` | tests | A separate database for integration tests. Never your real data |

Secrets are only read on the server. Only variables prefixed `NEXT_PUBLIC_` are sent to browsers, and none of them are secrets.

## Deploying to Railway

`railway.json` builds with `npm run build` and starts with `npm run start:production` (`scripts/start-production.sh`), which applies migrations, runs the idempotent seed (settings, pages, first admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, sample content into an empty catalog) and then starts the server. The health check at `/api/health` reports `not_configured`, `unreachable` or `migrations_pending` if the database isn't ready.

1. **Create a project** in Railway, **add PostgreSQL**, then **Deploy from GitHub** with this repository.
2. **Set service variables** on the web service:
   - `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
   - `NEXT_PUBLIC_SITE_URL = https://your-domain` (or your Railway domain at first)
   - `STORAGE_DRIVER = r2` plus the `R2_*` variables ([see below](#cloudflare-r2-setup))
   - Optionally the email variables.
3. **Deploy.** Migrations run automatically in the pre-deploy step, and builds don't need database access.
4. **Seed once** to create pages, settings, sample content and your admin, from your computer using the database's *public* URL (Railway → Postgres → Connect):
   ```bash
   DATABASE_URL="<public postgres url>" STORAGE_DRIVER=r2 R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… \
   R2_SECRET_ACCESS_KEY=… R2_BUCKET=… R2_PUBLIC_URL=… \
   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run db:seed
   ```
   Or open a shell in the running service with `railway ssh` and run `npm run db:seed` there; it then uses the service's own variables and private network. (`railway run` executes on your computer, where the private `*.railway.internal` database host isn't reachable.) Add `SEED_SAMPLE_CONTENT=false` if you want to start with an empty catalog.
5. **Custom domain:** add it in Railway → Settings → Networking, then update `NEXT_PUBLIC_SITE_URL`.
6. Sign in at `/admin`, work through the dashboard's **Launch checklist**, and replace the sample content.

Notes:
- The app listens on Railway's `PORT` automatically.
- Logs are structured JSON (one line per event) and can be searched in Railway's log viewer.
- Without R2 you can use a **Railway Volume**: mount it at `/data`, set `STORAGE_DRIVER=local` and `LOCAL_STORAGE_DIR=/data/storage`. R2 is recommended because it's cheaper, backed up separately and served from a CDN.
- Scaling out: sessions and rate limits live in PostgreSQL, so multiple instances work. Use R2 in that case, since a Volume can only be attached to one instance.

## Cloudflare R2 setup

1. In Cloudflare → R2, **create a bucket**, e.g. `wild-mountain-media`.
2. **Enable public access** for images:
   - Best: connect a **custom domain** such as `media.wildmountainwoodworks.com`, which is served through Cloudflare's CDN.
   - Or: enable the `r2.dev` public URL.
3. Set `R2_PUBLIC_URL` to that base URL, with no trailing slash.
4. **Create an API token:** R2 → Manage API Tokens → *Object Read & Write*, limited to this bucket. Copy the **Access Key ID** and **Secret Access Key** into `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. Your **Account ID** goes in `R2_ACCOUNT_ID`.
5. Set `STORAGE_DRIVER=r2` and `R2_BUCKET`.

**Object key layout:**
- `media/YYYY/MM/<random>-<name>.<ext>` holds public site images. They're cached forever, because a replaced image always gets a new key.
- `private/YYYY/MM/…` holds customer reference photos. The random keys aren't listed anywhere, and admins view these files only through the authenticated `/api/admin/attachments/{id}` route. For stricter isolation you can keep private files in a second, non-public bucket; the storage driver is the only place that would change.

Uploads go from the server to R2, so no bucket CORS configuration is needed.

## Backups and recovery

- **Database:** turn on Railway's PostgreSQL backups for your plan, and also take periodic off-site dumps:
  ```bash
  pg_dump "$DATABASE_PUBLIC_URL" -Fc -f wildmountain-$(date +%F).dump      # backup
  pg_restore --clean --no-owner -d "$TARGET_DATABASE_URL" wildmountain-YYYY-MM-DD.dump   # restore
  ```
  The database holds all products, content, quotes, requests and messages.
- **Images (R2):** turn on bucket **object versioning** or lifecycle rules, or periodically copy the bucket with `rclone sync` to a second bucket or your computer. Replacing or deleting an image in admin removes the old object.
- **Local development only:** the `./storage` folder holds uploaded files and is git-ignored.
- **Test a restore** once before launch.

## Security

- **Admin access:** routes are protected on the server. Sessions use httpOnly, Secure (in production) and SameSite=Lax cookies, and only token hashes are stored. Accounts can be deactivated. Login is rate-limited and the timing of failed attempts is evened out.
- **Input:** every input is validated on the server with Zod; the same rules also run in the browser. Markdown is rendered without raw HTML, and link fields reject `javascript:` URLs.
- **Public forms:** a honeypot, a minimum fill time (a submit that's too fast is asked to try again, never silently dropped), and PostgreSQL-backed per-IP rate limits.
- **Uploads:** checked by type, extension, actual decoded contents, size and pixel limits.
- **HTTP headers:** a Content-Security-Policy, HSTS (in production), `X-Frame-Options: DENY`, `nosniff`, a Referrer-Policy and a Permissions-Policy. Admin pages send `X-Robots-Tag: noindex`.
- **Prices** are always recalculated on the server. **Stripe** is hosted Checkout only, and no card data is ever stored.
- **Secrets** exist only in environment variables and are never shown in the admin.

## Testing and QA

```bash
npm run check          # eslint + tsc + vitest
```

- **Unit tests** (`tests/unit`) cover:
  - The pricing engine: base + modifiers + add-ons, quantity limits, required and custom options, tampered selections.
  - Per-product option and add-on overrides.
  - Configuration snapshots and their immunity to later edits.
  - Form validation and upload rules.
  - Money, slug and reference helpers.
  - Password and session token handling.
  - Stripe webhook signature verification.
- **Integration tests** (`tests/integration`) run against `TEST_DATABASE_URL`; migrations are applied automatically, and the tests are skipped if the variable isn't set. They cover:
  - Creating quotes with server-side re-pricing and stored snapshots.
  - Rejecting draft and archived products, and invalid or disabled selections.
  - The feature flags.
  - Private attachment storage and rejection of disguised files.
  - Public visibility and archive rules, and slug collisions.
  - Media usage, safe and forced delete, and replace.
  - Session authentication (forged, expired and deactivated sessions) and rate limiting.
- **Site QA crawler:** `QA_BASE_URL=http://localhost:3000 npm run qa` checks every public page at 1440, 1024, 768 and 390px wide for:
  - HTTP errors and console errors.
  - Horizontal overflow.
  - Broken images and broken internal links.
  - Tap targets smaller than 24px.
  - Missing `h1`s, alt attributes and form labels.

  Add `QA_ADMIN_COOKIE="wm_admin_session=…"` to check admin pages too; `npx tsx scripts/dev-session.ts` prints a cookie in development.

## Sample content

On an empty database, the seed adds editable demonstration content:
- Products: **The Ridge Dining Table** (the exact size, wood, finish, base and add-on setup from the brief, starting at $1,295), The Heritage Dining Table, The Timberline Bench, The Summit Console and The Overlook Coffee Table, plus one draft product.
- Five portfolio projects, the FAQs and category images.
- About 54 generated placeholder "studio" images.

The placeholder images are illustrations, not photographs of real work. They go through the normal media pipeline, so every one can be replaced in admin.

Sample products, projects and images are marked *Sample content* in admin. **Dashboard → Remove sample content** clears them in one step. Products that already have quotes are archived rather than deleted.

The sample copy doesn't claim anything about your history, experience, awards or customers. Where a description should state how a piece is actually built, the text says so.

## Brand assets

The logo system is generated from the brand fonts with the lettering converted to vector outlines (`npm run brand` → `scripts/generate-brand.ts`), so it looks identical everywhere and can be used for engraving or a branding iron.

| Asset | Files |
| --- | --- |
| Primary horizontal logo | `public/brand/wild-mountain-horizontal-{dark,light}.{svg,png}` |
| Stacked logo (with ridge line) | `public/brand/wild-mountain-stacked-{dark,light}.{svg,png}` |
| Compact stacked | `public/brand/wild-mountain-compact-{dark,light}.{svg,png}` |
| WM monogram / maker's mark | `public/brand/wild-mountain-monogram-{dark,light}.{svg,png}` |
| Favicon / site mark | `src/app/icon.svg`, `src/app/apple-icon.png`, `public/brand/wild-mountain-sitemark-*` |
| Default social card | `public/brand/wild-mountain-social-card.png` |

In code, use `<Logo variant="horizontal | stacked | compact | monogram" />`. It uses `currentColor`, so the light and dark versions are just text colors.

**Palette:**
- Mountain Charcoal `#1F1E1C`
- Warm Ivory `#F7F3EC`
- Stone `#E3DBCE`
- Walnut `#5A3E2B`
- Muted Bronze `#9A7B4F` (bronze text uses `#7A5C36` for contrast)

## Before launch: owner checklist

The admin **Dashboard → Launch checklist** tracks most of these.

- [ ] **Settings:** contact email, phone, notification email, service area and social links.
- [ ] **Policy pages** (Pages → *Needs owner/legal review*):
  - Fill in every **[Owner to confirm]** item.
  - Have the privacy policy, terms, warranty and returns pages reviewed by a qualified professional.
  - Then click *Mark as reviewed*.
- [ ] **About → "The maker"** (hidden until you enable it): add your own story.
- [ ] **Photography:** replace the sample imagery with real photographs and add alt text. Set focal points where crops matter.
- [ ] **Products:** replace the sample descriptions and construction notes with your real methods, then confirm prices, option modifiers and lead times.
- [ ] **Sample content:** remove it from the Dashboard when you're ready.
- [ ] **Email:** configure a provider and send yourself a test quote.
- [ ] **Launch settings:** set `NEXT_PUBLIC_SITE_URL` to the final domain and test a database backup restore.
