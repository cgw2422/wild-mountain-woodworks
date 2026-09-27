import { LOGO_DATA } from "./logo-data";

export type LogoVariant = keyof typeof LOGO_DATA;

interface LogoProps {
  variant?: LogoVariant;
  className?: string;
  /** Accessible name. Pass "" when the logo is decorative (e.g. inside a labelled link). */
  title?: string;
}

/**
 * Wild Mountain Woodworks logo system. Uses `currentColor`, so the light and
 * dark versions are simply `text-ivory` / `text-charcoal`.
 *
 * Variants: horizontal (primary), stacked (with ridge line), compact
 * (stacked without ridge, for small headers), monogram (WM maker's mark).
 */
export function Logo({ variant = "horizontal", className, title = "Wild Mountain Woodworks" }: LogoProps) {
  const data = LOGO_DATA[variant];
  return (
    <svg
      viewBox={data.viewBox}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      fill="currentColor"
    >
      {title ? <title>{title}</title> : null}
      {data.strokes.map((s, i) => (
        <path key={`s${i}`} d={s.d} fill="none" stroke="currentColor" strokeWidth={s.width} strokeLinejoin="miter" />
      ))}
      {data.fills.map((f, i) => (
        <path key={`f${i}`} d={f} />
      ))}
    </svg>
  );
}

/** Just the ridge-line mark, for subtle decorative use. */
export function RidgeLine({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 22" className={className} aria-hidden="true" focusable="false">
      <path
        d="M1 21 L25 9.5 L33 12.6 L50 1 L64 11 L72 8.2 L99 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
