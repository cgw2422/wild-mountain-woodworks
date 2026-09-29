"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { centsToDollarInput, formatCents, parseDollarsToCents } from "@/lib/money";
import {
  MARGIN_PRESETS,
  computeEstimate,
  fmtPct,
  type EstimateInputs,
  type EstimateResult,
  type EstimateThresholds,
} from "@/lib/pricing/estimator";
import { ActionForm, Dialog, SubmitButton, TextArea, TextInput, useAdminForm } from "@/components/admin/forms";
import { adminButton, Card } from "@/components/admin/ui";
import { convertEstimateToQuote, saveEstimate, updateProductPricing } from "./actions";

/* -------------------------------------------------------------------------- */
/* UI state: numbers are kept as the strings the admin typed                  */
/* -------------------------------------------------------------------------- */

type LumberRow = { id: string; description: string; thickness: string; width: string; length: string; quantity: string; price: string };
type MaterialRow = { id: string; description: string; quantity: string; unitCost: string };
type PhaseRow = { id: string; name: string; hours: string; rate: string };

interface UiState {
  lumber: LumberRow[];
  lumberWaste: string;
  materials: MaterialRow[];
  materialWaste: string;
  laborMode: "simple" | "phases";
  laborHours: string;
  laborRate: string;
  phases: PhaseRow[];
  overheadMethod: "percent" | "allocated";
  overheadPct: string;
  monthlyOverhead: string;
  projectsPerMonth: string;
  margin: string;
  proposed: string;
}

let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const n = (s: string) => {
  const v = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
};
const money = (s: string) => {
  const c = parseDollarsToCents(s);
  return c == null || Number.isNaN(c) ? 0 : Math.max(0, c);
};
const numStr = (v: number) => (v ? String(Math.round(v * 10000) / 10000) : "");

function toUi(i: EstimateInputs): UiState {
  return {
    lumber: i.lumber.map((l) => ({
      id: l.id,
      description: l.description,
      thickness: numStr(l.thicknessIn),
      width: numStr(l.widthIn),
      length: numStr(l.lengthFt),
      quantity: numStr(l.quantity),
      price: centsToDollarInput(l.pricePerBoardFootCents),
    })),
    lumberWaste: String(i.lumberWastePct),
    materials: i.materials.map((m) => ({ id: m.id, description: m.description, quantity: numStr(m.quantity), unitCost: centsToDollarInput(m.unitCostCents) })),
    materialWaste: String(i.materialWastePct),
    laborMode: i.laborMode,
    laborHours: numStr(i.laborHours),
    laborRate: centsToDollarInput(i.laborRateCents),
    phases: i.laborPhases.map((p) => ({ id: p.id, name: p.name, hours: numStr(p.hours), rate: centsToDollarInput(p.rateCents) })),
    overheadMethod: i.overheadMethod,
    overheadPct: String(i.overheadPct),
    monthlyOverhead: centsToDollarInput(i.monthlyOverheadCents),
    projectsPerMonth: String(i.projectsPerMonth),
    margin: String(i.targetMarginPct),
    proposed: centsToDollarInput(i.proposedPriceCents),
  };
}

function toInputs(u: UiState): EstimateInputs {
  const proposed = parseDollarsToCents(u.proposed);
  return {
    lumber: u.lumber.map((l) => ({
      id: l.id,
      description: l.description.slice(0, 200),
      thicknessIn: n(l.thickness),
      widthIn: n(l.width),
      lengthFt: n(l.length),
      quantity: n(l.quantity),
      pricePerBoardFootCents: money(l.price),
    })),
    lumberWastePct: n(u.lumberWaste),
    materials: u.materials.map((m) => ({ id: m.id, description: m.description.slice(0, 200), quantity: n(m.quantity), unitCostCents: money(m.unitCost) })),
    materialWastePct: n(u.materialWaste),
    laborMode: u.laborMode,
    laborHours: n(u.laborHours),
    laborRateCents: money(u.laborRate),
    laborPhases: u.phases.map((p) => ({ id: p.id, name: p.name.slice(0, 200), hours: n(p.hours), rateCents: money(p.rate) })),
    overheadMethod: u.overheadMethod,
    overheadPct: n(u.overheadPct),
    monthlyOverheadCents: money(u.monthlyOverhead),
    projectsPerMonth: Math.max(0, Math.round(n(u.projectsPerMonth))),
    targetMarginPct: Math.min(99.9, n(u.margin)),
    proposedPriceCents: proposed != null && !Number.isNaN(proposed) && proposed > 0 ? proposed : null,
  };
}

/* -------------------------------------------------------------------------- */

export interface CalculatorProduct {
  id: string;
  name: string;
  status: string;
  basePriceCents: number | null;
  estMaterialCostCents: number | null;
  estLaborHours: number | null;
}

export interface CalculatorEstimate {
  id: string;
  name: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerZip: string | null;
  productId: string | null;
  notes: string | null;
  archived: boolean;
  quote: { id: string; reference: string } | null;
}

const STOCK = [
  { label: "4/4", value: "1" },
  { label: "5/4", value: "1.25" },
  { label: "6/4", value: "1.5" },
  { label: "8/4", value: "2" },
  { label: "10/4", value: "2.5" },
  { label: "12/4", value: "3" },
];
const WASTE_PRESETS = [10, 15, 20, 25];
const MATERIAL_PRESETS = ["Table legs", "Hardware", "Stain", "Polyurethane", "Sandpaper", "Screws", "Glue", "Delivery materials"];

const cellInput =
  "block h-9 w-full rounded border border-neutral-300 bg-white px-2 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900";

export function Calculator({
  estimate,
  initialInputs,
  thresholds,
  products,
  autoLoadProduct,
  prefill,
}: {
  estimate: CalculatorEstimate | null;
  initialInputs: EstimateInputs;
  thresholds: EstimateThresholds;
  products: CalculatorProduct[];
  autoLoadProduct?: boolean;
  prefill?: Partial<Pick<CalculatorEstimate, "name" | "customerName" | "customerEmail" | "customerPhone" | "customerZip" | "productId" | "notes">>;
}) {
  const router = useRouter();
  const initialProductId = estimate?.productId ?? prefill?.productId ?? "";
  const [productId, setProductId] = useState(initialProductId);
  const product = products.find((p) => p.id === productId) ?? null;

  const [ui, setUi] = useState<UiState>(() => {
    const base = toUi(initialInputs);
    const p = products.find((x) => x.id === initialProductId);
    return autoLoadProduct && p ? applyProduct(base, p) : base;
  });
  const [savedSnapshot, setSavedSnapshot] = useState(() => (estimate ? JSON.stringify(toInputs(toUi(initialInputs))) : null));

  const inputs = useMemo(() => toInputs(ui), [ui]);
  const result = useMemo(() => computeEstimate(inputs, thresholds), [inputs, thresholds]);
  const dirty = savedSnapshot !== JSON.stringify(inputs);

  const [dialog, setDialog] = useState<null | "convert" | "product">(null);
  const set = <K extends keyof UiState>(k: K, v: UiState[K]) => setUi((s) => ({ ...s, [k]: v }));

  return (
    <>
      <ActionForm
        action={(fd) => saveEstimate(estimate?.id ?? null, fd)}
        successMessage="Estimate saved."
        onSuccess={(res) => {
          setSavedSnapshot(JSON.stringify(inputs));
          if (!estimate && res.id) router.push(`/admin/pricing-calculator/${res.id}`);
        }}
      >
        <input type="hidden" name="inputs" value={JSON.stringify(inputs)} />
        <input type="hidden" name="productId" value={productId} />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
          {/* ---------------------------------------------------- Inputs */}
          <div className="min-w-0 space-y-6">
            <Card title="Estimate" description="Internal only — customers never see this tool or its numbers.">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label="Estimate name"
                  name="name"
                  required
                  defaultValue={estimate?.name ?? prefill?.name ?? ""}
                  placeholder='e.g. Smith 84" White Oak Dining Table'
                  wrapperClassName="sm:col-span-2"
                  maxLength={160}
                />
                <TextInput label="Customer name" name="customerName" defaultValue={estimate?.customerName ?? prefill?.customerName ?? ""} maxLength={120} />
                <TextInput label="Customer email" name="customerEmail" type="email" defaultValue={estimate?.customerEmail ?? prefill?.customerEmail ?? ""} maxLength={254} />
                <TextInput label="Customer phone" name="customerPhone" defaultValue={estimate?.customerPhone ?? prefill?.customerPhone ?? ""} maxLength={30} />
                <TextInput label="Customer ZIP" name="customerZip" defaultValue={estimate?.customerZip ?? prefill?.customerZip ?? ""} maxLength={10} />
              </div>
              <div className="mt-5 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <label htmlFor="calc-product" className="mb-1.5 block text-sm font-medium text-neutral-800">
                  Start from a product <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <select id="calc-product" value={productId} onChange={(e) => setProductId(e.target.value)} className={cn(cellInput, "h-10 sm:max-w-md")}>
                  <option value="">No product — fully custom piece</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.status !== "ACTIVE" ? ` (${p.status.toLowerCase()})` : ""}
                    </option>
                  ))}
                </select>
                {product ? (
                  <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-700">
                    <span>Base price: {product.basePriceCents != null ? formatCents(product.basePriceCents) : "—"}</span>
                    <span>Material estimate: {product.estMaterialCostCents != null ? formatCents(product.estMaterialCostCents) : "—"}</span>
                    <span>Typical labor: {product.estLaborHours != null ? `${product.estLaborHours} h` : "—"}</span>
                    <button type="button" className={adminButton.small} onClick={() => setUi((s) => applyProduct(s, product))}>
                      Load product assumptions
                    </button>
                    <Link href={`/admin/products/${product.id}#pricing`} className="text-xs underline" target="_blank">
                      Edit product estimates ↗
                    </Link>
                  </div>
                ) : null}
              </div>
            </Card>

            {/* Lumber */}
            <Card
              title="Lumber (board feet)"
              description="Board feet = thickness (in) × width (in) × length (ft) ÷ 12, × quantity."
              bodyClassName="p-0"
            >
              {ui.lumber.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Species</th>
                        <th className="px-2 py-2 text-left font-semibold">Thick.</th>
                        <th className="px-2 py-2 text-left font-semibold">W (in)</th>
                        <th className="px-2 py-2 text-left font-semibold">L (ft)</th>
                        <th className="px-2 py-2 text-left font-semibold">Qty</th>
                        <th className="px-2 py-2 text-left font-semibold">$ / BF</th>
                        <th className="px-2 py-2 text-right font-semibold">BF</th>
                        <th className="px-2 py-2 text-right font-semibold">Cost</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {ui.lumber.map((row, i) => {
                        const line = result.lumber.lines[i];
                        const upd = (patch: Partial<LumberRow>) => set("lumber", ui.lumber.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
                        const stock = STOCK.find((s) => Number(s.value) === n(row.thickness));
                        return (
                          <tr key={row.id}>
                            <td className="px-3 py-2">
                              <input aria-label="Lumber description" className={cn(cellInput, "min-w-[7rem]")} value={row.description} onChange={(e) => upd({ description: e.target.value })} placeholder="White Oak" />
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex gap-1">
                                <select
                                  aria-label="Stock thickness"
                                  className={cn(cellInput, "w-[4.5rem] px-1")}
                                  value={stock?.value ?? "custom"}
                                  onChange={(e) => upd({ thickness: e.target.value === "custom" ? "" : e.target.value })}
                                >
                                  {STOCK.map((s) => (
                                    <option key={s.value} value={s.value}>
                                      {s.label}
                                    </option>
                                  ))}
                                  <option value="custom">Other</option>
                                </select>
                                {!stock ? (
                                  <input aria-label="Thickness in inches" inputMode="decimal" placeholder="in" className={cn(cellInput, "w-14")} value={row.thickness} onChange={(e) => upd({ thickness: e.target.value })} />
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <input aria-label="Width in inches" inputMode="decimal" className={cn(cellInput, "w-16")} value={row.width} onChange={(e) => upd({ width: e.target.value })} />
                            </td>
                            <td className="px-2 py-2">
                              <input aria-label="Length in feet" inputMode="decimal" className={cn(cellInput, "w-16")} value={row.length} onChange={(e) => upd({ length: e.target.value })} />
                            </td>
                            <td className="px-2 py-2">
                              <input aria-label="Quantity" inputMode="decimal" className={cn(cellInput, "w-12")} value={row.quantity} onChange={(e) => upd({ quantity: e.target.value })} />
                            </td>
                            <td className="px-2 py-2">
                              <input aria-label="Price per board foot" inputMode="decimal" className={cn(cellInput, "w-16")} value={row.price} onChange={(e) => upd({ price: e.target.value })} placeholder="8.30" />
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-neutral-600">{line ? line.boardFeet.toFixed(2) : "—"}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{line ? formatCents(line.costCents, { showZeroCents: true }) : "—"}</td>
                            <td className="px-2 py-2 text-right">
                              <RemoveButton label={`Remove ${row.description || "lumber line"}`} onClick={() => set("lumber", ui.lumber.filter((r) => r.id !== row.id))} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-5 pt-5 text-sm text-neutral-500">No lumber lines yet.</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-neutral-100 px-5 py-4">
                <button
                  type="button"
                  className={adminButton.secondary}
                  onClick={() => set("lumber", [...ui.lumber, { id: newId("l"), description: "", thickness: "1", width: "", length: "", quantity: "1", price: "" }])}
                >
                  + Add lumber
                </button>
                <PercentPicker label="Lumber waste" value={ui.lumberWaste} onChange={(v) => set("lumberWaste", v)} presets={WASTE_PRESETS} />
              </div>
              <SubTotal
                rows={[
                  [`${result.lumber.boardFeet.toFixed(2)} board feet`, result.lumber.rawCents],
                  [`Waste (${fmtPct(n(ui.lumberWaste))})`, result.lumber.wasteCents],
                ]}
                total={["Lumber total", result.lumber.totalCents]}
              />
            </Card>

            {/* Other materials */}
            <Card title="Other materials" description="Legs, hardware, finish, consumables — anything besides lumber." bodyClassName="p-0">
              {ui.materials.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Description</th>
                        <th className="px-2 py-2 text-left font-semibold">Quantity</th>
                        <th className="px-2 py-2 text-left font-semibold">Unit cost</th>
                        <th className="px-2 py-2 text-right font-semibold">Total</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {ui.materials.map((row, i) => {
                        const upd = (patch: Partial<MaterialRow>) => set("materials", ui.materials.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
                        return (
                          <tr key={row.id}>
                            <td className="px-3 py-2">
                              <input aria-label="Material description" className={cellInput} value={row.description} onChange={(e) => upd({ description: e.target.value })} />
                            </td>
                            <td className="px-2 py-2">
                              <input aria-label="Quantity" inputMode="decimal" className={cn(cellInput, "w-20")} value={row.quantity} onChange={(e) => upd({ quantity: e.target.value })} />
                            </td>
                            <td className="px-2 py-2">
                              <input aria-label="Unit cost in dollars" inputMode="decimal" className={cn(cellInput, "w-24")} value={row.unitCost} onChange={(e) => upd({ unitCost: e.target.value })} />
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatCents(result.otherMaterials.lines[i]?.totalCents ?? 0, { showZeroCents: true })}</td>
                            <td className="px-2 py-2 text-right">
                              <RemoveButton label={`Remove ${row.description || "material"}`} onClick={() => set("materials", ui.materials.filter((r) => r.id !== row.id))} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="space-y-3 border-t border-neutral-100 px-5 py-4">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={adminButton.secondary} onClick={() => set("materials", [...ui.materials, { id: newId("m"), description: "", quantity: "1", unitCost: "" }])}>
                    + Add material
                  </button>
                  {MATERIAL_PRESETS.filter((p) => !ui.materials.some((m) => m.description === p)).map((p) => (
                    <button key={p} type="button" className={adminButton.small} onClick={() => set("materials", [...ui.materials, { id: newId("m"), description: p, quantity: "1", unitCost: "" }])}>
                      + {p}
                    </button>
                  ))}
                </div>
                <PercentPicker label="Material waste (optional)" value={ui.materialWaste} onChange={(v) => set("materialWaste", v)} presets={[0, 5, 10]} />
              </div>
              <SubTotal
                rows={[
                  ["Line items", result.otherMaterials.rawCents],
                  [`Waste (${fmtPct(n(ui.materialWaste))})`, result.otherMaterials.wasteCents],
                ]}
                total={["Total material cost", result.materialCostCents]}
                strong
              />
            </Card>

            {/* Labor */}
            <Card
              title="Labor"
              actions={
                <Segmented
                  label="Labor entry"
                  value={ui.laborMode}
                  onChange={(v) => set("laborMode", v as UiState["laborMode"])}
                  options={[
                    ["simple", "Total hours"],
                    ["phases", "By phase"],
                  ]}
                />
              }
            >
              {ui.laborMode === "simple" ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumField label="Estimated build hours" value={ui.laborHours} onChange={(v) => set("laborHours", v)} suffix="h" />
                  <NumField label="Hourly labor rate" value={ui.laborRate} onChange={(v) => set("laborRate", v)} prefix="$" suffix="/h" />
                  <div className="sm:pt-7 text-sm text-neutral-700">
                    Labor cost = {n(ui.laborHours) || 0} h × {formatCents(money(ui.laborRate))} ={" "}
                    <strong className="tabular-nums">{formatCents(result.laborCostCents, { showZeroCents: true })}</strong>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-sm">
                    <thead className="text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="py-2 pr-2 text-left font-semibold">Phase</th>
                        <th className="px-2 py-2 text-left font-semibold">Hours</th>
                        <th className="px-2 py-2 text-left font-semibold">Rate ($/h)</th>
                        <th className="px-2 py-2 text-right font-semibold">Cost</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {ui.phases.map((p) => {
                        const upd = (patch: Partial<PhaseRow>) => set("phases", ui.phases.map((r) => (r.id === p.id ? { ...r, ...patch } : r)));
                        return (
                          <tr key={p.id}>
                            <td className="py-2 pr-2">
                              <input aria-label="Phase name" className={cellInput} value={p.name} onChange={(e) => upd({ name: e.target.value })} />
                            </td>
                            <td className="px-2 py-2">
                              <input aria-label={`${p.name} hours`} inputMode="decimal" className={cn(cellInput, "w-20")} value={p.hours} onChange={(e) => upd({ hours: e.target.value })} />
                            </td>
                            <td className="px-2 py-2">
                              <input aria-label={`${p.name} hourly rate`} inputMode="decimal" className={cn(cellInput, "w-24")} value={p.rate} onChange={(e) => upd({ rate: e.target.value })} />
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatCents(Math.round(n(p.hours) * money(p.rate)), { showZeroCents: true })}</td>
                            <td className="py-2 text-right">
                              <RemoveButton label={`Remove ${p.name}`} onClick={() => set("phases", ui.phases.filter((r) => r.id !== p.id))} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <button type="button" className={adminButton.secondary} onClick={() => set("phases", [...ui.phases, { id: newId("p"), name: "", hours: "", rate: ui.laborRate }])}>
                      + Add phase
                    </button>
                    <p className="text-sm">
                      {result.laborHours} h · <strong className="tabular-nums">{formatCents(result.laborCostCents, { showZeroCents: true })}</strong>
                    </p>
                  </div>
                </div>
              )}
            </Card>

            {/* Overhead */}
            <Card
              title="Overhead"
              actions={
                <Segmented
                  label="Overhead method"
                  value={ui.overheadMethod}
                  onChange={(v) => set("overheadMethod", v as UiState["overheadMethod"])}
                  options={[
                    ["percent", "Percentage"],
                    ["allocated", "Monthly allocation"],
                  ]}
                />
              }
            >
              {ui.overheadMethod === "percent" ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumField label="Miscellaneous / overhead" value={ui.overheadPct} onChange={(v) => set("overheadPct", v)} suffix="%" />
                  <p className="text-sm text-neutral-600 sm:col-span-2 sm:pt-7">
                    {fmtPct(n(ui.overheadPct))} of materials + labor ={" "}
                    <strong className="tabular-nums text-neutral-900">{formatCents(result.overheadCostCents, { showZeroCents: true })}</strong>
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumField label="Monthly shop overhead" value={ui.monthlyOverhead} onChange={(v) => set("monthlyOverhead", v)} prefix="$" />
                  <NumField label="Expected projects per month" value={ui.projectsPerMonth} onChange={(v) => set("projectsPerMonth", v)} />
                  <p className="text-sm text-neutral-600 sm:pt-7">
                    Allocated overhead = <strong className="tabular-nums text-neutral-900">{formatCents(result.overheadCostCents, { showZeroCents: true })}</strong>
                  </p>
                </div>
              )}
            </Card>

            {/* Margin */}
            <Card title="Target profit margin" description="Margin is profit as a share of the selling price: price = cost ÷ (1 − margin). It is not the same as markup.">
              <div className="flex flex-wrap items-end gap-3">
                <NumField label="Target margin" value={ui.margin} onChange={(v) => set("margin", v)} suffix="%" className="w-36" />
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Margin presets">
                  {MARGIN_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={n(ui.margin) === m}
                      onClick={() => set("margin", String(m))}
                      className={cn(adminButton.small, n(ui.margin) === m && "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800")}
                    >
                      {m}%
                    </button>
                  ))}
                </div>
              </div>
              {result.totalCostCents > 0 && n(ui.margin) < 100 ? (
                <p className="mt-3 text-sm text-neutral-600">
                  A {fmtPct(n(ui.margin))} margin on {formatCents(result.totalCostCents)} of cost is{" "}
                  {result.methods.fullCostPriceCents != null ? formatCents(result.methods.fullCostPriceCents, { showZeroCents: true }) : "—"} — equivalent to a{" "}
                  {fmtPct(n(ui.margin) >= 100 ? null : (n(ui.margin) / (100 - n(ui.margin))) * 100)} markup on cost.
                </p>
              ) : null}
            </Card>

            <Card title="Notes">
              <TextArea label="Internal notes" name="notes" rows={4} defaultValue={estimate?.notes ?? prefill?.notes ?? ""} maxLength={5000} placeholder="Assumptions, customer requests, supplier quotes…" />
            </Card>
          </div>

          {/* ---------------------------------------------------- Results */}
          <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start" aria-label="Pricing results">
            <Results
              result={result}
              ui={ui}
              thresholds={thresholds}
              product={product}
              onPropose={(cents) => set("proposed", centsToDollarInput(cents))}
              onProposedChange={(v) => set("proposed", v)}
            />
            <div className="mt-4 rounded-md border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap gap-2">
                <SubmitButton>Save estimate</SubmitButton>
                {estimate ? (
                  estimate.quote ? (
                    <Link href={`/admin/quotes/${estimate.quote.id}`} className={adminButton.secondary}>
                      View quote {estimate.quote.reference}
                    </Link>
                  ) : (
                    <button type="button" className={adminButton.secondary} onClick={() => setDialog("convert")} disabled={dirty} title={dirty ? "Save your changes first" : undefined}>
                      Convert to quote
                    </button>
                  )
                ) : null}
                <button type="button" className={adminButton.secondary} onClick={() => setDialog("product")} disabled={!product} title={!product ? "Choose a product first" : undefined}>
                  Update product pricing
                </button>
              </div>
              <p className="mt-3 text-xs text-neutral-500">
                {estimate && dirty ? "You have unsaved changes. " : ""}
                Nothing here changes the public site unless you choose “Update product pricing”.
              </p>
            </div>
          </aside>
        </div>
      </ActionForm>

      {estimate ? (
        <ConvertDialog open={dialog === "convert"} onClose={() => setDialog(null)} estimate={estimate} priceCents={inputs.proposedPriceCents ?? result.methods.fullCostPriceCents} />
      ) : null}
      {product ? <ProductDialog open={dialog === "product"} onClose={() => setDialog(null)} product={product} result={result} proposedCents={inputs.proposedPriceCents} /> : null}
    </>
  );
}

function applyProduct(s: UiState, p: CalculatorProduct): UiState {
  const next = { ...s };
  if (p.estMaterialCostCents != null) {
    const desc = `Base materials — ${p.name}`;
    next.materials = [...s.materials.filter((m) => m.description !== desc), { id: newId("m"), description: desc, quantity: "1", unitCost: centsToDollarInput(p.estMaterialCostCents) }];
  }
  if (p.estLaborHours != null) {
    next.laborMode = "simple";
    next.laborHours = String(p.estLaborHours);
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Results panel                                                              */
/* -------------------------------------------------------------------------- */

const SEGMENTS = [
  { key: "materials", label: "Materials", color: "#8A4B22" },
  { key: "labor", label: "Labor", color: "#B0802C" },
  { key: "overhead", label: "Overhead", color: "#2F6CA3" },
  { key: "profit", label: "Profit", color: "#3E8A4E" },
] as const;

function Results({
  result,
  ui,
  thresholds,
  product,
  onPropose,
  onProposedChange,
}: {
  result: EstimateResult;
  ui: UiState;
  thresholds: EstimateThresholds;
  product: CalculatorProduct | null;
  onPropose: (cents: number) => void;
  onProposedChange: (v: string) => void;
}) {
  const { methods, analysis } = result;
  const ml = thresholds.materialsLaborPct;
  const methodCards: Array<{ title: string; cents: number | null; formula: string; note: string; primary?: boolean }> = [
    {
      title: "Materials-Based Price Check",
      cents: methods.materialsCheckCents,
      formula: `${formatCents(result.materialCostCents)} ÷ 0.30`,
      note: "A quick estimate only — can badly undercharge labor-heavy pieces.",
    },
    {
      title: `Materials + Labor ${fmtPct(ml)} Check`,
      cents: methods.fiftyCheckCents,
      formula: `(${formatCents(result.materialCostCents)} + ${formatCents(result.laborCostCents)}) ÷ ${(ml / 100).toFixed(2)}`,
      note: `Minimum price so materials + labor stay at or under ${fmtPct(ml)} of the price.`,
    },
    {
      title: "Full Cost + Margin",
      cents: methods.fullCostPriceCents,
      formula: `${formatCents(result.totalCostCents)} ÷ (1 − ${fmtPct(n(ui.margin))})`,
      note: "The most detailed method: materials, labor and overhead before margin.",
      primary: true,
    },
  ];

  const price = analysis?.priceCents ?? 0;
  const profit = analysis?.profitCents ?? 0;
  const parts = { materials: result.materialCostCents, labor: result.laborCostCents, overhead: result.overheadCostCents, profit: Math.max(0, profit) };
  const barTotal = Math.max(price, result.totalCostCents, 1);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-200 bg-white p-4">
        <h2 className="text-base font-semibold">Project cost</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Row label="Materials" cents={result.materialCostCents} />
          <Row label={`Labor (${result.laborHours} h)`} cents={result.laborCostCents} />
          <Row label="Overhead" cents={result.overheadCostCents} />
          <div className="flex justify-between border-t border-neutral-200 pt-2 font-semibold">
            <dt>Total cost</dt>
            <dd className="tabular-nums">{formatCents(result.totalCostCents, { showZeroCents: true })}</dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
        {methodCards.map((m) => (
          <div key={m.title} className={cn("rounded-md border bg-white p-4", m.primary ? "border-neutral-900" : "border-neutral-200")}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold">{m.title}</h3>
              {m.primary ? <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-white">Detailed</span> : null}
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{m.cents != null ? formatCents(m.cents, { showZeroCents: true }) : "—"}</p>
            <p className="mt-1 text-xs tabular-nums text-neutral-500">{m.formula}</p>
            <p className="mt-2 text-xs text-neutral-600">{m.note}</p>
            {m.cents ? (
              <button type="button" className={cn(adminButton.small, "mt-3")} onClick={() => onPropose(m.cents!)}>
                Use this price
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="rounded-md border border-neutral-200 bg-white p-4">
        <label htmlFor="proposed" className="block text-base font-semibold">
          Proposed selling price
        </label>
        <p className="mt-0.5 text-xs text-neutral-500">
          You choose the final price. {!analysis || analysis.source === "full-cost" ? "Until you enter one, the analysis below uses the Full Cost + Margin price." : ""}
        </p>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">$</span>
          <input id="proposed" inputMode="decimal" value={ui.proposed} onChange={(e) => onProposedChange(e.target.value)} className={cn(cellInput, "h-11 pl-7 text-base")} placeholder="e.g. 1500" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[10, 50, 100].map((step) => (
            <button
              key={step}
              type="button"
              className={adminButton.small}
              disabled={!analysis}
              onClick={() => analysis && onPropose(Math.ceil(analysis.priceCents / (step * 100)) * step * 100)}
            >
              Round up to ${step}
            </button>
          ))}
          {product?.basePriceCents ? (
            <button type="button" className={adminButton.small} onClick={() => onPropose(product.basePriceCents!)}>
              Use product base price ({formatCents(product.basePriceCents)})
            </button>
          ) : null}
        </div>

        {analysis ? (
          <>
            <dl className="mt-4 space-y-1.5 text-sm">
              <Row label="Revenue" cents={analysis.priceCents} />
              <Row label="Materials" cents={-result.materialCostCents} pctOf={analysis.materialsPct} />
              <Row label="Labor" cents={-result.laborCostCents} pctOf={analysis.laborPct} />
              <Row label="Overhead" cents={-result.overheadCostCents} pctOf={analysis.overheadPct} />
              <div className={cn("flex justify-between border-t border-neutral-200 pt-2 font-semibold", analysis.profitCents < 0 && "text-red-700")}>
                <dt>Estimated profit</dt>
                <dd className="tabular-nums">{formatCents(analysis.profitCents, { showZeroCents: true })}</dd>
              </div>
            </dl>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="Profit margin" value={fmtPct(analysis.marginPct)} />
              <Metric label="Markup on cost" value={fmtPct(analysis.markupPct)} />
              <Metric label="Materials + labor" value={fmtPct(analysis.materialsLaborPct)} warn={(analysis.materialsLaborPct ?? 0) > ml} />
            </dl>

            {/* Visual breakdown: part-to-whole of the selling price */}
            <figure className="mt-5">
              <figcaption className="mb-2 text-xs font-medium text-neutral-600">
                Where {formatCents(analysis.priceCents)} goes{analysis.profitCents < 0 ? " (costs exceed the price)" : ""}
              </figcaption>
              <div className="flex h-4 w-full overflow-hidden rounded bg-neutral-100" aria-hidden="true">
                {SEGMENTS.map((s) => {
                  const v = parts[s.key];
                  if (v <= 0) return null;
                  return <div key={s.key} className="h-full border-r-2 border-white last:border-r-0" style={{ width: `${(v / barTotal) * 100}%`, background: s.color }} title={`${s.label}: ${formatCents(v)}`} />;
                })}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {SEGMENTS.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-neutral-700">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                      {s.label}
                    </span>
                    <span className="tabular-nums text-neutral-900">{formatCents(s.key === "profit" ? profit : parts[s.key])}</span>
                  </li>
                ))}
              </ul>
            </figure>
          </>
        ) : null}

        {result.warnings.length ? (
          <ul className="mt-4 space-y-2" role="status" aria-live="polite">
            {result.warnings.map((w) => (
              <li
                key={w.message}
                className={cn(
                  "flex gap-2 rounded px-3 py-2 text-sm",
                  w.level === "danger" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900",
                )}
              >
                <span aria-hidden="true">{w.level === "danger" ? "⛔" : "⚠"}</span>
                <span>
                  <span className="sr-only">{w.level === "danger" ? "Warning: " : "Caution: "}</span>
                  {w.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-xs text-neutral-500">Warnings are advisory — you can always use any price.</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialogs                                                                    */
/* -------------------------------------------------------------------------- */

function ConvertDialog({ open, onClose, estimate, priceCents }: { open: boolean; onClose: () => void; estimate: CalculatorEstimate; priceCents: number | null }) {
  const router = useRouter();
  return (
    <Dialog open={open} onClose={onClose} title="Convert estimate into a quote">
      <ActionForm
        action={(fd) => convertEstimateToQuote(estimate.id, fd)}
        successMessage={null}
        onSuccess={(res) => {
          onClose();
          if (res.id) router.push(`/admin/quotes/${res.id}`);
        }}
      >
        <p className="mb-4 text-sm text-neutral-600">
          Creates a quote in the Quotes inbox with status <strong>Quoted</strong> at {priceCents ? <strong>{formatCents(priceCents, { showZeroCents: true })}</strong> : "the saved price"}. The cost
          breakdown is added as an internal note. Nothing is sent to the customer.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Customer name" name="name" required defaultValue={estimate.customerName ?? ""} />
          <TextInput label="Customer email" name="email" type="email" required defaultValue={estimate.customerEmail ?? ""} />
          <TextInput label="Phone" name="phone" defaultValue={estimate.customerPhone ?? ""} />
          <TextInput label="ZIP code" name="zipCode" defaultValue={estimate.customerZip ?? ""} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={adminButton.secondary} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton pendingLabel="Creating…">Create quote</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

function ProductDialog({
  open,
  onClose,
  product,
  result,
  proposedCents,
}: {
  open: boolean;
  onClose: () => void;
  product: CalculatorProduct;
  result: EstimateResult;
  proposedCents: number | null;
}) {
  const suggested = proposedCents ?? result.methods.fullCostPriceCents;
  return (
    <Dialog open={open} onClose={onClose} title={`Update pricing for ${product.name}`}>
      <ActionForm action={(fd) => updateProductPricing(product.id, fd)} onSuccess={onClose} successMessage="Product updated.">
        <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This changes the product itself. A new base price appears on the public site right away if the product is live and prices are shown.
        </p>
        <div className="space-y-4">
          <ApplyRow name="applyBasePrice" label="Base price" current={product.basePriceCents != null ? formatCents(product.basePriceCents) : "none"} defaultChecked>
            <MoneyCell name="basePrice" defaultValue={centsToDollarInput(suggested)} label="New base price" />
          </ApplyRow>
          <ApplyRow name="applyMaterials" label="Material cost estimate (internal)" current={product.estMaterialCostCents != null ? formatCents(product.estMaterialCostCents) : "none"}>
            <MoneyCell name="materialCost" defaultValue={centsToDollarInput(result.materialCostCents)} label="New material estimate" />
          </ApplyRow>
          <ApplyRow name="applyLabor" label="Typical labor hours (internal)" current={product.estLaborHours != null ? `${product.estLaborHours} h` : "none"}>
            <input aria-label="New labor hours" name="laborHours" inputMode="decimal" defaultValue={String(result.laborHours)} className={cn(cellInput, "w-28")} />
          </ApplyRow>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={adminButton.secondary} onClick={onClose}>
            Cancel
          </button>
          <SubmitButton pendingLabel="Updating…">Update product</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

function ApplyRow({ name, label, current, defaultChecked, children }: { name: string; label: string; current: string; defaultChecked?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-200 p-3">
      <label className="flex min-w-[14rem] flex-1 items-center gap-2 text-sm">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4 accent-neutral-900" />
        <span>
          <span className="font-medium">{label}</span>
          <span className="block text-xs text-neutral-500">Currently {current}</span>
        </span>
      </label>
      {children}
    </div>
  );
}

function MoneyCell({ name, defaultValue, label }: { name: string; defaultValue: string; label: string }) {
  const { fieldErrors } = useAdminForm();
  return (
    <span className="relative inline-block">
      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-neutral-500">$</span>
      <input aria-label={label} name={name} inputMode="decimal" defaultValue={defaultValue} className={cn(cellInput, "w-32 pl-5")} aria-invalid={fieldErrors[name] ? true : undefined} />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Row({ label, cents, pctOf }: { label: string; cents: number; pctOf?: number | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-600">
        {label}
        {pctOf !== undefined ? <span className="ml-1.5 text-xs text-neutral-400">{fmtPct(pctOf)}</span> : null}
      </dt>
      <dd className="tabular-nums">{formatCents(cents, { showZeroCents: true })}</dd>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn("rounded bg-neutral-50 px-2 py-2", warn && "bg-amber-50")}>
      <dt className="text-[0.68rem] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className={cn("mt-0.5 text-base font-semibold tabular-nums", warn && "text-amber-900")}>{value}</dd>
    </div>
  );
}

function SubTotal({ rows, total, strong }: { rows: Array<[string, number]>; total: [string, number]; strong?: boolean }) {
  return (
    <dl className="space-y-1 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3 text-sm">
      {rows.map(([l, c]) => (
        <div key={l} className="flex justify-between text-neutral-600">
          <dt>{l}</dt>
          <dd className="tabular-nums">{formatCents(c, { showZeroCents: true })}</dd>
        </div>
      ))}
      <div className={cn("flex justify-between pt-1 font-semibold", strong && "text-base")}>
        <dt>{total[0]}</dt>
        <dd className="tabular-nums">{formatCents(total[1], { showZeroCents: true })}</dd>
      </div>
    </dl>
  );
}

function NumField({ label, value, onChange, prefix, suffix, className }: { label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-neutral-800">
        {label}
      </label>
      <div className="relative">
        {prefix ? <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500">{prefix}</span> : null}
        <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={cn(cellInput, "h-10", prefix && "pl-7", suffix && "pr-10")} />
        {suffix ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-neutral-500">{suffix}</span> : null}
      </div>
    </div>
  );
}

function PercentPicker({ label, value, onChange, presets }: { label: string; value: string; onChange: (v: string) => void; presets: number[] }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      <div className="relative">
        <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={cn(cellInput, "w-20 pr-7")} />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-neutral-500">%</span>
      </div>
      {presets.map((p) => (
        <button key={p} type="button" aria-pressed={n(value) === p} onClick={() => onChange(String(p))} className={cn(adminButton.small, n(value) === p && "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800")}>
          {p}%
        </button>
      ))}
    </div>
  );
}

function Segmented({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-neutral-300 p-0.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn("rounded px-3 py-1.5 text-xs font-medium", value === v ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex h-9 w-9 items-center justify-center rounded text-neutral-400 hover:bg-red-50 hover:text-red-700">
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}

