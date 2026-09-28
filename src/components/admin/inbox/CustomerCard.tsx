import { Card, DescriptionList } from "@/components/admin/ui";

/** Preserves customer line breaks; long words wrap instead of overflowing. */
export function LongText({ text }: { text: string }) {
  return <span className="block whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>;
}

export function CustomerCard({
  name,
  email,
  phone,
  zipCode,
  mailto,
  title = "Customer",
}: {
  name: string;
  email: string;
  phone?: string | null;
  zipCode?: string | null;
  mailto?: string;
  title?: string;
}) {
  const tel = phone ? phone.replace(/[^\d+]/g, "") : "";
  return (
    <Card title={title}>
      <DescriptionList
        className="sm:grid-cols-[5rem_1fr]"
        items={[
          { label: "Name", value: name },
          {
            label: "Email",
            value: (
              <a href={mailto ?? `mailto:${email}`} className="text-neutral-900 underline underline-offset-2 hover:text-neutral-600">
                {email}
              </a>
            ),
          },
          {
            label: "Phone",
            value: phone ? (
              <a href={`tel:${tel}`} className="text-neutral-900 underline underline-offset-2 hover:text-neutral-600">
                {phone}
              </a>
            ) : null,
          },
          ...(zipCode !== undefined ? [{ label: "ZIP", value: zipCode }] : []),
        ]}
      />
    </Card>
  );
}
