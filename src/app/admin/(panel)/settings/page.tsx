import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { commerceState, getSettings } from "@/lib/settings";
import { getStorage } from "@/lib/storage";
import { ActionButton, ActionForm, ConfirmAction, Select, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { ImageField } from "@/components/admin/media/ImageField";
import { CountedField } from "@/components/admin/content/CountedField";
import {
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_RECOMMENDED,
  SEO_TITLE_MAX,
  SEO_TITLE_RECOMMENDED,
} from "@/components/admin/content/validation";
import { AdminLinkButton, Badge, Card, PageHeader, formatDate, humanizeEnum, table } from "@/components/admin/ui";
import { editorMediaSelect } from "../pages/data";
import { changePassword, createAdminUser, saveSettings, setAdminActive } from "./actions";

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
  const admin = await requireAdmin();
  await getSettings(); // ensures the row exists
  const [settings, admins] = await Promise.all([
    prisma.siteSetting.findUniqueOrThrow({ where: { id: "default" }, include: { defaultOgImage: { select: editorMediaSelect } } }),
    admin.role === "OWNER"
      ? prisma.adminUser.findMany({ orderBy: [{ active: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true } })
      : Promise.resolve([]),
  ]);
  const commerce = commerceState(settings);
  const storage = storageStatus();
  const email = emailStatus();
  const activeOwners = admins.filter((a) => a.role === "OWNER" && a.active).length;
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
          ["features", "Features"],
          ["account", "Your account"],
          ...(admin.role === "OWNER" ? [["admins", "Admin users"]] : []),
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
            <div className="rounded border border-neutral-200 p-4">
              <Toggle
                name="ecommerceEnabled"
                label="E-commerce (online checkout)"
                defaultChecked={settings.ecommerceEnabled}
                description="Allow customers to buy eligible products online with Stripe Checkout instead of requesting a quote."
              />
              <div className="mt-4 rounded bg-neutral-50 p-3 text-sm" role="note">
                <p className="font-medium text-neutral-900">
                  Online checkout is currently{" "}
                  {commerce.ecommerce ? <Badge tone="green">ON for visitors</Badge> : <Badge tone="neutral">OFF for visitors</Badge>}
                </p>
                <p className="mt-1 text-neutral-600">It only turns on when all three of these are true. Turning the switch on without the others changes nothing on the public site.</p>
                <ul className="mt-3 space-y-2">
                  <Condition ok={commerce.ecommerceFlag} label="E-commerce switch above is on" detail={commerce.ecommerceFlag ? "On" : "Off"} />
                  <Condition
                    ok={commerce.stripeConfigured}
                    label="Stripe keys configured"
                    detail={
                      commerce.stripeConfigured ? (
                        "Configured"
                      ) : (
                        <>
                          Not configured. Your developer sets these environment variables: <code className="text-xs">STRIPE_SECRET_KEY</code>,{" "}
                          <code className="text-xs">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> and <code className="text-xs">STRIPE_WEBHOOK_SECRET</code>.
                        </>
                      )
                    }
                  />
                  <Condition
                    ok={commerce.checkoutUiReady}
                    label="Cart & checkout pages released"
                    detail={commerce.checkoutUiReady ? "Released" : "Not yet released — the cart and checkout pages are still being built."}
                  />
                </ul>
              </div>
            </div>
            <div className="flex justify-end border-t border-neutral-100 pt-4">
              <SubmitButton>Save features</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card id="account" title="Your account" description={`Signed in as ${admin.name} (${admin.email}) · ${humanizeEnum(admin.role)}`}>
          <ActionForm action={changePassword} resetOnSuccess className="max-w-md space-y-4" successMessage={null}>
            <input type="text" name="username" autoComplete="username" defaultValue={admin.email} hidden readOnly />
            <TextInput name="currentPassword" label="Current password" type="password" autoComplete="current-password" required />
            <TextInput
              name="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              help={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and a number or symbol. A passphrase works well.`}
            />
            <TextInput name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required />
            <p className="text-xs text-neutral-500">Changing your password signs you out on every other device.</p>
            <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
          </ActionForm>
        </Card>

        {admin.role === "OWNER" ? (
          <Card id="admins" title="Admin users" description="People who can sign in to this admin. Only owners can see this section.">
            <div className="space-y-6">
              <div className={`${table.wrap} relative`}>
                <table className={table.table}>
                  <thead className={table.thead}>
                    <tr>
                      <th scope="col" className={table.th}>
                        Name
                      </th>
                      <th scope="col" className={table.th}>
                        Role
                      </th>
                      <th scope="col" className={table.th}>
                        Status
                      </th>
                      <th scope="col" className={table.th}>
                        Last sign-in
                      </th>
                      <th scope="col" className={table.th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className={table.tbody}>
                    {admins.map((u) => {
                      const isSelf = u.id === admin.id;
                      const lastOwner = u.role === "OWNER" && u.active && activeOwners <= 1;
                      return (
                        <tr key={u.id} className={table.tr}>
                          <td className={table.td}>
                            <span className="font-medium text-neutral-900">{u.name}</span>
                            {isSelf ? <span className="ml-1 text-xs text-neutral-500">(you)</span> : null}
                            <span className="block text-xs text-neutral-500">{u.email}</span>
                          </td>
                          <td className={table.td}>{humanizeEnum(u.role)}</td>
                          <td className={table.td}>{u.active ? <Badge tone="green">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>}</td>
                          <td className={`${table.td} whitespace-nowrap`}>{u.lastLoginAt ? formatDate(u.lastLoginAt, true) : "Never"}</td>
                          <td className={`${table.td} text-right`}>
                            {isSelf ? (
                              <span className="text-xs text-neutral-400">—</span>
                            ) : !u.active ? (
                              <ActionButton action={setAdminActive.bind(null, u.id, true)} variant="small" pendingLabel="Saving…">
                                Reactivate
                              </ActionButton>
                            ) : lastOwner ? (
                              <span className="text-xs text-neutral-500">Last owner</span>
                            ) : (
                              <ConfirmAction
                                action={setAdminActive.bind(null, u.id, false)}
                                label="Deactivate"
                                variant="small"
                                title={`Deactivate ${u.name}?`}
                                body="They'll be signed out immediately and won't be able to sign in until reactivated. Their activity history is kept."
                                confirmLabel="Deactivate"
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-neutral-900">Add an admin</h3>
                <ActionForm action={createAdminUser} resetOnSuccess className="space-y-4" successMessage={null}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextInput name="name" label="Name" required maxLength={120} autoComplete="off" />
                    <TextInput name="email" label="Email" type="email" required maxLength={254} autoComplete="off" />
                    <Select
                      name="role"
                      label="Role"
                      defaultValue="ADMIN"
                      options={[
                        { value: "ADMIN", label: "Admin — manages everything except admin users" },
                        { value: "EDITOR", label: "Editor — content and catalog editing" },
                        { value: "OWNER", label: "Owner — full access, including admin users" },
                      ]}
                    />
                    <TextInput
                      name="password"
                      label="Initial password"
                      type="password"
                      required
                      autoComplete="new-password"
                      help={`At least ${PASSWORD_MIN_LENGTH} characters. Share it privately and ask them to change it after signing in.`}
                    />
                  </div>
                  <SubmitButton pendingLabel="Adding…">Add admin</SubmitButton>
                </ActionForm>
              </div>
            </div>
          </Card>
        ) : null}

        <Card id="system" title="System status" description="Read-only. These are configured by your developer through environment variables.">
          <dl className="grid gap-4 sm:grid-cols-3">
            <StatusItem label="Image storage" value={storage.label} tone={storage.tone} note={storage.note} />
            <StatusItem label="Email delivery" value={email.label} tone={email.tone} note={email.note} />
            <StatusItem
              label="Stripe payments"
              value={commerce.stripeConfigured ? "Configured" : "Not configured"}
              tone={commerce.stripeConfigured ? "green" : "neutral"}
              note={commerce.stripeConfigured ? "Keys are present (values are never shown here)." : "Only needed if you enable online checkout."}
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
