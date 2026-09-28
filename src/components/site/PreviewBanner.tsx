import Link from "next/link";

export function PreviewBanner({ status, editHref, liveHref }: { status: string; editHref: string; liveHref?: string | null }) {
  return (
    <div className="sticky top-0 z-50 bg-bronze-text text-ivory" role="status">
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm sm:px-8 lg:px-12">
        <p>
          <strong className="font-semibold">Preview</strong> — status: {status.toLowerCase()}. Only signed-in admins can see this page.
        </p>
        <div className="flex gap-5">
          {liveHref ? (
            <Link href={liveHref} className="underline underline-offset-2">
              View live
            </Link>
          ) : null}
          <Link href={editHref} className="underline underline-offset-2">
            Back to editor
          </Link>
        </div>
      </div>
    </div>
  );
}
