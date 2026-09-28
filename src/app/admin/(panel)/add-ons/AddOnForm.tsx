"use client";

import type { ActionResult } from "@/lib/admin/types";
import { ActionForm, MoneyInput, Select, SubmitButton, TextArea, TextInput, Toggle } from "@/components/admin/forms";
import { Card } from "@/components/admin/ui";
import { ImageField, type ImageValue } from "@/components/admin/media/ImageField";

export type AddOnFormValues = {
  name: string;
  description: string;
  price: string;
  image: ImageValue | null;
  scope: string;
  required: boolean;
  minQuantity: string;
  maxQuantity: string;
  active: boolean;
};

export function AddOnForm({ mode, values, action }: { mode: "create" | "edit"; values: AddOnFormValues; action: (data: FormData) => Promise<ActionResult> }) {
  return (
    <ActionForm
      action={action}
      successMessage={mode === "create" ? "Add-on created." : "Add-on saved."}
      redirectTo={mode === "create" ? (r) => `/admin/add-ons/${r.id}` : undefined}
      className="grid gap-6"
    >
      <Card title="Add-on">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name" name="name" required defaultValue={values.name} maxLength={120} placeholder="e.g. Matching Bench" wrapperClassName="sm:col-span-2" />
          <TextArea label="Description" name="description" defaultValue={values.description} rows={3} maxLength={1000} wrapperClassName="sm:col-span-2" help="Shown to customers under the add-on name." />
          <MoneyInput label="Price" name="price" defaultValue={values.price} placeholder="0" help="Per unit. Products can override the price." />
          <Select
            label="Scope"
            name="scope"
            defaultValue={values.scope}
            options={[
              { value: "REUSABLE", label: "Reusable — offered on many products" },
              { value: "PRODUCT_SPECIFIC", label: "Product-specific — made for one product" },
            ]}
            help="Scope is for organization only; either kind can be assigned to any product."
          />
        </div>
      </Card>
      <Card title="Image" description="Optional.">
        <ImageField name="imageId" label="Add-on image" slot="square" value={values.image} compact />
      </Card>
      <Card title="Rules" description="Products can override these.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Minimum quantity" name="minQuantity" type="number" min={0} max={100} defaultValue={values.minQuantity} help="0 = optional." />
          <TextInput label="Maximum quantity" name="maxQuantity" type="number" min={1} max={100} defaultValue={values.maxQuantity} help="1 = a simple yes/no add-on." />
          <Toggle label="Required" name="required" defaultChecked={values.required} description="Customers must include at least one." />
          <Toggle label="Active" name="active" defaultChecked={values.active} description="Inactive add-ons are hidden on every product." />
        </div>
      </Card>
      <div className="flex justify-end">
        <SubmitButton>{mode === "create" ? "Create add-on" : "Save add-on"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
