import clsx, { type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about the project's custom font-size token so it is
// never mistaken for a text color.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["eyebrow"] } },
});

/** Join class names; later Tailwind utilities override conflicting earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
