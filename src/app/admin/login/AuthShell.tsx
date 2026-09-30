import { Logo } from "@/components/brand/Logo";

/** Shared frame for the sign-in, two-factor and enrolment screens. */
export function AuthShell({ title, intro, children, wide }: { title: string; intro?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-charcoal px-5 py-16">
      <div className={wide ? "w-full max-w-lg" : "w-full max-w-sm"}>
        <Logo variant="stacked" className="mx-auto mb-10 w-56 text-ivory [--logo-accent:var(--color-bronze-light)]" />
        <div className="bg-ivory p-8 shadow-sm">
          <h1 className="font-display text-2xl">{title}</h1>
          {intro ? <div className="mt-1 text-sm text-muted">{intro}</div> : null}
          {children}
        </div>
      </div>
    </main>
  );
}

export const authInput = "h-11 w-full border border-stone-dark/60 bg-white px-3 text-base outline-none focus:border-charcoal";
export const authButton =
  "h-12 w-full bg-charcoal text-xs font-semibold uppercase tracking-[0.16em] text-ivory transition hover:bg-walnut disabled:opacity-60";
