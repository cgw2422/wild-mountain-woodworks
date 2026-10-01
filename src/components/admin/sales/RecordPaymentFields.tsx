"use client";

import { useState } from "react";
import { MoneyInput, Select, TextArea, TextInput, Toggle } from "@/components/admin/forms";

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "CHECK", label: "Check" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];
const PURPOSES = [
  { value: "", label: "Automatic (deposit / final balance / partial)" },
  { value: "DEPOSIT", label: "Deposit" },
  { value: "FINAL_BALANCE", label: "Final balance" },
  { value: "PARTIAL_PAYMENT", label: "Partial payment" },
  { value: "ADDITIONAL_PAYMENT", label: "Additional payment" },
  { value: "OTHER", label: "Other" },
];

/** Fields for recording a cash / check / bank transfer / other payment (never touches Stripe). */
export function RecordPaymentFields({ defaultAmount, defaultMethod = "CASH", today, adminName, canOverpay }: { defaultAmount: string; defaultMethod?: string; today: string; adminName: string; canOverpay: boolean }) {
  const [method, setMethod] = useState(defaultMethod);
  const check = method === "CHECK";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Method" name="method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} />
        <MoneyInput label="Amount" name="amount" required defaultValue={defaultAmount} help="Defaults to the remaining balance." />
        <TextInput label="Date received" name="receivedOn" type="date" required defaultValue={today} />
        <TextInput label="Received by" name="receivedBy" defaultValue={adminName} maxLength={120} />
        {check ? (
          <>
            <TextInput label="Check number" name="reference" maxLength={120} required />
            <TextInput label="Bank / payer (optional)" name="payerName" maxLength={120} />
            <Select
              label="Check status"
              name="checkStatus"
              defaultValue="PENDING"
              options={[
                { value: "PENDING", label: "Pending — counts once marked cleared" },
                { value: "SUCCEEDED", label: "Already cleared" },
              ]}
            />
          </>
        ) : (
          <TextInput label={method === "BANK_TRANSFER" ? "Transfer reference" : "Reference (optional)"} name="reference" maxLength={120} />
        )}
        <Select label="What it's for" name="type" defaultValue="" options={PURPOSES} />
      </div>
      <TextArea label="Notes (internal — never shown to the customer)" name="notes" rows={2} maxLength={1000} />
      <Toggle label="Email the customer a receipt" name="sendReceipt" defaultChecked description={check ? "Sent when the check is cleared." : undefined} />
      {canOverpay ? <Toggle label="Allow more than the remaining balance (owner override)" name="allowOverpayment" description="Only for a genuine overpayment you plan to refund or credit. It's recorded in the audit log." /> : null}
    </div>
  );
}
