"use client";

import { useState } from "react";
import { Select, TextInput } from "@/components/admin/forms";

type Option = { value: string; label: string; help: string };

/**
 * Production stage + "Send email notification". The checkbox defaults on
 * when the stage changes to one customers hear about, and can be unticked
 * for special circumstances. Delivery details appear for scheduling.
 */
export function OrderStatusFields({
  current,
  options,
  notifyStatuses,
  delivery,
  deliveryMethods,
  canceled,
}: {
  current: string;
  options: Option[];
  notifyStatuses: string[];
  delivery: { date: string; window: string; method: string };
  deliveryMethods: Array<{ value: string; label: string }>;
  canceled: boolean;
}) {
  const [status, setStatus] = useState(current);
  const changed = status !== current;
  const emails = notifyStatuses.includes(status);
  const [notify, setNotify] = useState(true);
  const help = options.find((o) => o.value === status)?.help;
  const scheduling = status === "DELIVERY_SCHEDULED" || status === "READY_FOR_DELIVERY" || Boolean(delivery.date);
  return (
    <div className="space-y-4">
      <Select
        label="Production status"
        name="productionStatus"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setNotify(true);
        }}
        options={(canceled ? options.filter((o) => o.value === "CANCELED") : options).map((o) => ({ value: o.value, label: o.label }))}
        help={help}
      />
      {changed && emails ? (
        <label className="flex items-start gap-3 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <input type="checkbox" name="notifyCustomer" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-4 w-4 accent-neutral-900" />
          <span>
            <span className="font-medium text-neutral-900">Send email notification</span>
            <span className="block text-neutral-600">{notify ? "The customer is emailed about this change with a link to their order." : "No email will be sent for this change."}</span>
          </span>
        </label>
      ) : null}
      {changed && !emails ? <p className="text-sm text-neutral-600">Customers aren&apos;t emailed for this stage.</p> : null}
      {scheduling ? (
        <div className="grid gap-4 rounded border border-neutral-200 p-4 md:grid-cols-3">
          <TextInput label="Delivery / pickup date" name="deliveryDate" type="date" defaultValue={delivery.date} required={status === "DELIVERY_SCHEDULED"} />
          <TextInput label="Time window (optional)" name="deliveryWindow" defaultValue={delivery.window} maxLength={60} placeholder="e.g. 9am–12pm" />
          <Select label="Method" name="deliveryMethod" defaultValue={delivery.method} options={[{ value: "", label: "Choose…" }, ...deliveryMethods]} />
        </div>
      ) : (
        <>
          <input type="hidden" name="deliveryDate" value={delivery.date} />
          <input type="hidden" name="deliveryWindow" value={delivery.window} />
          <input type="hidden" name="deliveryMethod" value={delivery.method} />
        </>
      )}
    </div>
  );
}
