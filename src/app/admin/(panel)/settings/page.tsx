import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { getSettings, salesFlags } from "@/lib/settings";
import { centsToDollarInput } from "@/lib/money";
import { formatBps } from "@/lib/sales/totals";
import { getStorage } from "@/lib/storage";
import { ActionForm, Select, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { ImageField } from "@/components/admin/media/ImageField";
import { CountedField } from "@/components/admin/content/CountedField";
import {
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_RECOMMENDED,
  SEO_TITLE_MAX,
  SEO_TITLE_RECOMMENDED,
} from "@/components/admin/content/validation";
import { AdminLinkButton, Badge, Card, PageHeader, formatDate } from "@/components/admin/ui";
import { editorMediaSelect } from "../pages/data";
import { defaultFinancingText } from "@/lib/payments/messaging";
import { stripePublishableKey } from "@/lib/sales/stripe";
import { listTerminalReaders } from "@/lib/sales/terminal";
import { setTerminalReaderAction } from "../sales-actions";
import { saveSettings } from "./actions";

export const metadata: Metadata = { title: "Settings" };

function storageStatus() {
  try {
    const name = getStorage().name;
    return name === "r2"
      ? { label: "Cloudflare R2", tone: "green" as const, note: "Images are stored in R2 object storage." }
      : { label: "Local disk", tone: "amber" as const, note: "Fine for development. Production should use R2 (STORAGE_DRIVER=r2)." };
  } catch {
    return { label: "Misconfigured", tone: "red" as const, note: "Storage settings are incomplete — check the R2_* environment variables." };
  }
}

function emailStatus() {
  const provider = process.env.EMAIL_PROVIDER;
  const keyed = provider === "resend" ? Boolean(process.env.RESEND_API_KEY) : provider === "postmark" ? Boolean(process.env.POSTMARK_SERVER_TOKEN) : false;
  if (provider && keyed) {
    return { label: `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`, tone: "green" as const, note: process.env.EMAIL_FROM ? "Sender address is set." : "Set EMAIL_FROM to your sending address." };
  }
  if (provider) return { label: `${provider} (missing API key)`, tone: "red" as const, note: "The provider is selected but its API key isn't set, so emails are only logged." };
  return { label: "Not configured", tone: "amber" as const, note: "Emails are only logged, not sent. Set EMAIL_PROVIDER (resend or postmark) and its API key." };
}

export default async function SettingsPage() {
  await requireAdmin();
  await getSettings(); // ensures the row exists
  const settings = await prisma.siteSetting.findUniqueOrThrow({ where: { id: "default" }, include: { defaultOgImage: { select: editorMediaSelect } } });
  const flags = salesFlags(settings);
  const terminal = flags.stripeConfigured ? await listTerminalReaders() : { readers: [], error: null };
  const storage = storageStatus();
  const email = emailStatus();
  const s = (v: string | null) => v ?? "";

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Business details, defaults and features used across the site. Last updated ${formatDate(settings.updatedAt, true)}.`}
        actions={<AdminLinkButton href="/admin/settings/pricing">Pricing calculator defaults</AdminLinkButton>}
      />
      <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        <span className="text-neutral-500">Jump to:</span>
        {[
          ["business", "Business"],
          ["social", "Social"],
          ["seo", "SEO"],
          ["quotes", "Pricing & quotes"],
          ["sales", "Quotes & invoices"],
          ["payments", "Payments"],
          ["terminal", "Terminal"],
          ["features", "Features"],
          ["security", "Security"],
          ["system", "System status"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-block py-1 text-neutral-700 underline hover:text-neutral-900">
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        <Card id="business" title="Business details" description="Shown in the header, footer, contact page and structured data for search engines.">
          <ActionForm action={saveSettings.bind(null, "business")} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput name="businessName" label="Business name" required defaultValue={settings.businessName} maxLength={120} />
              <TextInput name="tagline" label="Tagline" defaultValue={settings.tagline} maxLength={160} />
            </div>
            <TextArea name="brandStatement" label="Brand statement" rows={2} defaultValue={s(settings.brandStatement)} maxLength={600} help="A sentence or two about the business, used in the footer." />
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput name="email" label="Public email" type="email" defaultValue={s(settings.email)} maxLength={254} help="Shown on the contact page and footer." />
              <TextInput name="phone" label="Public phone" type="tel" defaultValue={s(settings.phone)} maxLength={30} />
              <TextInput name="locationText" label="Location text" defaultValue={s(settings.locationText)} maxLength={120} placeholder="Ohio" help="How your location reads on the site, e.g. “Ohio”." />
              <TextInput name="serviceAreaText" label="Service area" defaultValue={s(settings.serviceAreaText)} maxLength={300} placeholder="Delivering throughout Ohio and neighboring states" />
              <TextInput name="addressLocality" label="City / locality" defaultValue={s(settings.addressLocality)} maxLength={120} help="For search engines. Optional." />
              <TextInput name="addressRegion" label="State / region" defaultValue={s(settings.addressRegion)} maxLength={60} placeholder="OH" />
            </div>
            <TextInput
              name="notificationEmail"
              label="Notification email"
              type="email"
              defaultValue={s(settings.notificationEmail)}
              maxLength={254}
              help="Where new quote requests, custom requests and messages are sent. Not shown publicly."
              wrapperClassName="md:max-w-md"
            />
            <div className="flex justify-end border-t border-neutral-100 pt-4">
              <SubmitButton>Save business details</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card id="social" title="Social links" description="Leave blank to hide an icon. Use the full address, starting with https://">
          <ActionForm action={saveSettings.bind(null, "social")} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput name="instagramUrl" label="Instagram" type="url" defaultValue={s(settings.instagramUrl)} placeholder="https://instagram.com/yourname" maxLength={500} />
              <TextInput name="facebookUrl" label="Facebook" type="url" defaultValue={s(settings.facebookUrl)} placeholder="https://facebook.com/yourpage" maxLength={500} />
              <TextInput name="pinterestUrl" label="Pinterest" type="url" defaultValue={s(settings.pinterestUrl)} placeholder="https://pinterest.com/yourname" maxLength={500} />
              <TextInput name="houzzUrl" label="Houzz" type="url" defaultValue={s(settings.houzzUrl)} placeholder="https://houzz.com/pro/yourname" maxLength={500} />
            </div>
            <div className="flex justify-end border-t border-neutral-100 pt-4">
              <SubmitButton>Save social links</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card id="seo" title="SEO defaults" description="Used for any page that doesn't set its own SEO title, description or social image.">
          <ActionForm action={saveSettings.bind(null, "seo")} className="space-y-4">
            <CountedField name="defaultSeoTitle" label="Default SEO title" defaultValue={settings.defaultSeoTitle} recommended={SEO_TITLE_RECOMMENDED} maxLength={SEO_TITLE_MAX} />
            <CountedField
              name="defaultSeoDescription"
              label="Default SEO description"
              defaultValue={settings.defaultSeoDescription}
              recommended={SEO_DESCRIPTION_RECOMMENDED}
              maxLength={SEO_DESCRIPTION_MAX}
              multiline
            />
            <ImageField
              name="defaultOgImageId"
              label="Default social share image"
              value={settings.defaultOgImage}
              slot="og"
              help="Shown when a page is shared on social media and has no image of its own. A wide photo of your best piece works well."
            />
            <div className="flex justify-end border-t border-neutral-100 pt-4">
              <SubmitButton>Save SEO defaults</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card id="quotes" title="Pricing & quote text" description="Wording shown next to prices and after customers request a quote.">
          <ActionForm action={saveSettings.bind(null, "quotes")} className="space-y-4">
            <TextInput name="defaultLeadTime" label="Default lead time" defaultValue={s(settings.defaultLeadTime)} maxLength={160} placeholder="Typically 8–10 weeks" help="Shown on products that don't set their own lead time." />
            <TextArea name="priceDisclaimer" label="Price disclaimer" rows={2} defaultValue={s(settings.priceDisclaimer)} maxLength={400} help="Shown beneath estimated prices." />
            <TextArea name="quoteConfirmationText" label="Quote confirmation message" rows={3} defaultValue={s(settings.quoteConfirmationText)} maxLength={1500} help="Shown to customers after they submit a quote request." />
            <div className="flex justify-end border-t border-neutral-100 pt-4">
              <SubmitButton>Save pricing &amp; quote text</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card id="sales" title="Quotes & invoices" description="Defaults for new quotes and invoices. Each quote can still be changed individually.">
          <ActionForm action={saveSettings.bind(null, "sales")} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <TextInput name="quoteValidDays" label="Quotes valid for (days)" type="number" min={1} max={365} required defaultValue={settings.quoteValidDays} />
              <TextInput name="invoiceDueDays" label="Invoices due after (days)" type="number" min={0} max={365} required defaultValue={settings.invoiceDueDays} />
              <TextInput name="quoteAlertDays" label="Flag new requests after (days)" type="number" min={1} max={60} required defaultValue={settings.quoteAlertDays} help="Dashboard reminder for unanswered requests." />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Select
                name="defaultDepositType"
                label="Default deposit"
                defaultValue={settings.defaultDepositType}
                options={[
                  { value: "PERCENTAGE", label: "Percentage of total" },
                  { value: "FIXED_AMOUNT", label: "Fixed amount" },
                  { value: "NONE", label: "No deposit" },
                ]}
              />
              <TextInput name="defaultDepositPercent" label="Deposit %" inputMode="decimal" defaultValue={formatBps(settings.defaultDepositPercentBps).replace("%", "")} help="Used when the default is a percentage." />
              <TextInput name="defaultDepositAmount" label="Deposit amount ($)" inputMode="decimal" defaultValue={centsToDollarInput(settings.defaultDepositAmountCents)} help="Used when the default is a fixed amount." />
            </div>
            {/* Invoices are emailed by Wild Mountain Woodworks with a link to the invoice page (Stripe Invoicing isn't used for new invoices). */}
            <input type="hidden" name="invoiceEmailMode" value={settings.invoiceEmailMode} />
            <TextArea name="defaultQuoteTerms" label="Default quote terms" rows={7} defaultValue={s(settings.defaultQuoteTerms)} maxLength={20000} help="Copied onto every new quote; editable per quote. Customers see these." />
            <TextArea name="paymentInstructions" label="Offline payment instructions" rows={4} defaultValue={s(settings.paymentInstructions)} maxLength={2000} help="Shown on invoices and invoice emails when online payments are off, e.g. who to make checks payable to, or bank transfer details." />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
              <AdminLinkButton href="/admin/settings/emails">Edit email templates</AdminLinkButton>
              <SubmitButton>Save quote &amp; invoice defaults</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card
          id="payments"
          title="Payments"
          description="Customers choose between two ways to proceed after accepting a quote: pay the deposit (card, bank, wallets… — Affirm and Klarna are never offered for a deposit), or finance the FULL purchase with Affirm or Klarna when eligible (one Stripe Checkout for the whole order total; the invoice is then paid in full and the provider handles repayments). Which methods actually appear is decided by your Stripe settings and each customer's eligibility."
        >
          <ActionForm action={saveSettings.bind(null, "payments")} className="space-y-5">
            <p role="note" className="rounded bg-neutral-50 p-3 text-sm text-neutral-700">
              {flags.onlinePayments ? (
                <>Online payments are <Badge tone="green">ON</Badge> — this messaging is shown to customers.</>
              ) : (
                <>Online payments are <Badge tone="neutral">OFF</Badge> — nothing here is shown until they&apos;re on (see Features below), since there&apos;s no online checkout yet.</>
              )}
              <span className="mt-2 block text-xs text-neutral-600">
                Stripe&apos;s own Affirm/Klarna messaging (eligible plans for the full order total, with their official marks) on quote, order and invoice pages:{" "}
                {stripePublishableKey() ? <Badge tone="green">Configured</Badge> : <>off — your developer can set <code>STRIPE_PUBLISHABLE_KEY</code> to turn it on.</>} Product pages always use the wording below, without amounts.
              </span>
            </p>
            <Toggle
              name="paymentFinancingMessaging"
              label="Offer full-purchase financing"
              defaultChecked={settings.paymentFinancingMessaging}
              description="Shows “Finance full purchase” next to the deposit on quotes, orders and invoices (only while nothing has been paid), and the “Finance your full purchase with Affirm or Klarna when eligible” note on product pages. Affirm/Klarna must also be enabled in your Stripe Dashboard."
            />
            <div className="grid gap-5 border-l-2 border-neutral-200 pl-4 md:grid-cols-2">
              <Toggle name="paymentAffirmMessaging" label="Affirm" defaultChecked={settings.paymentAffirmMessaging} description="Only if Affirm is enabled in your Stripe account." />
              <Toggle name="paymentKlarnaMessaging" label="Klarna" defaultChecked={settings.paymentKlarnaMessaging} description="Only if Klarna is enabled in your Stripe account." />
            </div>
            <TextInput name="paymentMessagingHeading" label="Financing heading" defaultValue={settings.paymentMessagingHeading} maxLength={80} required />
            <TextArea
              name="paymentMessagingText"
              label="Payment messaging text"
              rows={2}
              defaultValue={s(settings.paymentMessagingText)}
              maxLength={300}
              placeholder={defaultFinancingText(["affirm", "klarna"])}
              help="Leave blank for automatic wording (“Finance your full purchase with Affirm or Klarna when eligible.”). Always say “when eligible”; specific terms (monthly amounts, number of payments, rates, approval) and any mention of financing a deposit are refused — Affirm and Klarna finance the full purchase only, and Stripe shows eligible plans at checkout."
            />
            <Toggle name="paymentMethodsMessaging" label="Show general payment methods" defaultChecked={settings.paymentMethodsMessaging} description="A secondary “Secure payment options may include: …” line, always followed by “Payment options vary by eligibility, device and transaction.”" />
            <TextInput name="paymentMethodsText" label="Payment methods list" defaultValue={settings.paymentMethodsText} maxLength={200} required help="Ordinary methods, shown with the deposit and balance buttons. Separate with · or commas. Affirm and Klarna are always left out here — they're offered only as full-purchase financing." />
            <div className="flex justify-end border-t border-neutral-100 pt-4">
              <SubmitButton>Save payment messaging</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card
          id="terminal"
          title="Payments → Terminal (in-person card)"
          description="Take card payments in person (at the shop or on delivery) on a Stripe Terminal smart reader. Register readers in your Stripe Dashboard (Terminal → Readers); pick the one to use here. Your Stripe secret key never leaves the server."
        >
          {!flags.stripeConfigured ? (
            <p className="text-sm text-neutral-600">Stripe isn&apos;t configured yet (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET).</p>
          ) : terminal.error ? (
            <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">Couldn&apos;t load readers from Stripe: {terminal.error}</p>
          ) : (
            <div className="space-y-4">
              {terminal.readers.length ? (
                <ul className="divide-y divide-neutral-100 rounded border border-neutral-200 text-sm">
                  {terminal.readers.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        <span className="font-medium text-neutral-900">{r.label}</span>
                        <span className="ml-2 font-mono text-xs text-neutral-500">{r.id}</span>
                        <span className="block text-xs text-neutral-500">{[r.deviceType, r.serialNumber, r.locationId ? `location ${r.locationId}` : null].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {settings.terminalReaderId === r.id ? <Badge tone="blue">Selected</Badge> : null}
                        <Badge tone={r.status === "online" ? "green" : r.status === "offline" ? "red" : "neutral"}>{r.status ?? "unknown"}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-600">No readers registered in this Stripe account yet.</p>
              )}
              <ActionForm action={setTerminalReaderAction} className="flex flex-wrap items-end gap-3">
                <Select
                  name="readerId"
                  label="Reader for in-person payments"
                  defaultValue={settings.terminalReaderId ?? ""}
                  options={[{ value: "", label: "None" }, ...terminal.readers.map((r) => ({ value: r.id, label: `${r.label} (${r.status ?? "unknown"})` }))]}
                  wrapperClassName="min-w-[16rem]"
                />
                <SubmitButton>Save reader</SubmitButton>
              </ActionForm>
            </div>
          )}
        </Card>

        <Card id="features" title="Features" description="Switch parts of the site on or off. Changes take effect immediately.">
          <ActionForm action={saveSettings.bind(null, "features")} className="space-y-5">
            <Toggle
              name="showPrices"
              label="Show prices"
              defaultChecked={settings.showPrices}
              description="Show starting and estimated prices across the catalog and configurator. When off, every product becomes quote-only (individual products can also hide their price)."
            />
            <Toggle
              name="quotesEnabled"
              label="Quote requests"
              defaultChecked={settings.quotesEnabled}
              description="Let customers request a quote for a configured piece and use the Request a Quote page. When off, product pages point customers to the contact page instead."
            />
            <Toggle
              name="customOrdersEnabled"
              label="Custom orders"
              defaultChecked={settings.customOrdersEnabled}
              description="Accept custom furniture requests through the Custom Furniture page form."
            />
            <Toggle
              name="taxEnabled"
              label="Tax on quotes and invoices"
              defaultChecked={settings.taxEnabled}
              description="Off until your tax rules are configured. When on, a tax amount can be entered on quotes; it is added to the total."
            />
            <div className="rounded border border-neutral-200 p-4">
              <Toggle
                name="stripeInvoicingEnabled"
                label="Online payments (Stripe)"
                defaultChecked={settings.stripeInvoicingEnabled}
                description="Customers pay the deposit through Stripe Checkout as soon as they accept a quote, and the final balance the same way from their Wild Mountain Woodworks invoice once you mark it due. Wild Mountain Woodworks' invoice is the record — no separate Stripe invoices. Cards are never saved. Cash, checks, transfers and in-person card (Stripe Terminal) are recorded on the invoice."
              />
              <div className="mt-4 rounded bg-neutral-50 p-3 text-sm" role="note">
                <p className="font-medium text-neutral-900">
                  Online payments are currently {flags.stripeInvoicing ? <Badge tone="green">ON</Badge> : <Badge tone="neutral">OFF</Badge>}
                </p>
                <p className="mt-1 text-neutral-600">It only turns on when both of these are true. Until then, deposits and invoices are paid offline using your payment instructions.</p>
                <ul className="mt-3 space-y-2">
                  <Condition ok={flags.stripeInvoicingFlag} label="Online payments switch above is on" detail={flags.stripeInvoicingFlag ? "On" : "Off"} />
                  <Condition
                    ok={flags.stripeConfigured}
                    label="Stripe keys configured"
                    detail={
                      flags.stripeConfigured ? (
                        "Configured"
                      ) : (
                        <>
                          Not configured. Your developer sets <code className="text-xs">STRIPE_SECRET_KEY</code> and <code className="text-xs">STRIPE_WEBHOOK_SECRET</code> (and the webhook endpoint in Stripe).
                        </>
                      )
                    }
                  />
                </ul>
              </div>
            </div>
            <div className="flex justify-end border-t border-neutral-100 pt-4">
              <SubmitButton>Save features</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card id="security" title="Security & admin users" description="Your password, two-factor authentication, signed-in devices, admin users and the audit log.">
          <AdminLinkButton href="/admin/security">Open security settings</AdminLinkButton>
        </Card>

        <Card id="system" title="System status" description="Read-only. These are configured by your developer through environment variables.">
          <dl className="grid gap-4 sm:grid-cols-3">
            <StatusItem label="Image storage" value={storage.label} tone={storage.tone} note={storage.note} />
            <StatusItem label="Email delivery" value={email.label} tone={email.tone} note={email.note} />
            <StatusItem
              label="Stripe payments"
              value={flags.stripeConfigured ? "Configured" : "Not configured"}
              tone={flags.stripeConfigured ? "green" : "neutral"}
              note={flags.stripeConfigured ? "Keys are present (values are never shown here)." : "Only needed for online payments (Stripe)."}
            />
          </dl>
        </Card>
      </div>
    </>
  );
}

function Condition({ ok, label, detail }: { ok: boolean; label: string; detail: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={ok ? "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white" : "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-300 text-neutral-700"}
        aria-hidden="true"
      >
        {ok ? "✓" : "–"}
      </span>
      <span>
        <span className="font-medium text-neutral-900">{label}</span>
        <span className="sr-only">{ok ? " (met)" : " (not met)"}</span>
        <span className="block text-xs text-neutral-600">{detail}</span>
      </span>
    </li>
  );
}

function StatusItem({ label, value, tone, note }: { label: string; value: string; tone: "green" | "amber" | "red" | "neutral"; note: string }) {
  return (
    <div className="rounded border border-neutral-200 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-2">
        <Badge tone={tone}>{value}</Badge>
        <p className="mt-2 text-xs text-neutral-600">{note}</p>
      </dd>
    </div>
  );
}
