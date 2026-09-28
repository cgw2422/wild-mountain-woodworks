"use client";

import { CountedField } from "./CountedField";
import { SEO_DESCRIPTION_MAX, SEO_DESCRIPTION_RECOMMENDED, SEO_TITLE_MAX, SEO_TITLE_RECOMMENDED } from "./validation";

/** SEO title + meta description with length counters. */
export function SeoFields({
  title,
  description,
  titlePlaceholder,
  descriptionPlaceholder,
  titleName = "seoTitle",
  descriptionName = "seoDescription",
}: {
  title: string | null;
  description: string | null;
  titlePlaceholder?: string;
  descriptionPlaceholder?: string;
  titleName?: string;
  descriptionName?: string;
}) {
  return (
    <div className="space-y-4">
      <CountedField
        label="SEO title"
        name={titleName}
        defaultValue={title}
        recommended={SEO_TITLE_RECOMMENDED}
        maxLength={SEO_TITLE_MAX}
        placeholder={titlePlaceholder}
        help="Shown as the headline in search results and the browser tab. Leave blank to use the default."
      />
      <CountedField
        label="SEO description"
        name={descriptionName}
        defaultValue={description}
        recommended={SEO_DESCRIPTION_RECOMMENDED}
        maxLength={SEO_DESCRIPTION_MAX}
        placeholder={descriptionPlaceholder}
        multiline
        help="One or two sentences shown under the title in search results."
      />
    </div>
  );
}
