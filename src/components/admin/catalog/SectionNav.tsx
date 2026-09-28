/** In-page anchor navigation for long editor pages. */
export function SectionNav({ sections, label = "Sections" }: { sections: Array<{ id: string; label: string }>; label?: string }) {
  return (
    <nav aria-label={label} className="rounded-md border border-neutral-200 bg-white p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-sm lg:flex-col lg:gap-1">
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="rounded text-neutral-700 hover:text-neutral-950 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900">
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
