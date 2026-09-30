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

/**
 * Admin-authored section text (CMS "body" fields). Supports the Markdown the
 * admin help text promises — **bold**, *italic*, [links](/contact), bullet
 * and numbered lists — while inheriting the surrounding size and colour, so
 * it drops into any layout. Paragraphs are separated by a blank line; a
 * single line break is kept as a line break.
 */
export function Paragraphs({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text?.trim()) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaksLite]}
      components={{
        p: ({ children }) => <p className={className}>{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        a: ({ href = "", children }) =>
          href.startsWith("/") ? (
            <Link href={href} className="underline decoration-1 underline-offset-[3px]">
              {children}
            </Link>
          ) : (
            <a href={href} rel="noopener noreferrer" target={href.startsWith("http") ? "_blank" : undefined} className="underline decoration-1 underline-offset-[3px]">
              {children}
            </a>
          ),
        ul: ({ children }) => <ul className={cn("list-disc space-y-1.5 pl-5", className)}>{children}</ul>,
        ol: ({ children }) => <ol className={cn("list-decimal space-y-1.5 pl-5", className)}>{children}</ol>,
        // Section headings come from the heading field; keep body headings as emphasis.
        h1: ({ children }) => <p className={cn("font-semibold", className)}>{children}</p>,
        h2: ({ children }) => <p className={cn("font-semibold", className)}>{children}</p>,
        h3: ({ children }) => <p className={cn("font-semibold", className)}>{children}</p>,
        h4: ({ children }) => <p className={cn("font-semibold", className)}>{children}</p>,
        img: () => null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/**
 * Section text in its own wrapper, for spots that used to render a single
 * <p>. The wrapper carries the layout/typography classes; paragraphs and
 * lists inside are spaced evenly.
 */
export function RichText({ text, className, as: Tag = "div" }: { text: string | null | undefined; className?: string; as?: "div" | "dd" }) {
  if (!text?.trim()) return null;
  return (
    <Tag className={cn("space-y-4", className)}>
      <Paragraphs text={text} />
    </Tag>
  );
}

/** Treat single newlines inside a paragraph as line breaks (like the old plain-text rendering). */
function remarkBreaksLite() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "text" && typeof child.value === "string" && child.value.includes("\n")) {
          return child.value.split("\n").flatMap((part, i) => (i === 0 ? [{ type: "text", value: part }] : [{ type: "break" }, { type: "text", value: part }]));
        }
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}
type MdNode = { type: string; value?: string; children?: MdNode[] };
