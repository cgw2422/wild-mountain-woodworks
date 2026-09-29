import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { centsToDollarInput, formatCents } from "@/lib/money";
import { loadConfigurableProduct } from "@/lib/pricing/load";
import { defaultSelection, priceConfiguration, startingPrice } from "@/lib/pricing/engine";
import { ActionButton, ActionForm, ConfirmAction, MoneyInput, Select, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { AdminLinkButton, Badge, Card, PageHeader, StatusBadge, formatDate } from "@/components/admin/ui";
import { CountedInput, CountedTextArea } from "@/components/admin/catalog/CountedField";
import { NameSlugFields } from "@/components/admin/catalog/NameSlugFields";
import { RunActionButton } from "@/components/admin/catalog/RunActionButton";
import { SectionNav } from "@/components/admin/catalog/SectionNav";
import { fromRequiredOverride } from "../_lib/payloads";
import {
  archiveProduct,
  deleteProduct,
  duplicateProduct,
  restoreProduct,
  saveProduct,
  saveProductImages,
  unpublishProduct,
} from "../actions";
import { AddOnsManager } from "./AddOnsManager";
import { ImagesManager } from "./ImagesManager";
import { OptionsManager } from "./OptionsManager";

export const metadata: Metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { id: "basic", label: "Basic information" },
  { id: "pricing", label: "Pricing" },
  { id: "images", label: "Images" },
  { id: "options", label: "Options" },
  { id: "add-ons", label: "Add-ons" },
  { id: "specifications", label: "Specifications" },
  { id: "production", label: "Production" },
  { id: "delivery", label: "Delivery" },
  { id: "care", label: "Care instructions" },
  { id: "seo", label: "SEO" },
];

const MD = "Markdown supported: **bold**, *italic*, lists with “- ”, blank line between paragraphs.";

export default async function ProductEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, archivedAt: true } },
      images: { orderBy: [{ sortOrder: "asc" }], include: { media: true } },
      optionGroups: { orderBy: { displayOrder: "asc" }, include: { valueOverrides: true } },
      addOns: { orderBy: { displayOrder: "asc" } },
      _count: { select: { quotes: true, orderItems: true } },
    },
  });
  if (!product) notFound();

  const [categories, optionLibrary, addOnLibrary, settings, config] = await Promise.all([
    prisma.category.findMany({
      where: { OR: [{ archivedAt: null }, { id: product.categoryId ?? "" }] },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, archivedAt: true, linkUrl: true },
    }),
    prisma.optionGroup.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      include: { values: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] } },
    }),
    prisma.addOn.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
    getSettings(),
    loadConfigurableProduct({ id }, { activeOnly: false }),
  ]);

  const status = product.status;
  const livePath = `/furniture/${product.slug}`;
  const blockers = [
    !product.name.trim() ? "Add a name" : null,
    !product.categoryId ? "Choose a category" : null,
    product.images.length === 0 ? "Add at least one image" : null,
  ].filter((b): b is string => Boolean(b));
  const references = product._count.quotes + product._count.orderItems;

  // Pricing preview from SAVED settings, using the same engine as the storefront.
  const start = config ? startingPrice(config) : null;
  const defaults = config ? priceConfiguration(config, defaultSelection(config)) : null;

  return (
    <>
      <PageHeader
        title={product.name}
        breadcrumbs={[{ label: "Products", href: "/admin/products" }, { label: product.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            {product.featured ? <Badge tone="blue">★ Featured</Badge> : null}
            {product.isSample ? <Badge tone="violet">Sample content</Badge> : null}
            <span>Updated {formatDate(product.updatedAt, true)}</span>
          </span>
        }
        actions={
          <>
            <AdminLinkButton href={`/admin/preview/product/${product.id}`} target="_blank">
              Preview ↗
            </AdminLinkButton>
            {status === "ACTIVE" ? (
              <AdminLinkButton href={livePath} target="_blank">
                View live ↗
              </AdminLinkButton>
            ) : null}
          </>
        }
      />

      <ActionForm key={product.id} action={saveProduct.bind(null, product.id)} successMessage="Saved.">
        <div className="mb-6 lg:hidden">
          <SectionNav sections={SECTIONS} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="grid min-w-0 content-start gap-6">
            <Card id="basic" title="Basic information" className="scroll-mt-6">
              <div className="grid gap-4">
                <NameSlugFields mode="edit" defaultName={product.name} defaultSlug={product.slug} nameLabel="Product name" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Category"
                    name="categoryId"
                    defaultValue={product.categoryId ?? ""}
                    placeholder="No category"
                    options={categories.map((c) => ({
                      value: c.id,
                      label: `${c.name}${c.archivedAt ? " (archived)" : ""}${c.linkUrl ? " (link-only tile)" : ""}`,
                    }))}
                    help="Required to publish."
                  />
                  <TextInput label="SKU" name="sku" defaultValue={product.sku ?? ""} maxLength={64} className="font-mono" help="Optional. Must be unique." />
                </div>
                <TextArea
                  label="Short description"
                  name="shortDescription"
                  defaultValue={product.shortDescription}
                  rows={2}
                  maxLength={500}
                  help="One or two sentences for product cards and the top of the product page."
                />
                <TextArea label="Full description" name="description" defaultValue={product.description} rows={8} maxLength={20000} help={MD} />
              </div>
            </Card>

            <Card id="pricing" title="Pricing" className="scroll-mt-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyInput
                  label="Base price"
                  name="basePrice"
                  defaultValue={centsToDollarInput(product.basePriceCents)}
                  placeholder="e.g. 1295"
                  help="Before options and add-ons. Leave blank for “Price on request”."
                />
                <div className="sm:pt-7">
                  <Toggle label="Show price" name="showPrice" defaultChecked={product.showPrice} description="When off, customers see “Request a quote” instead of prices for this product." />
                </div>
              </div>
              <div className="mt-5 rounded-md border border-dashed border-neutral-300 p-4">
                <p className="text-sm font-medium text-neutral-800">Internal cost estimates</p>
                <p className="mb-3 text-xs text-neutral-500">Never shown to customers. Used as the starting point in the pricing calculator.</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <MoneyInput label="Base material cost" name="estMaterialCost" defaultValue={centsToDollarInput(product.estMaterialCostCents)} placeholder="e.g. 420" />
                  <TextInput label="Typical labor hours" name="estLaborHours" inputMode="decimal" defaultValue={product.estLaborHours != null ? String(product.estLaborHours) : ""} placeholder="e.g. 24" />
                  <div className="sm:pt-7">
                    <Link href={`/admin/pricing-calculator?product=${product.id}`} className="text-sm underline" target="_blank">
                      Price in calculator ↗
                    </Link>
                  </div>
                </div>
              </div>
              <p className={`mt-4 rounded px-3 py-2 text-sm ${settings.showPrices ? "bg-neutral-50 text-neutral-600" : "bg-amber-50 text-amber-800"}`}>
                {settings.showPrices
                  ? "Prices are enabled site-wide in Settings, so this product's “Show price” setting applies."
                  : "Prices are currently hidden site-wide in Settings — no prices are shown on the site, regardless of this toggle."}{" "}
                <Link href="/admin/settings" className="underline">
                  Settings
                </Link>
              </p>
            </Card>

            <Card id="images" title={`Images (${product.images.length})`} description="Saved automatically. The primary image is used on product cards and as the first gallery image." className="scroll-mt-6">
              <ImagesManager
                save={saveProductImages.bind(null, product.id)}
                initial={product.images.map((img) => ({
                  id: img.mediaId,
                  alt: img.alt ?? "",
                  isPrimary: img.isPrimary,
                  media: {
                    url: img.media.url,
                    alt: img.media.alt,
                    width: img.media.width,
                    height: img.media.height,
                    focalX: img.media.focalX,
                    focalY: img.media.focalY,
                    originalName: img.media.originalName,
                  },
                }))}
              />
            </Card>

            <Card id="options" title="Options" description="Attach option groups from the global library and fine-tune them for this product. Saved with the Save button." className="scroll-mt-6">
              <OptionsManager
                library={optionLibrary.map((g) => ({
                  id: g.id,
                  name: g.name,
                  displayName: g.displayName,
                  inputType: g.inputType,
                  required: g.required,
                  active: g.active,
                  values: g.values.map((v) => ({
                    id: v.id,
                    name: v.name,
                    displayName: v.displayName,
                    priceModifierCents: v.priceModifierCents,
                    displayOrder: v.displayOrder,
                    active: v.active,
                    isCustom: v.isCustom,
                  })),
                }))}
                initial={product.optionGroups.map((pog) => ({
                  optionGroupId: pog.optionGroupId,
                  requiredOverride: fromRequiredOverride(pog.requiredOverride),
                  displayNameOverride: pog.displayNameOverride ?? "",
                  values: pog.valueOverrides.map((o) => ({
                    optionValueId: o.optionValueId,
                    enabled: o.enabled,
                    priceOverride: centsToDollarInput(o.priceModifierOverrideCents),
                    displayOrderOverride: o.displayOrderOverride == null ? "" : String(o.displayOrderOverride),
                    isDefault: o.isDefault,
                  })),
                }))}
              />
            </Card>

            <Card id="add-ons" title="Add-ons" description="Extras customers can add to this piece. Saved with the Save button." className="scroll-mt-6">
              <AddOnsManager
                library={addOnLibrary.map((a) => ({
                  id: a.id,
                  name: a.name,
                  priceCents: a.priceCents,
                  required: a.required,
                  minQuantity: a.minQuantity,
                  maxQuantity: a.maxQuantity,
                  active: a.active,
                  archived: Boolean(a.archivedAt),
                  scope: a.scope,
                }))}
                initial={product.addOns.map((pa) => ({
                  addOnId: pa.addOnId,
                  enabled: pa.enabled,
                  priceOverride: centsToDollarInput(pa.priceOverrideCents),
                  requiredOverride: fromRequiredOverride(pa.requiredOverride),
                  minQuantityOverride: pa.minQuantityOverride == null ? "" : String(pa.minQuantityOverride),
                  maxQuantityOverride: pa.maxQuantityOverride == null ? "" : String(pa.maxQuantityOverride),
                }))}
              />
            </Card>

            <Card id="specifications" title="Specifications" className="scroll-mt-6">
              <div className="grid gap-4">
                <TextArea label="Dimensions" name="dimensions" defaultValue={product.dimensions ?? ""} rows={4} maxLength={5000} help={MD} />
                <TextArea label="Materials" name="materials" defaultValue={product.materials ?? ""} rows={4} maxLength={5000} help={MD} />
                <TextArea label="Construction" name="construction" defaultValue={product.construction ?? ""} rows={4} maxLength={5000} help={MD} />
              </div>
            </Card>

            <Card id="production" title="Production" className="scroll-mt-6">
              <TextInput
                label="Lead time"
                name="leadTime"
                defaultValue={product.leadTime ?? ""}
                maxLength={200}
                placeholder={settings.defaultLeadTime ?? "e.g. 8–10 weeks"}
                help={settings.defaultLeadTime ? `Blank uses the default from Settings: “${settings.defaultLeadTime}”.` : "Blank uses the default lead time from Settings (if set)."}
              />
            </Card>

            <Card id="delivery" title="Delivery" className="scroll-mt-6">
              <TextArea label="Delivery information" name="deliveryInfo" defaultValue={product.deliveryInfo ?? ""} rows={4} maxLength={5000} help={MD} />
            </Card>

            <Card id="care" title="Care instructions" className="scroll-mt-6">
              <TextArea label="Care instructions" name="careInstructions" defaultValue={product.careInstructions ?? ""} rows={4} maxLength={5000} help={MD} />
            </Card>

            <Card id="seo" title="SEO" description="Leave blank to use sensible defaults." className="scroll-mt-6">
              <div className="grid gap-4">
                <CountedInput
                  label="SEO title"
                  name="seoTitle"
                  defaultValue={product.seoTitle}
                  recommended={60}
                  maxLength={120}
                  placeholder={product.name}
                  hint="Falls back to the product name."
                />
                <CountedTextArea
                  label="SEO description"
                  name="seoDescription"
                  defaultValue={product.seoDescription}
                  recommended={160}
                  maxLength={320}
                  placeholder={product.shortDescription || "Short summary for search results"}
                  hint="Falls back to the short description."
                />
              </div>
            </Card>
          </div>

          <aside className="grid content-start gap-6 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto">
            <Card title="Publishing">
              <div className="grid gap-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-600">Status</span>
                  <StatusBadge status={status} />
                </div>
                <dl className="grid grid-cols-2 gap-y-1 text-xs text-neutral-500">
                  <dt>First published</dt>
                  <dd className="text-right">{formatDate(product.publishedAt)}</dd>
                  {product.archivedAt ? (
                    <>
                      <dt>Archived</dt>
                      <dd className="text-right">{formatDate(product.archivedAt)}</dd>
                    </>
                  ) : null}
                </dl>

                {status !== "ACTIVE" ? (
                  <ul className="grid gap-1 text-xs" aria-label="Ready to publish?">
                    {[
                      { ok: Boolean(product.categoryId), text: "Has a category" },
                      { ok: product.images.length > 0, text: "Has at least one image" },
                    ].map((c) => (
                      <li key={c.text} className={c.ok ? "text-emerald-700" : "text-red-700"}>
                        {c.ok ? "✓" : "✕"} {c.text}
                      </li>
                    ))}
                    <li className={product.basePriceCents != null ? "text-emerald-700" : "text-amber-700"}>
                      {product.basePriceCents != null ? "✓ Has a base price" : "! No base price — shown as “Price on request”"}
                    </li>
                  </ul>
                ) : null}

                <div className="grid gap-2">
                  {status === "ACTIVE" ? (
                    <>
                      <SubmitButton name="intent" value="save">
                        Save changes
                      </SubmitButton>
                      <p className="text-xs text-neutral-500">This product is live — saved changes appear on the site immediately.</p>
                    </>
                  ) : (
                    <>
                      <SubmitButton name="intent" value="save" variant="secondary">
                        {status === "DRAFT" ? "Save draft" : "Save"}
                      </SubmitButton>
                      <SubmitButton name="intent" value="publish" pendingLabel="Publishing…">
                        {status === "ARCHIVED" ? "Save & publish" : "Publish"}
                      </SubmitButton>
                      <p className="text-xs text-neutral-500">
                        {status === "DRAFT" ? "Saving keeps this product as a draft. Publish makes it live." : "Saving keeps this product archived. Publish makes it live again."}
                        {blockers.length ? ` To publish: ${blockers.join(", ").toLowerCase()} (and save).` : ""}
                      </p>
                    </>
                  )}
                </div>

                <div className="grid gap-2 border-t border-neutral-100 pt-4">
                  {status === "ACTIVE" ? (
                    <ConfirmAction
                      action={unpublishProduct.bind(null, product.id)}
                      label="Unpublish"
                      title={`Unpublish “${product.name}”?`}
                      body="The product becomes a draft and disappears from the site immediately. Unsaved edits on this page are not affected — save them separately."
                      confirmLabel="Unpublish"
                      confirmVariant="primary"
                      successMessage="Unpublished."
                    />
                  ) : null}
                  {status === "ARCHIVED" ? (
                    <ActionButton action={restoreProduct.bind(null, product.id)} pendingLabel="Restoring…" successMessage="Restored as a draft.">
                      Restore to draft
                    </ActionButton>
                  ) : (
                    <ConfirmAction
                      action={archiveProduct.bind(null, product.id)}
                      label="Archive"
                      title={`Archive “${product.name}”?`}
                      body="The product is hidden from the site and moved to the Archived tab. Quotes that reference it are kept. You can restore it at any time."
                      confirmLabel="Archive"
                      successMessage="Archived."
                    />
                  )}
                  <RunActionButton
                    action={duplicateProduct.bind(null, product.id)}
                    navigatePrefix="/admin/products/"
                    confirm={{
                      title: `Duplicate “${product.name}”?`,
                      body: "Creates a new draft “Copy of …” with the same category, descriptions, pricing, specifications, SEO, images, options (with all per-product settings) and add-ons. The SKU is left blank. Unsaved edits on this page are not copied.",
                      confirmLabel: "Duplicate",
                    }}
                    pendingLabel="Duplicating…"
                  >
                    Duplicate product
                  </RunActionButton>
                </div>

                <div className="border-t border-neutral-100 pt-4">
                  {references === 0 ? (
                    <ConfirmAction
                      action={deleteProduct.bind(null, product.id)}
                      label="Delete permanently"
                      variant="danger"
                      className="w-full"
                      title={`Delete “${product.name}” permanently?`}
                      body="This removes the product, its option and add-on settings, and its gallery. Images stay in the media library. This can't be undone."
                      confirmLabel="Delete permanently"
                      redirectTo="/admin/products"
                    />
                  ) : (
                    <p className="text-xs text-neutral-500">
                      This product can&apos;t be deleted because it&apos;s referenced by{" "}
                      {[
                        product._count.quotes ? `${product._count.quotes} quote request${product._count.quotes === 1 ? "" : "s"}` : null,
                        product._count.orderItems ? `${product._count.orderItems} order item${product._count.orderItems === 1 ? "" : "s"}` : null,
                      ]
                        .filter(Boolean)
                        .join(" and ")}
                      . {status === "ARCHIVED" ? "It's archived, so it's already hidden from the site." : "Archive it instead to hide it from the site."}
                    </p>
                  )}
                </div>
              </div>
            </Card>

            <Card title="Homepage feature">
              <div className="grid gap-3">
                <Toggle
                  label="Featured"
                  name="featured"
                  defaultChecked={product.featured}
                  description="Show in the homepage “Built to belong” section (active products only)."
                />
                <TextInput
                  label="Featured order"
                  name="featuredOrder"
                  type="number"
                  min={0}
                  max={9999}
                  defaultValue={String(product.featuredOrder)}
                  help="Lower numbers appear first."
                />
              </div>
            </Card>

            <Card title="Pricing preview" description="From saved settings, using the storefront pricing engine.">
              {!config || config.basePriceCents == null ? (
                <p className="text-sm text-neutral-600">No base price — customers see “Price on request”.</p>
              ) : (
                <div className="grid gap-2 text-sm">
                  <p>
                    <span className="text-neutral-500">Starting at</span> <strong className="tabular-nums">{start != null ? formatCents(start) : "—"}</strong>
                  </p>
                  <p>
                    <span className="text-neutral-500">Default configuration</span>{" "}
                    <strong className="tabular-nums">{defaults?.totalCents != null ? formatCents(defaults.totalCents) : "—"}</strong>
                  </p>
                  {defaults ? (
                    <ul className="mt-1 grid gap-0.5 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
                      {defaults.lines.map((l, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="truncate">
                            {l.kind === "base" ? "Base" : l.label}
                            {l.kind === "option" && l.detail ? `: ${l.detail}` : ""}
                            {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                          </span>
                          <span className="tabular-nums">{formatCents(l.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {defaults?.requiresCustomQuote ? <p className="text-xs text-amber-700">The default configuration includes a custom value, so it requires a custom quote.</p> : null}
                  {!product.showPrice || !settings.showPrices ? <p className="text-xs text-neutral-500">Prices are hidden from customers for this product.</p> : null}
                </div>
              )}
            </Card>

            <div className="hidden lg:block">
              <SectionNav sections={SECTIONS} />
            </div>
          </aside>
        </div>

        <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex items-center justify-end gap-2 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
          <SubmitButton name="intent" value="save" variant={status === "ACTIVE" ? "primary" : "secondary"}>
            {status === "DRAFT" ? "Save draft" : status === "ACTIVE" ? "Save changes" : "Save"}
          </SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
