import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Renders admin-authored Markdown. Raw HTML is NOT rendered (react-markdown
 * escapes it by default), so content can't inject scripts.
 */
export function Markdown({ children, className, dark }: { children: string | null | undefined; className?: string; dark?: boolean }) {
  if (!children?.trim()) return null;
  return (
    <div className={cn("prose-wm", dark && "prose-on-dark", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href = "", children }) =>
            href.startsWith("/") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href} rel="noopener noreferrer" target={href.startsWith("http") ? "_blank" : undefined}>
                {children}
              </a>
            ),
          img: () => null,
          h1: ({ children }) => <h2>{children}</h2>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Split plain multi-paragraph text on blank lines. */
export function Paragraphs({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text?.trim()) return null;
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className={className}>
            {p}
          </p>
        ))}
    </>
  );
}
