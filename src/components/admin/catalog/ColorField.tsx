"use client";

import { useId, useState } from "react";
import { useAdminForm } from "../forms";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Hex swatch color: native color picker kept in sync with a text input. */
export function ColorField({ name, label, defaultValue, help }: { name: string; label: string; defaultValue?: string | null; help?: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const id = useId();
  const { fieldErrors } = useAdminForm();
  const error = fieldErrors[name];
  const valid = HEX.test(value);
  return (
    <div>
      <label htmlFor={`${id}-text`} className="mb-1.5 block text-sm font-medium text-neutral-800">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : "#8b6b4a"}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-neutral-300 bg-white p-1"
        />
        <input
          id={`${id}-text`}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
          placeholder="#6B4F36"
          maxLength={7}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          className="block h-10 w-32 rounded border border-neutral-300 bg-white px-3 font-mono text-sm text-neutral-900 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 aria-[invalid=true]:border-red-500"
        />
        {value ? (
          <button type="button" onClick={() => setValue("")} className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100">
            Clear
          </button>
        ) : null}
      </div>
      <p id={`${id}-help`} className="mt-1 text-xs text-neutral-500">
        {help ?? "Hex color like #6B4F36."}
      </p>
      {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  );
}
