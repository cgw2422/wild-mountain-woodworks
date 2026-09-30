import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Paragraphs, RichText } from "@/components/ui/Markdown";

// Collapse the whitespace react-markdown puts between elements (browsers ignore it).
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/>\s+</g, "><").replace(/<br\/>\s+/g, "<br/>");

describe("CMS section text", () => {
  it("renders the Markdown the admin help text promises", () => {
    const out = html(
      <RichText
        className="lede"
        text={[
          "**Wild Mountain Woodworks builds handcrafted furniture in Gnadenhutten, Ohio.**",
          "Every piece is built to order.",
          "Our goal is simple:\n\n- Well made\n- Built to last",
          "*Questions?* [Get in touch](/contact) or visit [our shop](https://example.com).",
        ].join("\n\n")}
      />,
    );
    expect(out).toContain('<strong class="font-semibold">Wild Mountain Woodworks builds handcrafted furniture in Gnadenhutten, Ohio.</strong>');
    expect(out).not.toContain("**");
    expect(out).toMatch(/<ul class="list-disc[^"]*"><li>Well made<\/li><li>Built to last<\/li><\/ul>/);
    expect(out).toContain("<em>Questions?</em>");
    expect(out).toMatch(/<a class="underline[^"]*" href="\/contact">Get in touch<\/a>/);
    expect(out).toMatch(/<a href="https:\/\/example.com" rel="noopener noreferrer" target="_blank"[^>]*>our shop<\/a>/);
    expect(out.startsWith('<div class="space-y-4 lede">')).toBe(true);
  });

  it("keeps single line breaks, escapes HTML and drops images", () => {
    const out = html(<Paragraphs className="p" text={'Line one\nLine two\n\n<script>alert(1)</script>\n\n![x](/a.png)'} />);
    expect(out).toContain('<p class="p">Line one<br/>Line two</p>');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
  });

  it("renders nothing for empty text", () => {
    expect(html(<RichText text="  " />)).toBe("");
  });
});
