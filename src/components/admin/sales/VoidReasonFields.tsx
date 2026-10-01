import { Select, TextInput } from "@/components/admin/forms";
import { VOID_REASONS } from "@/lib/sales/status";

/** Reason picker for voiding a quote or invoice (stored with who and when). */
export function VoidReasonFields() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select label="Reason" name="reason" required defaultValue="" options={[{ value: "", label: "Choose a reason…" }, ...VOID_REASONS.map((r) => ({ value: r, label: r }))]} />
      <TextInput label="Details" name="details" maxLength={280} help="Required for “Other”; optional otherwise." />
    </div>
  );
}
