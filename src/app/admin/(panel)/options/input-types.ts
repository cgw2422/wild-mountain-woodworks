/** Customer-facing presentation of an option group (client-safe). */
export const INPUT_TYPES = [
  { value: "BUTTONS", label: "Buttons", help: "Text buttons side by side. Best for short choices like sizes." },
  { value: "IMAGE", label: "Image tiles", help: "Each value shows its image — e.g. wood species or base styles. Give every value an image." },
  { value: "SWATCH", label: "Color swatches", help: "Each value shows a round color swatch — e.g. finishes. Set a swatch color (or image) for every value." },
  { value: "DROPDOWN", label: "Dropdown", help: "A compact select menu. Good for long lists." },
  { value: "RADIO", label: "Radio list", help: "A vertical list with descriptions. Good when each choice needs explaining." },
] as const;

export type InputTypeValue = (typeof INPUT_TYPES)[number]["value"];

export function inputTypeLabel(v: string) {
  return INPUT_TYPES.find((t) => t.value === v)?.label ?? v;
}
