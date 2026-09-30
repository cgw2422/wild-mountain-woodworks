"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton, TextInput, Toggle } from "@/components/admin/forms";
import { Card } from "@/components/admin/ui";
import type { ActionResult } from "@/lib/admin/types";
import { ANNOUNCEMENT_PRESETS, contrastRatio, isHexColor, MIN_ANNOUNCEMENT_CONTRAST, safeLinkUrl } from "@/lib/promotions/announcement";
import { AnnouncementBar } from "@/components/site/AnnouncementBar";

type Values = {
  name: string;
  enabled: boolean;
  message: string;
  secondaryText: string;
  linkText: string;
  linkUrl: string;
  backgroundColor: string;
  textColor: string;
  startsAt: string;
  endsAt: string;
  showEndDate: boolean;
  dismissible: boolean;
  showOnDesktop: boolean;
  showOnMobile: boolean;
};

function endsLabel(endsAt: string) {
  if (!endsAt) return null;
  const [date, time] = endsAt.split("T");
  const [y, m, d] = date!.split("-").map(Number);
  // Ending at midnight means the previous day was the last one.
  const last = time === "00:00" ? new Date(Date.UTC(y!, m! - 1, d! - 1)) : new Date(Date.UTC(y!, m! - 1, d!));
  return `Ends ${last.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}`;
}

export function AnnouncementForm({ action, initial, timeZoneLabel }: { action: (fd: FormData) => Promise<ActionResult>; initial: Values; timeZoneLabel: string }) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((prev) => ({ ...prev, [k]: value }));
  const ratio = contrastRatio(v.backgroundColor, v.textColor);
  const lowContrast = isHexColor(v.backgroundColor) && isHexColor(v.textColor) && ratio < MIN_ANNOUNCEMENT_CONTRAST;
  const link = v.linkUrl ? safeLinkUrl(v.linkUrl) : null;

  return (
    <ActionForm action={action} className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Card title="Preview" description="How the bar looks above the site header (dates and visibility aren't simulated here).">
        <div className="overflow-hidden rounded border border-neutral-200 bg-ivory">
          {v.message.trim() ? (
            <AnnouncementBar
              preview
              announcement={{
                key: "preview",
                message: v.message,
                secondaryText: v.secondaryText.trim() || null,
                linkText: v.linkText.trim() || null,
                linkUrl: link,
                backgroundColor: isHexColor(v.backgroundColor) ? v.backgroundColor : "#1f1e1c",
                textColor: isHexColor(v.textColor) ? v.textColor : "#f7f3ec",
                endsLabel: v.showEndDate ? endsLabel(v.endsAt) : null,
                dismissible: v.dismissible,
                showOnDesktop: true,
                showOnMobile: true,
              }}
            />
          ) : (
            <p className="p-3 text-sm text-neutral-500">Enter a message to preview the bar.</p>
          )}
          <div className="h-10 border-t border-stone/60" aria-hidden="true" />
        </div>
      </Card>

      <Card title="Message">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput name="name" label="Internal name" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} help="Only shown in admin." />
          <div className="md:pt-7">
            <Toggle label="Enabled" name="enabled" checked={v.enabled} onChange={(c) => set("enabled", c)} description="Shows on the site while within the dates below." />
          </div>
          <TextInput
            name="message"
            label="Message"
            value={v.message}
            onChange={(e) => set("message", e.target.value)}
            required
            maxLength={140}
            placeholder="Fall Sale — Up to 30% Off Select Furniture"
            wrapperClassName="md:col-span-2"
          />
          <TextInput
            name="secondaryText"
            label="Secondary text"
            value={v.secondaryText}
            onChange={(e) => set("secondaryText", e.target.value)}
            maxLength={120}
            placeholder="Optional, e.g. Built to order in Ohio"
            wrapperClassName="md:col-span-2"
          />
          <TextInput name="linkText" label="Link text" value={v.linkText} onChange={(e) => set("linkText", e.target.value)} maxLength={40} placeholder="Optional, e.g. Shop the sale" />
          <TextInput
            name="linkUrl"
            label="Link URL"
            value={v.linkUrl}
            onChange={(e) => set("linkUrl", e.target.value)}
            maxLength={500}
            placeholder="/furniture/sale"
            help="Optional. When set, the whole bar is a link. A page on this site (/furniture/sale) or a full https:// address."
          />
        </div>
      </Card>

      <Card title="Colors" description="Defaults to Mountain Charcoal with Warm Ivory text.">
        <div className="flex flex-wrap gap-2">
          {ANNOUNCEMENT_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setV((prev) => ({ ...prev, backgroundColor: p.background, textColor: p.text }))}
              className="inline-flex items-center gap-2 rounded border border-neutral-300 px-2.5 py-1.5 text-xs hover:bg-neutral-50"
              aria-pressed={v.backgroundColor === p.background && v.textColor === p.text}
            >
              <span className="h-4 w-4 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: p.background }} aria-hidden="true" />
              {p.name}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ColorField name="backgroundColor" label="Background color" value={v.backgroundColor} onChange={(c) => set("backgroundColor", c)} />
          <ColorField name="textColor" label="Text color" value={v.textColor} onChange={(c) => set("textColor", c)} />
        </div>
        {lowContrast ? (
          <p className="mt-3 text-sm text-red-700">
            Contrast is {ratio.toFixed(1)}:1 — at least {MIN_ANNOUNCEMENT_CONTRAST}:1 is needed for small text to be readable. Try a preset.
          </p>
        ) : null}
      </Card>

      <Card title="Schedule & display">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput
            name="startsAt"
            label="Start"
            type="datetime-local"
            value={v.startsAt}
            onChange={(e) => set("startsAt", e.target.value)}
            help={`Optional (${timeZoneLabel} time). Blank = as soon as it's enabled.`}
          />
          <TextInput
            name="endsAt"
            label="End"
            type="datetime-local"
            value={v.endsAt}
            onChange={(e) => set("endsAt", e.target.value)}
            help="Optional. The bar hides itself automatically at this time."
          />
          <Toggle label="Show the end date" name="showEndDate" checked={v.showEndDate} onChange={(c) => set("showEndDate", c)} description="Adds “· Ends October 6” when an end is set." />
          <Toggle
            label="Visitors can close it"
            name="dismissible"
            checked={v.dismissible}
            onChange={(c) => set("dismissible", c)}
            description="Closing is remembered for this promotion. Changing the message or link, or a new announcement, shows it again."
          />
          <Toggle label="Show on desktop" name="showOnDesktop" checked={v.showOnDesktop} onChange={(c) => set("showOnDesktop", c)} />
          <Toggle label="Show on mobile" name="showOnMobile" checked={v.showOnMobile} onChange={(c) => set("showOnMobile", c)} />
        </div>
      </Card>

      <div>
        <SubmitButton pendingLabel="Saving…">Save announcement</SubmitButton>
      </div>
    </ActionForm>
  );
}

function ColorField({ name, label, value, onChange }: { name: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} name={name}>
      {(a) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${label} picker`}
            value={isHexColor(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-12 cursor-pointer rounded border border-neutral-300 bg-white p-1"
          />
          <input
            {...a}
            name={name}
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            maxLength={7}
            spellCheck={false}
            className="h-10 w-28 rounded border border-neutral-300 px-2 font-mono text-sm uppercase"
          />
        </div>
      )}
    </Field>
  );
}
