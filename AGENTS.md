<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Wild Mountain Woodworks — project conventions

- **Content lives in the database, not code.** Never hardcode public copy or photographs. Page structure is defined in `src/lib/cms/definitions.ts`; content is edited in admin. Every public image is a `Media` foreign key rendered with `CmsImage` (slot ratio + focal point).
- **Money is integer cents.** Prices are always recomputed server-side via `src/lib/pricing` (`loadConfigurableProduct` → `priceConfiguration`). Never accept a price from the client.
- **Quotes/orders store immutable `ConfigurationSnapshot`s** (`src/lib/pricing/snapshot.ts`). Don't read live product data to describe a historical request.
- **Archive, don't delete** records that history depends on (products with quotes/orders, add-ons, option groups attached to products).
- **Admin security is non-negotiable.** Auth is Better Auth (`src/lib/auth/auth.ts`) — never add home-grown session/password code. Every admin page calls `requireAdmin()`/`requireOwner()`, every admin action uses `adminAction`/`ownerAction`, every admin API route uses `guardAdminApi` (server-side, deny by default; UI hiding is never the control). Two-factor is mandatory. Log security-relevant changes with `logActivity` (never secrets). Keep `tests/integration/auth.test.ts` passing and extend it for new privileged operations.
- **Admin mutations** use `adminAction` (`src/lib/admin/action.ts`), then `logActivity(...)` and `revalidateSite()`. Admin forms use `ActionForm`; public forms use `usePublicForm` (never a bare `<form action>` — React resets it on error).
- **Public forms** validate with lightweight client rules (`src/lib/validation/shared.ts`) and authoritative Zod schemas on the server (`src/lib/validation/forms.ts`); `tests/unit/client-validation.test.ts` keeps them in sync. Keep Zod out of client bundles.
- **Sales** are resolved server-side at request time (`activeSale` in `src/lib/pricing/sale.ts`, applied in `resolveConfigurableProduct`). Never store a discount % or trust a browser price; list sale products with `activeSaleWhere()`, not hardcoded IDs.
- **Required default content** (new CMS pages/sections, settings, one-time starter records) goes in `src/lib/seed/defaults.ts`, which must stay insert-only and idempotent: it runs on every Railway deploy (`npm run deploy:prepare`). Sample/demo content belongs only in `prisma/seed.ts`.
- **Commerce** stays dormant until `CHECKOUT_UI_READY`, the Settings flag and Stripe keys are all set (`commerceState()` in `src/lib/settings.ts`).
- Class names go through `cn()` (tailwind-merge), so caller classes override component defaults.
- Before finishing work: `npm run check`, `npm run build`, and `npm run qa` against a running server.
