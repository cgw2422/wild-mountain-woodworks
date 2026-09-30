/**
 * Render an email template into subject/HTML/text. Pure: every placeholder
 * value is HTML-escaped, and the template body itself is escaped too (it is
 * admin-edited text, never trusted HTML).
 */

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type TemplateVars = Record<string, string | number | null | undefined>;

/** Replace {{name}} placeholders; unknown/empty placeholders become "". */
export function fill(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

/** Tidy text after filling: trim lines, collapse 3+ newlines, drop empty bullets. */
function tidy(text: string) {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => !/^-\s*[^:]*:\s*$/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => l.startsWith("- "))) {
        return `<ul style="margin:0 0 16px;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 4px">${escapeHtml(l.slice(2))}</li>`).join("")}</ul>`;
      }
      return `<p style="margin:0 0 16px">${lines.map(escapeHtml).join("<br/>")}</p>`;
    })
    .join("");
}

export interface RenderInput {
  subject: string;
  heading: string;
  body: string;
  buttonLabel?: string | null;
  actionUrl?: string | null;
  vars: TemplateVars;
  brand: { businessName: string; logoUrl: string; siteUrl: string; footer?: string | null };
}

export function renderEmail(t: RenderInput): { subject: string; html: string; text: string } {
  const subject = fill(t.subject, t.vars).replace(/\s+/g, " ").trim().slice(0, 200);
  const heading = fill(t.heading, t.vars).trim();
  const body = tidy(fill(t.body, t.vars));
  const button = t.buttonLabel && t.actionUrl ? { label: fill(t.buttonLabel, t.vars), url: t.actionUrl } : null;
  const safeUrl = button && /^https?:\/\//.test(button.url) ? button.url : null;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f4efe6;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#26231f;font-size:15px;line-height:1.6">
<div style="max-width:580px;margin:0 auto">
<div style="text-align:center;padding:8px 0 20px"><a href="${escapeHtml(t.brand.siteUrl)}"><img src="${escapeHtml(t.brand.logoUrl)}" alt="${escapeHtml(t.brand.businessName)}" width="220" style="max-width:220px;height:auto;border:0"></a></div>
<div style="background:#fffdf9;border:1px solid #e3dacb;padding:32px 28px">
<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:26px;line-height:1.25;margin:0 0 20px;color:#26231f">${escapeHtml(heading)}</h1>
${bodyHtml(body)}
${safeUrl ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(safeUrl)}" style="display:inline-block;background:#26231f;color:#fbf7f0;text-decoration:none;padding:13px 26px;font-size:14px;letter-spacing:.06em">${escapeHtml(button!.label)}</a></p><p style="margin:12px 0 0;font-size:12px;color:#7b7266">Or copy this link: ${escapeHtml(safeUrl)}</p>` : ""}
</div>
<p style="text-align:center;font-size:12px;color:#7b7266;margin:18px 0 0">${escapeHtml(t.brand.footer || t.brand.businessName)}</p>
</div></body></html>`;

  const text = [heading, "", body, ...(safeUrl ? ["", `${button!.label}: ${safeUrl}`] : [])].join("\n");
  return { subject, html, text };
}
