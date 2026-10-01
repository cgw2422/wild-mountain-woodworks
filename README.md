# Wild Mountain Woodworks

**Built by hand. Made to belong.**

The website and business admin for Wild Mountain Woodworks, a handcrafted furniture company in Ohio.

Wild Mountain Woodworks sells custom furniture through **quotes, not a shopping cart**. Customers browse pieces, configure them (size, wood, finish, base, add-ons, quantity) and **request a quote**. Wild Mountain Woodworks prices and sends the quote, the customer accepts it on a secure page, and the sale continues as **invoices → payments → an order in production → delivery**.

Wild Mountain Woodworks owns the whole quote workflow. Stripe is optional and only takes money: hosted **Checkout** for online payments and **Terminal** for in-person cards (no Stripe Quotes, no Stripe Invoicing in the normal flow, no cart).

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
9. [Sales: quotes, invoices, payments and orders](#sales-quotes-invoices-payments-and-orders)
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
- **Quotes, Custom Requests and Messages:** statuses, status history and internal notes.
  - **Product quotes** take the configuration and notes only, with no customer uploads; the server refuses files.
  - **Custom furniture requests** still accept inspiration photos.
  - Staff can attach drawings and photos to quotes and orders.
  - Older uploads stay viewable.
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
| `npm run db:seed` | Development seed: required content plus sample catalog in an empty database |
| `npm run db:seed:production` | Production-safe, insert-only seed of required content (runs in Railway pre-deploy) |
| `npm run deploy:prepare` | Railway pre-deploy: migrations, then the production-safe seed |
| `npm run admin:create -- --email … --name "…"` | Create an admin, or reset a password with `--reset` |
| `npm run qa` | Crawl the running site for errors, overflow, broken images and links |
| `npm run brand` | Regenerate the logo files from the brand fonts and the supplied horizontal artwork |

## Admin accounts

There are no customer accounts. Only administrators sign in, at `/admin/login` (or `admin.<domain>/admin/login` with an [admin subdomain](#admin-subdomain-optional)).

Authentication uses [Better Auth](https://better-auth.com), a maintained library, not home-grown session or password code (`src/lib/auth/auth.ts`).

**Two-factor authentication is mandatory.**
- Every admin must enrol an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) before any admin page, action or API works. After the first password sign-in the only reachable page is `/admin/setup-mfa`.
- Enrolment shows a QR code and **10 one-time backup codes, displayed once** (they can be regenerated, which invalidates the old ones).
- Every sign-in then needs a 6-digit code or a backup code. After 5 wrong codes the account is locked for 15 minutes.

**Roles** (`src/lib/auth/permissions.ts`, enforced server-side on every admin page, action and API route):

| Role | Can |
| --- | --- |
| Owner | Everything, including admin users, roles, resets and the audit log |
| Admin | Products, categories, options, promotions, quotes, requests, messages, content, navigation, media, settings — not admin users or owner security |
| Editor | Pages, homepage, portfolio, FAQs, navigation and media, plus their own password and two-factor. No catalog, pricing, quotes, settings or security |

**Creating admins (no public sign-up):**
- **First owner (controlled bootstrap):** set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (and optionally `ADMIN_NAME`) and run `npm run db:seed`, or run `npm run admin:create -- --email owner@example.com --name "Your Name"`, which prompts for a hidden password.
- **Everyone else:** an owner adds them in **Admin → Security → Admin users**. They set up two-factor at first sign-in.

**Roles:**
- **Owner:** full control, including admin users, roles, two-factor resets and the audit log.
- **Admin:** products, quotes, content, media and ordinary site management. Admins can't see or use admin-user or security controls, and can't raise their own role. There must always be at least one active owner, and nobody can change their own role or deactivate themselves.

**Security page (`/admin/security`):**
- Change your password (signs out your other devices).
- Generate new backup codes, or replace your authenticator.
- See where you're signed in and sign out other sessions.
- Owners also:
  - add admins and change roles;
  - deactivate or reactivate admins;
  - reset another admin's password or two-factor;
  - sign someone out everywhere if you suspect a compromise;
  - read the **audit log** (`/admin/security/audit`).

**Passwords:**
- At least 12 characters, with letters and a number or symbol.
- Stored as scrypt hashes. Older bcrypt hashes still work and are upgraded on the next sign-in.

**Sessions:**
- Server-side and revocable.
- End after **4 hours without activity** and always after **7 days** (`ADMIN_SESSION_IDLE_HOURS`, `ADMIN_SESSION_MAX_HOURS`).
- Every sign-in creates a new session.
- Signing out deletes the session on the server.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` with the `__Secure-` prefix in production, and signed with `BETTER_AUTH_SECRET`.

**Sign-in throttling:**
- Limits per IP address and per email address.
- After 3 failures each further attempt is slowed down; after 10 the address is locked for 15 minutes.
- Every failure gets the same message, so responses never reveal whether an account exists.

**Break-glass recovery** (run from a trusted machine with production credentials, e.g. `railway ssh`):
- `npm run admin:create -- --email you@example.com --reset`: new password, signed out everywhere.
- `npm run admin:create -- --email you@example.com --reset-mfa`: lost phone *and* backup codes. Two-factor is cleared, and must be re-enrolled at next sign-in.

**How admin access is enforced:**
- Every admin page, server action and admin API route checks the session, two-factor enrolment, account status and role **on the server** (`src/lib/auth/session.ts`, `adminAction` / `ownerAction`, `guardAdminApi`).
- Role and status are re-read from the database on every request, so a deactivation or demotion takes effect immediately.
- `src/proxy.ts` only redirects signed-out visitors early; it's a convenience, not the security boundary.

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
  sales/                quotes, revisions, invoices, payments, orders, Stripe Checkout + Terminal, status emails, customer views
  navigation/           menu locations and public menu resolver
  auth/permissions.ts   role → permission matrix
  email/                provider abstraction + notification templates
  auth/                 passwords, sessions, tokens
```

**The CMS is structured, not a page builder.** `src/lib/cms/definitions.ts` lists every page, its sections, which fields each section has, and the display ratio for each image location. All the copy, images, calls to action and visibility are stored in the database and edited in admin.

If a section is added to the code later, the site still renders it with empty values until you fill it in.

**Public pages are rendered on each request.** Admin changes show up immediately, and builds never need the database.

### Pages: create, draft, publish, archive, preview

Admin → Pages lists the site's structured pages, customer care/policy pages and **your pages** (created with **Create page**, public at `/{address}`, using a template with a header, Markdown text, an optional feature block and an optional call-to-action band).

- New pages start as **Draft**. **Every page with its own address** can be Published, Draft or Archived: core pages (About, FAQ, Contact, Custom Furniture, Our Work, Furniture, Sale, Request a Quote), every policy page, and every page created in admin. There is no allow-list, so pages added later are covered automatically. Only the homepage (the site root) and the shared product/project content blocks have no status.
- Draft and Archived pages:
  - return "page not found" to visitors;
  - disappear immediately from every menu (page items *and* custom links to their URL), breadcrumbs, the header button, built-in links and the sitemap;
  - keep all their content and menu items.
- Publishing restores everything, menu placement included.
- Admin → Pages has checkboxes for **bulk Publish / Move to draft / Archive**. Important pages (Privacy, Terms, Contact, Request a Quote, Furniture) show a caution before unpublishing, but it never blocks.
- System routes are not CMS pages: `/admin`, sign-in, `/api/*`, customer quote/invoice/order links, webhooks and preview.
- **Preview** uses Next.js Draft Mode (`/api/admin/preview?path=…`). It only switches on after the server checks the staff session and the "content" permission, and every previewed render checks the session again — a copied preview cookie alone shows nothing. Previews are `noindex` and the admin toolbar shows **DRAFT PREVIEW** with Publish, Edit and Exit Preview.
- Pages record created/published dates and who created and last edited them. Duplicate copies a created or policy page into a new draft.

### Navigation

Admin → Navigation edits the site's menus: **Main navigation** (header, with dropdowns), **Footer navigation**, **Company**, **Customer Care** (also the sidebar on customer care pages) and **Legal links**. Items can link to a page, a product category, a product, a path on this site, an external `https://` URL, or be a non-clickable dropdown heading. Items can be nested (main menu), reordered by drag and drop, disabled, and opened in a new tab.

Menus never show a broken link: an item whose page is a draft/archived, whose category is hidden or whose product isn't live is skipped when the menu renders and returns automatically once its target is live again. Starter menus matching the original header and footer are created once on deploy (`src/lib/seed/defaults.ts`).

### Admin toolbar on the live site

Signed-in staff see a slim dark toolbar above the site: an **Edit** link for whatever is on screen (Edit Homepage / Page / Product / Category / Project / FAQs), **Add New** (only what the role may create), shortcuts, the draft-preview indicator, **View Admin** and **Log Out**. It collapses into a menu on phones. It is rendered only after the server validates the session (visitors' HTML never contains it), and its context comes from `/api/admin/context`, which returns 401 to anyone else. With a separate admin subdomain (`ADMIN_URL`) the admin session cookie belongs to the admin host, so the toolbar and previews only work where the admin and site share a host.

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
- **Sales** (`src/lib/pricing/sale.ts`, product editor → Pricing): Sale enabled, sale price, optional start/end dates, optional label ("Fall Sale"). While enabled and inside its dates, the sale price replaces the regular (base) price; options and add-ons are unchanged. The sale is stored **as entered**: a percentage ("30%" → `saleType PERCENT`, `salePercentBps 3000`) or a fixed price ("158" → `FIXED_PRICE`, `salePriceCents`). For a percent sale the entered percentage is the source of truth: the price is derived from the current regular price and rounded to the whole dollar, half up ($225 at 30% = $157.50 → $158), and the site always advertises the entered percentage ("30% OFF", never a recalculated 29%). For a fixed price the percentage is derived from the two prices (rounded down). A sale price at or above the regular price is rejected, even while the sale is off. The active price is decided on the server per request (`resolveConfigurableProduct`), so the storefront, structured data, quotes and future checkout all use it, sales start and expire with no redeploy, and quote snapshots record the regular price and savings. On the site: struck-through regular price, bronze sale price, "SALE · 30% OFF" caption and a small image badge — only where prices are shown.
- **Sale collection** (`/furniture/sale`): every live product whose sale is running right now, queried from the sale fields (`activeSaleWhere`), never a hand-picked list. A "Sale" filter appears in the catalog only while something is on sale; the empty page is `noindex`. Page text: Admin → Pages → Sale collection.

## Promotions and the announcement bar

Admin → Catalog → **Promotions**. Create an announcement, then set its message, secondary text, link, colors (brand presets; contrast is enforced), start/end date-times (site time zone), "show the end date", whether visitors can close it, and desktop/mobile visibility. The enabled announcement inside its dates shows above the main navigation on every public page (the most recently started wins if several overlap) and hides itself when it ends.

Closing it is remembered per promotion in a small cookie (`wm_promo_dismissed`, read by the server so there's no flash). A new announcement — or changing the message, secondary text or link — shows again even to visitors who closed an earlier one. Links may only be site paths or http(s) URLs.
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

## Product videos

**Admin → Products → (product) → Videos** uploads videos into the product gallery. They show after the photos, marked with a ▶ badge, play inline with native controls, and are never autoplayed on the page.

- **Formats:** MP4 (H.264) plays in every browser; WebM and MOV are also accepted. Maximum 200 MB. Short 1080p clips work best. There's no server-side video processing, so files are stored exactly as uploaded.
- **Checks:** extension, declared type and the file's container bytes must agree. MOV and MP4 share a container and are both served as `video/mp4`, which lets Chrome and Firefox play H.264 iPhone clips.
- **Thumbnail and playback check:** the admin's browser loads the video, reads its size and length, and captures a frame as the poster image before uploading. A file the browser can't decode (for example HEVC in Chrome) is rejected with instructions to export as MP4 (H.264).
- **Storage:** files live in object storage under `media/`, next to images. R2 serves ranged requests itself; the local `/media-files` route supports `Range` for seeking. The CSP allows `media-src 'self' blob: https:`.
- **Duplicating and deleting:** a duplicated product shares its source's video files, and a file is deleted only when the last product using it removes it.
- **SEO:** each video is added to the product's structured data as a `VideoObject`.

## Quotes and historical snapshots

When a customer sends a configuration request, the server:
1. Validates it (the same rules run in the browser for convenience).
2. Checks the honeypot, a minimum fill time and a per-IP rate limit.
3. Reloads the product and re-prices it.
4. Stores a `QuoteRequest` with an **immutable configuration snapshot**: the product name and SKU, every option and value name, custom details, the add-ons and every price at that moment (`src/lib/pricing/snapshot.ts`).

Editing or deleting the product later never changes what the customer asked for. Future order items use the same snapshot format.

New records are numbered **`WMWQ-2001…`** (quotes), **`WMWO-2001…`** (orders) and **`WMWI-2001…`** (invoices) — three independent sequences issued by atomic database counters (`src/lib/sales/numbers.ts`, `Counter` rows `WMWQ`/`WMWO`/`WMWI`), never reused even when a record is voided, canceled or superseded. Records created before this format keep their original numbers forever (`WMQ-1001…`, `WMO-1001…`, `WMI-1001…`, and the older `WM-Q-…` quote references); both formats are searchable. Revisions keep their quote's number; **Duplicate** issues a new one. Custom requests use `WM-C-…` references.

## Sales: quotes, invoices, payments and orders

The flow (all in `src/lib/sales/`):

1. **Request.** A configured request (or the general quote form) creates a quote numbered `WMWQ-2001…`. It gets a customer record (matched by exact email only), a secure customer token and a **draft revision 1**. The draft is prefilled from the configuration snapshot: the piece at its regular price, the sale as a separate discount line, and add-ons.
2. **Edit** (Admin → Quotes). Lines are free-form: product, add-on, custom, discount, delivery, installation or fee. You can add, remove, reorder and duplicate them. Prices no longer follow the catalog. The deposit can be none, a percentage or a fixed amount; tax stays off until enabled. The server recomputes totals on every save, and price changes are written to the audit log.
3. **Send.** The revision becomes read-only and the customer is emailed a link to `/quote/<token>`. Changes need **Create revision**; sending revision 2 supersedes revision 1, which can no longer be accepted.
4. **Customer page.** The customer sees the current sent revision only, never drafts, internal notes, costs or ids. The first view marks the quote *Viewed*. Expired quotes stay viewable but can't be accepted (admin can **Extend**).
5. **Accept and pay the deposit — one step.** Accepting requires a typed name and two confirmations. It stores the timestamp, IP, browser and a frozen copy of everything accepted, creates the order `WMWO-2001…` and **the order's one invoice** `WMWI-2001…` for the full accepted total, carrying the deposit required (no admin "send" step). With online payments on, the button reads **Accept Quote & Pay $X Deposit** and shows Quote Total / Deposit Due Today / Remaining Balance; accepting goes straight to Stripe Checkout (see below). Without a deposit it's a plain **Accept Quote** to the order page. Staff can also **Record acceptance** for phone or in-person approvals.
6. **One invoice per order.** Every payment — deposit, final balance, cash, check, bank transfer, in-person card — applies to that same invoice; remaining balance = total − settled payments. There is never a second invoice for the final balance. Invoice status is derived: `DEPOSIT_DUE` → `PARTIALLY_PAID` → (**Mark balance due**) `BALANCE_DUE` → `PAID`, plus `OPEN`, `DRAFT` (custom invoices only) and `VOIDED`. **Mark balance due** (finance) sets `BALANCE_DUE` on the same invoice and emails the customer a Wild Mountain Woodworks email ("Your final balance is ready" → **View Invoice & Pay Balance**) linking to `/invoice/<token>` — no Stripe invoice. Custom invoices (Admin → Invoices) are still available for extra work.
7. **Payments** (the invoice's ledger: date, amount, method, purpose, status, reference, recorded by). `method` is `STRIPE_ONLINE`, `STRIPE_TERMINAL`, `CASH`, `CHECK`, `BANK_TRANSFER` or `OTHER`; `type` (purpose) is `DEPOSIT`, `FINAL_BALANCE`, `PARTIAL_PAYMENT`, `ADDITIONAL_PAYMENT` or `OTHER`. Partial and mixed payments are fine. **Record payment** takes amount, date, reference/check number, bank or payer, who received it and notes. Checks start **Pending** (they don't count until **Mark cleared**; **Mark returned** if one bounces). Overpayment is refused unless an **owner** ticks the override (audited). Payments are never deleted: a mistaken manual entry is voided (amount, date and reason kept), Stripe payments are refunded.
8. **Order** (Admin → Orders). Production status and payment status are separate. Production stages: *Awaiting deposit* → *Order confirmed* → *In production* → *Ready for delivery* → *Delivery scheduled* → *Completed* (or *Canceled*). Shop details (sanding, finishing, materials…) go in internal notes. A paid deposit moves *Awaiting deposit* → *Order confirmed* automatically. Payment status: Unpaid, Deposit due, Partially paid, Balance due, Paid, Refunded, Canceled, Voided. **Delivery scheduled** needs a date and takes an optional time window, a method (White glove delivery / Customer pickup / Other) and notes. A printable work order is available. The customer's page is `/order/<token>`.
9. **Status emails.** Moving an order to Order confirmed, In production, Ready for delivery, Delivery scheduled, Completed or Canceled emails the customer (editable templates; each always carries the secure **View Your Order** button, even if a template's button text is cleared). "Send email notification" is on by default and can be unticked; an unchanged status sends nothing. Every attempt is logged (`StatusNotification`: old/new status, email, sent time, result, who, suppressed, failure) and shown on the order. A failed email never rolls the status back — the admin sees the failure and can **Resend status email**.

**Void, never delete.** Quotes, quote revisions, invoices, payments, orders and their status/audit history are permanent business records. There is no delete in the admin, and the database itself refuses row deletes on those tables (migration `20261010000000_void_not_delete`; line items can only be replaced while their revision or invoice is still a draft).
- **Void quote** (sales permission, confirmation and a reason: Customer canceled, Created in error, Replaced by new quote, Pricing mistake, Duplicate record, or Other with details) marks it `VOIDED` and records who, when and why. Revisions, customer details and sent/viewed/acceptance history are kept. It can't be accepted, sent, revised, invoiced or paid, and the customer's link shows "Quote voided — this quote is no longer valid". A quote with a live order or an active invoice must have those canceled/voided first. Owners and admins can **Reopen** a voided quote only if it never reached acceptance or invoicing; otherwise **Duplicate** it (new number).
- Sending a new revision marks the previous one `SUPERSEDED` (logged as "Quote superseded"): still viewable in admin, never acceptable or invoiced.
- **Void invoice** (finance permission, confirmation and a reason) keeps the invoice, its lines, number, links, payments and Stripe ids; it voids any older Stripe invoice and closes any open checkout, so nothing can be paid on it. An invoice with money received can't be voided until each payment is refunded (or a mistaken manual entry voided) — payment records are never removed. Voided Stripe invoices aren't reopened: create a replacement invoice (new number).
- Quote, invoice and order numbers are never reused. Lists hide voided records from **Active** (the default), with **Voided**, **Expired**, **Superseded** and **All** filters; a search always covers voided records (quote/invoice/order number, customer name or email).

**Customer links** (`/quote`, `/invoice`, `/order`) use 256-bit random tokens. They are `noindex`, `no-store` and `Referrer-Policy: no-referrer`, and are disallowed in `robots.txt`.

**Permissions:** *sales* covers quotes, customers and orders; *finance* covers quote pricing, invoices, payments and refunds. Owners and admins have both; editors have neither. Every action checks on the server.

**Settings → Features:**

| Flag | Launch value | Effect |
| --- | --- | --- |
| Show prices | on | Show "From" prices and live estimates |
| Quote requests | on | Configurator "Request Quote" and `/request-quote` |
| Custom orders | on | Custom build form |
| Tax on quotes and invoices | **off** | Adds a tax field to quotes when on (no automatic tax rules) |
| Online payments (Stripe) | **off** | Deposit and balance payments by Stripe Checkout on the Wild Mountain Woodworks invoice/order pages. Effective only when the switch is on **and** `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` are set. Recording cash/check payments works either way |

**Settings → Quotes & invoices** holds these defaults:
- how long quotes are valid, invoice due days, and when to flag unanswered requests;
- the default deposit;
- default terms;
- offline payment instructions.

### Turning on online payments (Stripe)

1. In Stripe, create a restricted key with **Write** access to **Checkout → Checkout Sessions**, **Core → PaymentIntents** and **Terminal** (Readers; plus Billing → Invoices only if you still have older Stripe-invoiced invoices to void). Add a webhook endpoint `https://<your-domain>/api/stripe/webhook` for these events:
   - `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - `invoice.finalized`, `invoice.sent`, `invoice.updated`
   - `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`
   - `invoice.voided`, `invoice.marked_uncollectible`
   - `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled` (in-person Terminal payments)
   - `charge.refunded`
   - the `invoice.*` events are only needed while older Stripe-invoiced invoices are outstanding
2. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `NEXT_PUBLIC_SITE_URL` (Stripe's return links) on Railway and redeploy.
3. Turn on **Settings → Features → Online payments (Stripe)**.

**Online payments (Stripe Checkout).** The customer pays from Wild Mountain Woodworks pages: **Pay $X Deposit** on `/order/<token>`, or **Pay Remaining Balance** on `/invoice/<token>` once the balance is due (`/order/<token>/pay`, `/invoice/<token>/pay`). Each payment gets its own one-time Checkout Session (`mode=payment`) for the amount the server computes from the invoice (deposit still owed, or remaining balance minus anything pending) — never from the browser. Sessions carry `client_reference_id` (the invoice), the customer's email and metadata `invoice_id`, `invoice_number`, `order_id`, `order_number`, `quote_id`, `quote_number`, `customer_id`, `payment_type` (`DEPOSIT` / `FINAL_BALANCE` / `ADDITIONAL_PAYMENT`) and `expected_amount`. Cards are never saved (no `setup_future_usage`, no Stripe customer, no off-session use). Only the verified `checkout.session.*` webhook records the payment on the invoice (idempotent per event, session and PaymentIntent), recomputes invoice and order status, emails a receipt, and — for the deposit — confirms the order. Stripe returns the customer to `…/payment-success`, which only displays the state. An open session is reused while its amount still matches; an expired one is replaced automatically.

**In-person card payments (Stripe Terminal).** On an invoice, **Take in-person card payment** (finance) defaults to the remaining balance (a smaller partial amount is allowed, more than owed is not). The server creates a `card_present` PaymentIntent (idempotency key per attempt, same metadata as Checkout, never saved for later) and sends it to the selected smart reader; the payment shows as *Pending* until Stripe confirms it via `payment_intent.succeeded` (or **Check status**). Declines and cancellations are kept as *Failed* attempts and never count. Nobody can mark a Terminal payment paid by hand. Setup:
1. Buy a Stripe smart reader (**Stripe Reader S700** or **BBPOS WisePOS E**) — server-driven, so no app or Bluetooth pairing is needed; it just needs Wi-Fi/Ethernet.
2. Stripe Dashboard → **Terminal → Locations**: add the shop's address; then **Readers → Register reader** with the code shown on the device.
3. Admin → **Settings → Payments → Stripe Terminal**: pick the reader (name, location and online/offline status come from Stripe; the secret key never reaches the browser).
4. Testing: with an `sk_test_` key, register a **simulated reader** in the Dashboard; the invoice page then offers **Simulate card tap**.

**Payment messaging (Settings → Payments).** Customers learn about flexible payment options before Stripe's page: a quiet "Flexible payment options available — pay over time with Affirm or Klarna when eligible" block under the request button on product pages, the notice "Flexible payment options available at checkout, including Affirm and Klarna when eligible" before **Accept Quote & Pay Deposit** and **Pay Deposit**, and a secondary "Secure payment options may include: …" line. The switches (financing, Affirm, Klarna, general methods) and wording change messaging only — they never enable a payment method; Checkout Sessions don't list `payment_method_types`, so Stripe shows whatever is enabled in the Stripe Dashboard and eligible for the customer. Nothing shows while online payments are off. Our wording never states terms (the admin form refuses monthly amounts, payment counts, rates or approval promises). With `STRIPE_PUBLISHABLE_KEY` set, quote and order pages also embed Stripe's Payment Method Messaging Element for the exact deposit, so plan wording comes from Stripe; product pages never show amount-based plans, because only the deposit is paid at checkout.

**Older records.** Orders created before the unified model keep their separate deposit/balance invoices exactly as they were (nothing merged, no amounts changed); **Create remaining-balance invoice** on such an order makes one invoice for whatever is still owed, which then follows the same Mark balance due / Pay flow. Older invoices already sent through Stripe Invoicing still reconcile through the `invoice.*` webhooks and their pay button goes to Stripe's hosted page. Migration `20261012000000_unified_invoice_schema` maps old production stages (Deposit paid / Design confirmation → Order confirmed; Materials ordered / Materials ready / Sanding / Finishing / Curing → In production; Quote accepted → Awaiting deposit or Order confirmed depending on the deposit) and records a `mig_…` status event for each remapped order while keeping the original history.

## Email notifications

`src/lib/email/` keeps the provider (`provider.ts`: Resend, Postmark or log-only) separate from the content.

- **Templates.** Quote, invoice, payment and order emails are **editable templates** (Admin → Emails): subject, heading, message with `{{placeholders}}`, button text, and an on/off switch. The branded layout and logo are added automatically, and every value is HTML-escaped. Starting text lives in `src/lib/email/template-definitions.ts` and is inserted once by the deploy seed; your edits are never overwritten.
- **Logging and resend.** Every email is saved to `EmailLog` *before* sending. A provider outage never loses a quote or invoice: failures show on the record and on Admin → Emails with a **Resend** button.
- **Other forms.** Custom-request and contact-message emails use `notifications.ts`.

Notifications go to Settings → Notification email, else Settings → Email, else `ADMIN_NOTIFICATION_EMAIL`.

## Environment variables

See `.env.example` for a commented template.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | PostgreSQL connection string. On Railway: `${{Postgres.DATABASE_URL}}` (the private-network URL) |
| `BETTER_AUTH_SECRET` | **yes (prod)** | 32+ random characters (`openssl rand -base64 48`). Signs session cookies and encrypts two-factor secrets. Without it, admin sign-in is disabled in production (the public site still works). Changing it signs everyone out and invalidates enrolled authenticators |
| `ADMIN_URL` | no | e.g. `https://admin.wildmountainwoodworks.com` to serve the admin on its own subdomain ([details](#admin-subdomain-optional)) |
| `ADMIN_SESSION_IDLE_HOURS`, `ADMIN_SESSION_MAX_HOURS` | no | Admin session idle timeout (default 4) and absolute lifetime (default 168 = 7 days) |
| `TRUST_CLOUDFLARE` | no | `true` only when the site is behind Cloudflare **and** the origin only accepts Cloudflare traffic; then `CF-Connecting-IP` is used as the client IP |
| `SITE_TIME_ZONE` | no | IANA time zone for sale start/end dates, e.g. `America/Denver` (default `America/New_York`). A sale "Oct 1 – Oct 14" runs from local midnight Oct 1 to local midnight after Oct 14 |
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
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | no | Only for online payments (Checkout deposits + Stripe invoices). The site, quotes and offline invoices run fully without them |
| `STRIPE_PUBLISHABLE_KEY` | no | Optional. Enables Stripe's Affirm/Klarna eligibility messaging (Payment Method Messaging Element) on quote and order pages |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error` |
| `DATABASE_POOL_SIZE` | no | Default 10 |
| `TEST_DATABASE_URL` | tests | A separate database for integration tests. Never your real data |

Secrets are only read on the server. Only variables prefixed `NEXT_PUBLIC_` are sent to browsers, and none of them are secrets.

## Deploying to Railway

> **Action needed before December 1, 2026:** this service uses `railway.json` (Railway *Config as Code*), which Railway has deprecated in favour of *Infrastructure as Code*, with a hard cutoff for existing services on December 1, 2026. It still works today and hasn't been migrated yet. See **[docs/railway-deployment.md](docs/railway-deployment.md)** for the exact settings any replacement must keep (above all the pre-deploy command `npm run deploy:prepare`), the migration checklist and how to verify a deploy.

`railway.json` configures three steps:

| Step | Command | What it does |
| --- | --- | --- |
| Build | `npm run build` | `prisma generate` + `next build`. No database access needed. |
| Pre-deploy | `npm run deploy:prepare` | `scripts/predeploy.sh`: `prisma migrate deploy`, then the **production-safe seed** (`npm run db:seed:production`). Runs once per deploy, before the new version takes traffic. Any failure stops the deploy and the previous version keeps serving. |
| Start | `npm run start:production` | Safety net: repeats `prisma migrate deploy` and the production-safe seed (both no-ops when pre-deploy ran), then starts Next.js. If either fails, Next.js never starts, the health check never passes and Railway keeps the previous deploy. |

**Production-safe seed** (`scripts/seed-production.ts`, logic in `src/lib/seed/defaults.ts`). It is insert-only and idempotent:
- creates the settings row, and every CMS page/section defined in code, only when missing — so when a feature adds a page (like the Sale collection) its default copy appears on the next deploy, with nothing to run by hand;
- adds one-time starter content (e.g. the switched-off starter announcement) once, recorded in `SeedMarker`, so it is never re-created after you delete it;
- creates the first owner from `ADMIN_EMAIL`/`ADMIN_PASSWORD` only while **no** admin exists; existing admins are never created, changed, reset or re-activated (remove those variables after the first sign-in);
- never updates or deletes anything, and never touches products, media, storage or sample content;
- runs in a single transaction under an advisory lock: on any error nothing is saved and the command exits non-zero.

The **development seed** (`npm run db:seed`) adds sample products and imagery to an empty catalog. It's for local machines and demos, and is not run on deploy.

The health check at `/api/health` returns 503 with `not_configured`, `unreachable` or `migrations_pending` (listing each migration this build ships that the database hasn't applied) if the database isn't ready, so Railway never switches traffic to a deploy running against an out-of-date schema.

1. **Create a project** in Railway, **add PostgreSQL**, then **Deploy from GitHub** with this repository.
2. **Set service variables** on the web service:
   - `DATABASE_URL = ${{Postgres.DATABASE_URL}}`. This is the **private-network** URL (`*.railway.internal`), so app↔database traffic never crosses the public internet.
   - `BETTER_AUTH_SECRET = <openssl rand -base64 48>`
   - `NEXT_PUBLIC_SITE_URL = https://your-domain` (or your Railway domain at first)
   - `STORAGE_DRIVER = r2` plus the `R2_*` variables ([see below](#cloudflare-r2-setup))
   - Optionally the email variables.
   - For the very first deploy, also `ADMIN_EMAIL` and `ADMIN_PASSWORD` (a long passphrase) to create the first owner. Delete them once you've signed in.
3. **Deploy.** The pre-deploy step applies migrations and inserts the required settings, pages and first owner. The site starts with an empty catalog.
4. **Optional — sample catalog for a demo.** To fill an empty catalog with sample products and imagery, run the development seed once from your computer using the database's *public* URL (Railway → Postgres → Connect):
   ```bash
   DATABASE_URL="<public postgres url>" STORAGE_DRIVER=r2 R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… \
   R2_SECRET_ACCESS_KEY=… R2_BUCKET=… R2_PUBLIC_URL=… \
   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run db:seed
   ```
   Or open a shell in the running service with `railway ssh` and run `npm run db:seed` there; it then uses the service's own variables and private network. (`railway run` executes on your computer, where the private `*.railway.internal` database host isn't reachable.) Add `SEED_SAMPLE_CONTENT=false` if you want to start with an empty catalog.
5. **Custom domain:** add it in Railway → Settings → Networking, then update `NEXT_PUBLIC_SITE_URL`. Railway issues the TLS certificate automatically and redirects HTTP to HTTPS.
6. **Keep the database private:** after seeding, remove the Postgres service's public TCP proxy (Railway → Postgres → Settings → Networking) so the database is reachable only over Railway's private network. Re-enable it temporarily if you ever need a direct connection, or use `railway ssh` instead.
7. Sign in at `/admin`, set up two-factor authentication, work through the dashboard's **Launch checklist**, and replace the sample content.

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

**Database**
- Turn on Railway's PostgreSQL backups for your plan.
- Also keep your own off-site copies, e.g. weekly and before big changes:
  ```bash
  pg_dump "$DATABASE_PUBLIC_URL" -Fc -f wildmountain-$(date +%F).dump
  ```
  The dump holds all products, content, quotes, requests, messages, estimates, admin accounts and the audit log. Store it encrypted, because it contains customer details.

**Restoring the database**
1. Create a fresh PostgreSQL service in Railway (or pick an existing empty database) and temporarily enable its public TCP proxy.
2. Restore into it:
   ```bash
   pg_restore --clean --if-exists --no-owner -d "$TARGET_DATABASE_URL" wildmountain-YYYY-MM-DD.dump
   ```
3. Check it: `DATABASE_URL="$TARGET_DATABASE_URL" npx prisma migrate status` should report the schema is up to date.
4. Point the web service's `DATABASE_URL` at the restored database (`${{NewPostgres.DATABASE_URL}}`) and redeploy.
5. Sign in and spot-check products, recent quotes and the audit log. Then remove the temporary public TCP proxy.
6. Keep `BETTER_AUTH_SECRET` unchanged. Two-factor secrets are encrypted with it, so a restored database only works with the same secret.

**Images and videos (R2)**
- Turn on bucket **object versioning** or lifecycle rules, or periodically copy the bucket with `rclone sync` to a second bucket or your computer.
- Replacing or deleting an image in admin removes the old object, so versioning is what makes deletions recoverable.

**Also back up (outside the repository):** your Railway variables, especially `BETTER_AUTH_SECRET`, in a password manager.

**Local development only:** the `./storage` folder holds uploaded files and is git-ignored.

**Test a restore** once before launch, and again after major changes.

## Security

Security is a first-class requirement. The design assumes attackers know `/admin` exists: protection comes from authentication, authorization, rate limiting, session security, infrastructure isolation and audit controls, not obscurity.

**Admin authentication and authorization.** See [Admin accounts](#admin-accounts):
- a maintained library (Better Auth);
- mandatory TOTP two-factor with one-time backup codes;
- no public sign-up;
- Owner/Admin roles, enforced server-side on every page, action and API, and deny-by-default;
- revocable sessions with idle and absolute timeouts;
- throttling and lockout with generic errors.

**Audit log** (`/admin/security/audit`, owners only). Records:
- successful and failed sign-ins, lockouts and sign-outs;
- two-factor enrolment, resets, backup-code use and regeneration;
- password changes and resets;
- admin creation, role changes and deactivation;
- session revocations;
- product changes (including base price and sale price before and after), publishing and archiving;
- quote status changes;
- settings, page and homepage edits;
- media uploads, replacements and deletions.

Each entry has the admin, the time, the target record, the client IP and the user agent. Passwords, codes, tokens and card data are never logged.

**CSRF.**
- Server actions are protected by Next.js origin checks.
- Admin API routes reject cross-origin requests themselves.
- Better Auth checks origins against `trustedOrigins`.
- Cookies are `SameSite=Lax`.

**Input.**
- Every input is validated on the server with Zod; lightweight versions of the same rules run in the browser.
- The browser is never trusted for prices, product IDs, roles, quote statuses, filenames or MIME types.
- Prices are always recalculated on the server.
- Prisma parameterizes every query.
- Markdown is rendered without raw HTML, and there's no `dangerouslySetInnerHTML` on user content.
- Link fields reject `javascript:` URLs.

**Uploads.**
- Allowed MIME types and extensions, checked against the file's actual contents (magic bytes / decoding).
- Size and pixel limits.
- Random generated storage names.
- Stored in object storage, never in an executable path.
- Images are re-encoded to **strip metadata** such as GPS location. (Videos can't be re-encoded without a server-side tool, so strip location on the phone before uploading, or export without it.)
- Customers can upload images only.
- Customer reference photos are private and served only to signed-in admins.

**HTTP headers.**
- Content-Security-Policy (including `frame-ancestors 'none'`), HSTS with preload (in production), `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy and `Cross-Origin-Opener-Policy`.
- Admin pages and APIs send `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.

**Client IP.** Rate limits and audit entries use `X-Real-IP` set by Railway, or `CF-Connecting-IP` with `TRUST_CLOUDFLARE=true`. Never the client-controlled first `X-Forwarded-For` entry.

**Errors.**
- Users see generic messages; details go only to the server logs.
- Production builds never show stack traces, SQL, internal paths or environment values.

**Secrets.**
- Only in Railway variables. Never committed (`.env*` is git-ignored), never logged, never shown in the admin.
- CI fails if any secret value or server-only pattern appears in the browser bundles (`npm run check:bundle`).

**Dependencies.**
- CI (`.github/workflows/ci.yml`) runs `npm audit --audit-level=high`, lint, type checks, the full test suite (including the auth and authorization security tests), a production build and the bundle-secret scan on every push and pull request.
- Dependabot opens weekly update PRs.
- Two vulnerable transitive packages in Prisma's tooling are pinned to patched versions via `overrides` in `package.json`.

**Payments.** Stripe is hosted Checkout only; no card data is ever handled or stored.

### Cloudflare in front of Railway (recommended)

1. Add the domain to Cloudflare. Point DNS (**proxied**, orange cloud) at the Railway custom domain target.
2. **SSL/TLS: Full (strict)**, **Always Use HTTPS** on, minimum TLS 1.2.
3. **Security → Bots:** Bot Fight Mode (or Super Bot Fight Mode) on.
4. **WAF managed rules** on. Add custom rules:
   - `/admin*`: block requests from countries you never work from, or require a Managed Challenge. If you have a fixed IP, allow only that. For stronger protection, put the admin behind **Cloudflare Access** (Zero Trust, free for small teams) so only your email or device can even reach the login page.
   - Block `/api/admin*` requests that aren't from a browser session (e.g. missing `Sec-Fetch-Site`).
5. **Rate limiting rules** (on top of the app's own limits):
   - `/admin/login*`: about 10 requests/minute per IP.
   - Quote, custom-request and contact form posts (`/request-quote`, `/custom-furniture`, `/contact`, product pages; POST): about 10/minute per IP.
   - `/api/admin/*` uploads: about 30/minute per IP.
6. **Caching:** bypass the cache for `/admin*` and `/api/*`. The app already sends `no-store` there.
7. DDoS protection is automatic once traffic is proxied.
8. Then set `TRUST_CLOUDFLARE=true`, and make sure the origin is only reachable through Cloudflare (remove any public Railway domain you don't use), so `CF-Connecting-IP` can't be spoofed.

### Admin subdomain (optional)

Set `ADMIN_URL=https://admin.yourdomain.com` and add that domain to the Railway service. Then:
- `/admin` paths on the public domain redirect to the admin host;
- public pages on the admin host redirect to `/admin`;
- the session cookie is **host-only** on the admin host, so it's never sent to the public site.

This is not a security boundary by itself (authentication and authorization still apply everywhere), but it keeps admin traffic separate and makes admin-only Cloudflare rules (Access, stricter WAF) easy.

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
  - Password hashing and strength rules, and trusted client-IP parsing (the client-controlled `X-Forwarded-For` entry is ignored).
  - Stripe webhook signature verification.
- **Integration tests** (`tests/integration`) run against `TEST_DATABASE_URL`; migrations are applied automatically, and the tests are skipped if the variable isn't set. They cover:
  - Creating quotes with server-side re-pricing and stored snapshots.
  - Rejecting draft and archived products, and invalid or disabled selections.
  - The feature flags.
  - Private attachment storage and rejection of disguised files.
  - Public visibility and archive rules, and slug collisions.
  - Media usage, safe and forced delete, and replace.
  - **Admin security** (`tests/integration/auth.test.ts`), using real Better Auth calls and real TOTP codes:
    - two-factor enrolment is forced before any admin access;
    - sign-in requires a code; wrong codes lock the account; backup codes work once;
    - the same generic error for wrong passwords and unknown emails, failures logged, lockout after repeated failures;
    - no public sign-up; deactivated accounts refused;
    - forged, idle, over-age and revoked sessions rejected; sign-out deletes the server session;
    - password change signs out other devices;
    - admins can't manage admins or elevate themselves; last-owner and self protections hold;
    - admin APIs reject unauthenticated and cross-origin requests;
    - legacy bcrypt passwords are upgraded.
  - Upload metadata (GPS) stripping, and product video validation.
- **Site QA crawler:** `QA_BASE_URL=http://localhost:3000 npm run qa` checks every public page at 1440, 1024, 768 and 390px wide for:
  - HTTP errors and console errors.
  - Horizontal overflow.
  - Broken images and broken internal links.
  - Tap targets smaller than 24px.
  - Missing `h1`s, alt attributes and form labels.

  Add `QA_ADMIN_COOKIE="$(npx tsx scripts/dev-session.ts)"` to check admin pages too. It signs in as a dedicated development-only `qa@localhost` owner. The crawler fails if an admin page lands on the sign-in screen, so a bad cookie can't pass silently.
- **Security checks:** `npm run audit:deps` (dependency vulnerabilities) and `npm run build && npm run check:bundle` (no secrets in browser bundles). Both run in CI.

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

The horizontal and stacked logos come from the supplied artwork in `public/brand/WMW-horizonal.svg` and `public/brand/WMW-stacked.svg`. The compact logo is the stacked lettering without the mountain. To update a logo, replace its file and run `npm run brand`. The script flattens the artwork into plain path data. The brown mountain, divider and rules (`#7f582d`) are drawn in the accent colour, set through the `--logo-accent` CSS variable (a lighter bronze on dark backgrounds). The lettering follows the text colour.

| Asset | Files |
| --- | --- |
| Primary horizontal logo | `public/brand/wild-mountain-horizontal-{dark,light}.{svg,png}` |
| Stacked logo (with mountain) | `public/brand/wild-mountain-stacked-{dark,light}.{svg,png}` |
| Compact stacked | `public/brand/wild-mountain-compact-{dark,light}.{svg,png}` |
| WM monogram / maker's mark | `public/brand/wild-mountain-monogram-{dark,light}.{svg,png}` |
| Favicon / app icons (the mountain from the stacked artwork) | `src/app/icon.svg`, `src/app/apple-icon.png`, `public/brand/wild-mountain-sitemark-*` |
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
- [ ] **Railway configuration:** migrate from `railway.json` to Railway Infrastructure as Code by November 15, 2026 ([docs/railway-deployment.md](docs/railway-deployment.md)). The pre-deploy command must remain `npm run deploy:prepare`.
- [ ] **Launch settings:** set `NEXT_PUBLIC_SITE_URL` to the final domain and test a database backup restore.
