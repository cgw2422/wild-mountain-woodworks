"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, Select, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Card } from "@/components/admin/ui";
import { INPUT_TYPES } from "./input-types";

export type OptionGroupFormValues = {
  name: string;
  displayName: string;
  description: string;
  inputType: string;
  required: boolean;
  active: boolean;
};

export function OptionGroupForm({
  mode,
  values,
  action,
}: {
  mode: "create" | "edit";
  values: OptionGroupFormValues;
  action: (data: FormData) => Promise<ActionResult>;
}) {
  const [inputType, setInputType] = useState(values.inputType);
  const help = INPUT_TYPES.find((t) => t.value === inputType)?.help;
  return (
    <ActionForm
      action={action}
      successMessage={mode === "create" ? "Option group created." : "Option group saved."}
      redirectTo={mode === "create" ? (r) => `/admin/options/${r.id}` : undefined}
    >
      <Card title="Option group" description="Groups are a global library — attach them to products from each product's Options section.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Internal name"
            name="name"
            required
            defaultValue={values.name}
            maxLength={120}
            placeholder="e.g. Dining Table Size"
            help="Unique. Only admins see this — useful when two groups have the same customer-facing name."
          />
          <TextInput
            label="Display name"
            name="displayName"
            required
            defaultValue={values.displayName}
            maxLength={120}
            placeholder="e.g. Size"
            help="Shown to customers. Products can override it."
          />
          <TextArea
            label="Description"
            name="description"
            defaultValue={values.description}
            rows={2}
            maxLength={1000}
            wrapperClassName="sm:col-span-2"
            help="Optional helper text shown under the option on product pages."
          />
          <Select
            label="Display style"
            name="inputType"
            value={inputType}
            onChange={(e) => setInputType(e.target.value)}
            options={INPUT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            help={help}
          />
          <div className="grid content-start gap-4 sm:pt-7">
            <Toggle label="Required" name="required" defaultChecked={values.required} description="Customers must choose a value. Products can override this." />
            <Toggle label="Active" name="active" defaultChecked={values.active} description="Inactive groups are hidden from every product." />
          </div>
        </div>
        <details className="mt-5 rounded border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          <summary className="cursor-pointer font-medium text-neutral-800">About display styles</summary>
          <dl className="mt-3 grid gap-2">
            {INPUT_TYPES.map((t) => (
              <div key={t.value}>
                <dt className="inline font-medium">{t.label}: </dt>
                <dd className="inline">{t.help}</dd>
              </div>
            ))}
          </dl>
        </details>
        <div className="mt-5 flex justify-end">
          <SubmitButton>{mode === "create" ? "Create option group" : "Save option group"}</SubmitButton>
        </div>
      </Card>
    </ActionForm>
  );
}
