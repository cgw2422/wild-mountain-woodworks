import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { centsToDollarInput } from "@/lib/money";
import { ROUNDING_OPTIONS } from "@/lib/pricing/estimator";
import { AdminLinkButton, Card, PageHeader } from "@/components/admin/ui";
import { ActionForm, MoneyInput, Select, SubmitButton, TextInput } from "@/components/admin/forms";
import { savePricingSettings } from "../../pricing-calculator/actions";

export const metadata: Metadata = { title: "Pricing defaults" };
export const dynamic = "force-dynamic";

export default async function PricingSettingsPage() {
  await requireAdmin();
  const s = await getSettings();
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Settings", href: "/admin/settings" }, { label: "Pricing defaults" }]}
        title="Pricing calculator defaults"
        description="Starting values for every new estimate. Each estimate can override them. These are internal and never shown on the website."
        actions={<AdminLinkButton href="/admin/pricing-calculator">Open calculator</AdminLinkButton>}
      />
      <ActionForm action={savePricingSettings} successMessage="Pricing defaults saved." className="max-w-3xl space-y-6">
        <Card title="Labor & materials">
          <div className="grid gap-4 sm:grid-cols-3">
            <MoneyInput label="Shop labor rate" name="pricingLaborRateCents" defaultValue={centsToDollarInput(s.pricingLaborRateCents)} help="Per build hour." />
            <TextInput label="Lumber waste %" name="pricingLumberWastePct" inputMode="decimal" defaultValue={String(s.pricingLumberWastePct)} help="Typically 10–25%." />
            <TextInput label="Hardware & component waste %" name="pricingMaterialWastePct" inputMode="decimal" defaultValue={String(s.pricingMaterialWastePct)} />
          </div>
        </Card>
        <Card title="Overhead" description="Choose the method new estimates start with.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Default overhead method"
              name="pricingOverheadMethod"
              defaultValue={s.pricingOverheadMethod}
              options={[
                { value: "percent", label: "Percentage of direct costs" },
                { value: "allocated", label: "Monthly overhead ÷ projects per month" },
              ]}
            />
            <TextInput label="Miscellaneous / overhead %" name="pricingOverheadPct" inputMode="decimal" defaultValue={String(s.pricingOverheadPct)} />
            <MoneyInput label="Monthly shop overhead" name="pricingMonthlyOverheadCents" defaultValue={centsToDollarInput(s.pricingMonthlyOverheadCents)} help="Rent, utilities, insurance, tools, software…" />
            <TextInput label="Expected projects per month" name="pricingProjectsPerMonth" inputMode="numeric" defaultValue={String(s.pricingProjectsPerMonth)} />
          </div>
        </Card>
        <Card title="Margin & warnings">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput label="Default target margin %" name="pricingTargetMarginPct" inputMode="decimal" defaultValue={String(s.pricingTargetMarginPct)} help="Profit as a share of the selling price." />
            <TextInput label="Warn below margin %" name="pricingMinMarginWarnPct" inputMode="decimal" defaultValue={String(s.pricingMinMarginWarnPct)} />
            <TextInput label="Warn when materials + labor exceed %" name="pricingMaterialsLaborWarnPct" inputMode="decimal" defaultValue={String(s.pricingMaterialsLaborWarnPct)} help="Also used for the reference “Materials + Labor” check." />
          </div>
        </Card>
        <Card
          title="Recommendation & deposit"
          description="The pricing floor is always material cost ÷ 0.30. Recommendations are rounded up — never below the floor."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Round recommended price up to"
              name="pricingRoundToDollars"
              defaultValue={String(s.pricingRoundToDollars)}
              options={ROUNDING_OPTIONS.map((d) => ({ value: String(d), label: d ? `Nearest $${d}` : "No rounding" }))}
            />
            <TextInput label="Default deposit %" name="pricingDepositPct" inputMode="decimal" defaultValue={String(s.pricingDepositPct)} help="Share of the final price due up front." />
          </div>
        </Card>
        <SubmitButton>Save defaults</SubmitButton>
      </ActionForm>
    </>
  );
}
