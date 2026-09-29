import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { estimateInputsSchema } from "@/lib/pricing/estimate-schema";
import { Badge, PageHeader, formatDate } from "@/components/admin/ui";
import { ActionButton } from "@/components/admin/forms";
import { Calculator } from "../Calculator";
import { duplicateEstimate, setEstimateArchived } from "../actions";
import { loadCalculatorContext } from "../data";
import { DuplicateAndOpen } from "./DuplicateAndOpen";

export const metadata: Metadata = { title: "Price estimate" };
export const dynamic = "force-dynamic";

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [estimate, ctx] = await Promise.all([
    prisma.priceEstimate.findUnique({ where: { id }, include: { quoteRequest: { select: { id: true, reference: true } } } }),
    loadCalculatorContext(),
  ]);
  if (!estimate) notFound();
  // Older or hand-edited inputs fall back to defaults rather than crashing.
  const parsed = estimateInputsSchema.safeParse(estimate.inputs);
  const inputs = parsed.success ? parsed.data : ctx.defaults;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Pricing calculator", href: "/admin/pricing-calculator" }, { label: estimate.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {estimate.name}
            {estimate.archivedAt ? <Badge tone="amber">Archived</Badge> : null}
          </span>
        }
        description={`Saved estimate · last updated ${formatDate(estimate.updatedAt, true)}`}
        actions={
          <>
            <DuplicateAndOpen action={duplicateEstimate.bind(null, estimate.id)} />
            <ActionButton action={setEstimateArchived.bind(null, estimate.id, !estimate.archivedAt)}>{estimate.archivedAt ? "Restore" : "Archive"}</ActionButton>
          </>
        }
      />
      {!parsed.success ? (
        <p className="mb-4 rounded bg-amber-50 px-4 py-3 text-sm text-amber-900">This estimate&apos;s saved inputs couldn&apos;t be read, so defaults are shown. Saving will replace them.</p>
      ) : null}
      <Calculator
        estimate={{
          id: estimate.id,
          name: estimate.name,
          customerName: estimate.customerName,
          customerEmail: estimate.customerEmail,
          customerPhone: estimate.customerPhone,
          customerZip: estimate.customerZip,
          productId: estimate.productId,
          notes: estimate.notes,
          archived: Boolean(estimate.archivedAt),
          quote: estimate.quoteRequest,
        }}
        initialInputs={inputs}
        thresholds={ctx.thresholds}
        products={ctx.products}
      />
    </>
  );
}
