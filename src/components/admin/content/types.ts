import type { ImageValue } from "@/components/admin/media/ImageField";

/** Serializable shapes passed from server pages to content editor clients. */

export interface SectionItemValue {
  id: string;
  eyebrow: string | null;
  title: string | null;
  body: string | null;
  image: ImageValue | null;
  linkLabel: string | null;
  linkHref: string | null;
  visible: boolean;
}

export interface SectionValue {
  key: string;
  exists: boolean;
  visible: boolean;
  eyebrow: string | null;
  heading: string | null;
  subheading: string | null;
  body: string | null;
  image: ImageValue | null;
  primaryCtaLabel: string | null;
  primaryCtaHref: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaHref: string | null;
  items: SectionItemValue[];
  updatedAt: string | null;
}

/** Selectable record for ordered pickers (featured products/projects). */
export interface PickerOption {
  id: string;
  name: string;
  detail?: string | null;
  image: { url: string; alt: string; focalX: number; focalY: number } | null;
  href?: string;
}
