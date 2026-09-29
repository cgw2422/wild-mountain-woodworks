/**
 * Generates the Wild Mountain Woodworks logo system from the brand fonts.
 *
 * Text is converted to outlined SVG paths so every lockup renders identically
 * everywhere (browser, favicon, social cards, future engraving/branding-iron
 * maker's mark) without depending on installed fonts.
 *
 * The horizontal and stacked lockups come from the supplied artwork
 * (public/brand/WMW-horizonal.svg, WMW-stacked.svg; compact is the stacked
 * lettering without the mountain): transforms are flattened into plain path
 * data, the brown mark and rules become "accent" paths and the lettering
 * follows the text colour.
 *
 * Outputs:
 *   src/components/brand/logo-data.ts   path data for the <Logo/> component
 *   public/brand/*.svg                  standalone light & dark versions
 *   src/app/icon.svg, src/app/apple-icon.png, public/brand/*.png
 *
 * Run: npm run brand
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";

const root = process.cwd();
const font = (p: string) => {
  const buf = readFileSync(path.join(root, "node_modules", p));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const serif = font("@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff");

const CHARCOAL = "#1F1E1C";
const IVORY = "#F7F3EC";
/** Brown of the supplied artwork, and a lighter bronze for dark backgrounds. */
const ACCENT = "#7F582D";
const ACCENT_ON_DARK = "#C3A67A";

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Command properties may be accessors, so copy them explicitly.
function copyCommand(c: opentype.PathCommand): opentype.PathCommand {
  const src = c as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { type: src.type };
  for (const k of ["x", "y", "x1", "y1", "x2", "y2"]) if (typeof src[k] === "number") out[k] = src[k];
  return out as unknown as opentype.PathCommand;
}

/** Lay out text glyph by glyph with explicit tracking (in em). */
function textPath(f: opentype.Font, text: string, size: number, tracking: number, x = 0, baseline = 0) {
  const scale = size / f.unitsPerEm;
  const out = new opentype.Path();
  let cursor = x;
  const glyphs = f.stringToGlyphs(text);
  glyphs.forEach((g, i) => {
    const p = g.getPath(cursor, baseline, size);
    out.commands.push(...p.commands.map(copyCommand));
    let adv = (g.advanceWidth ?? 0) * scale;
    if (i < glyphs.length - 1) adv += f.getKerningValue(g, glyphs[i + 1]!) * scale;
    cursor += adv + (i < glyphs.length - 1 ? tracking * size : 0);
  });
  const bb = out.getBoundingBox();
  return { path: out, box: { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 } as Box, advance: cursor - x };
}

// Note: opentype.js can share command objects between commands, so always
// write translated copies rather than mutating in place.
function translate(p: opentype.Path, dx: number, dy: number) {
  p.commands = p.commands.map((c) => {
    const cmd = copyCommand(c) as unknown as Record<string, number | string>;
    for (const k of ["x", "x1", "x2"]) if (typeof cmd[k] === "number") cmd[k] = (cmd[k] as number) + dx;
    for (const k of ["y", "y1", "y2"]) if (typeof cmd[k] === "number") cmd[k] = (cmd[k] as number) + dy;
    return cmd as unknown as opentype.PathCommand;
  });
}

/** Serialize commands to SVG path data (opentype's toPathData transforms coordinates). */
function d(p: opentype.Path) {
  const n = (v: unknown) => {
    const num = Number(v);
    if (!Number.isFinite(num)) throw new Error("Non-finite coordinate in glyph path");
    return String(Math.round(num * 100) / 100);
  };
  return p.commands
    .map((c) => {
      const k = c as unknown as Record<string, unknown>;
      switch (k.type) {
        case "M":
        case "L":
          return `${k.type}${n(k.x)} ${n(k.y)}`;
        case "Q":
          return `Q${n(k.x1)} ${n(k.y1)} ${n(k.x)} ${n(k.y)}`;
        case "C":
          return `C${n(k.x1)} ${n(k.y1)} ${n(k.x2)} ${n(k.y2)} ${n(k.x)} ${n(k.y)}`;
        case "Z":
          return "Z";
        default:
          return "";
      }
    })
    .join("");
}

/** The ridge line: a single, restrained mountain silhouette stroke. */
function ridge(width: number) {
  const pts: Array<[number, number]> = [
    [0, 1],
    [0.25, 0.42],
    [0.33, 0.58],
    [0.5, 0],
    [0.64, 0.5],
    [0.72, 0.36],
    [1, 1],
  ];
  const h = width * 0.2;
  return { d: "M" + pts.map(([x, y]) => `${(x * width).toFixed(2)} ${(y * h).toFixed(2)}`).join(" L"), height: h };
}

type Lockup = {
  viewBox: string;
  width: number;
  height: number;
  fills: string[];
  /** Paths drawn in the accent colour (brand brown). */
  accents: string[];
  strokes: Array<{ d: string; width: number }>;
};

// --- Supplied artwork --------------------------------------------------------
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function parseTransform(t: string | undefined): Matrix {
  if (!t) return IDENTITY;
  let m = IDENTITY;
  for (const [, fn, args] of t.matchAll(/(matrix|translate|scale)\(([^)]*)\)/g)) {
    const a = args!.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === "matrix") m = multiply(m, a as Matrix);
    else if (fn === "translate") m = multiply(m, [1, 0, 0, 1, a[0]!, a[1] ?? 0]);
    else m = multiply(m, [a[0]!, 0, 0, a[1] ?? a[0]!, 0, 0]);
  }
  return m;
}

const emptyBox = (): Box => ({ x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });

/** Apply a matrix to absolute M/L/C/Z path data (all the artwork uses). */
function transformPath(pathD: string, m: Matrix, box: Box): string {
  const r = (v: number) => String(Math.round(v * 100) / 100);
  return [...pathD.matchAll(/([MLCZ])([^MLCZ]*)/gi)]
    .map(([, cmd, args]) => {
      if (!/[MLCZ]/.test(cmd!)) throw new Error(`Unsupported path command "${cmd}" in logo artwork`);
      const nums = args!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const pts: string[] = [];
      for (let i = 0; i < nums.length; i += 2) {
        const x = m[0] * nums[i]! + m[2] * nums[i + 1]! + m[4];
        const y = m[1] * nums[i]! + m[3] * nums[i + 1]! + m[5];
        box.x1 = Math.min(box.x1, x);
        box.y1 = Math.min(box.y1, y);
        box.x2 = Math.max(box.x2, x);
        box.y2 = Math.max(box.y2, y);
        pts.push(`${r(x)} ${r(y)}`);
      }
      return cmd! + pts.join(" ");
    })
    .join("");
}

/**
 * Import supplied logo artwork. With `withoutMark`, paths that sit entirely
 * above the dark lettering (the mountain) are left out.
 */
function artworkLockup(file: string, { withoutMark = false } = {}): Lockup {
  const svg = readFileSync(path.join(root, file), "utf8").replace(/<defs>[\s\S]*?<\/defs>/, "");
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  // Transforms and fills are inherited from enclosing groups.
  const stack: Array<{ m: Matrix; fill?: string }> = [{ m: IDENTITY }];
  const items: Array<{ d: string; accent: boolean; box: Box }> = [];
  const add = (pathD: string, m: Matrix, color: string) => {
    const box = emptyBox();
    items.push({ d: transformPath(pathD, m, box), accent: color === ACCENT, box });
  };
  for (const [tag] of svg.matchAll(/<\/?(?:g|path)\b[^>]*>/g)) {
    if (tag.startsWith("</")) {
      stack.pop();
      continue;
    }
    const parent = stack.at(-1)!;
    const m = multiply(parent.m, parseTransform(attr(tag, "transform")));
    const fill = attr(tag, "fill")?.toUpperCase() ?? parent.fill;
    if (tag.startsWith("<g")) {
      if (!tag.endsWith("/>")) stack.push({ m, fill });
      continue;
    }
    const pathD = attr(tag, "d");
    if (!pathD) continue;
    const stroke = attr(tag, "stroke")?.toUpperCase();
    if (stroke && stroke !== "NONE") {
      // Straight stroked lines (dividers, rules) become filled rectangles.
      const nums = pathD.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
      if (!/^\s*M[^MLCZ]*L[^MLCZ]*$/i.test(pathD) || nums.length !== 4) throw new Error("Only straight stroked lines are supported in logo artwork");
      const [x1, y1, x2, y2] = nums as [number, number, number, number];
      const half = (Number(attr(tag, "stroke-width") ?? 1) / 2) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const p = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const [a, b] = [p(x1, y1), p(x2, y2)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const [nx, ny] = [(-(b[1] - a[1]) / len) * half, ((b[0] - a[0]) / len) * half];
      add(`M${a[0] + nx} ${a[1] + ny}L${b[0] + nx} ${b[1] + ny}L${b[0] - nx} ${b[1] - ny}L${a[0] - nx} ${a[1] - ny}Z`, IDENTITY, stroke);
    }
    if (fill && fill !== "NONE") add(pathD, m, fill);
  }
  let kept = items;
  if (withoutMark) {
    const textTop = Math.min(...items.filter((i) => !i.accent).map((i) => i.box.y1));
    kept = items.filter((i) => i.box.y2 > textTop);
  }
  const box = kept.reduce((b, i) => ({ x1: Math.min(b.x1, i.box.x1), y1: Math.min(b.y1, i.box.y1), x2: Math.max(b.x2, i.box.x2), y2: Math.max(b.y2, i.box.y2) }), emptyBox());
  // Re-origin at the top-left of the artwork with a little padding.
  const pad = 1;
  const shift = (p: string) => offsetPath(p, -box.x1, -box.y1);
  const w = box.x2 - box.x1;
  const h = box.y2 - box.y1;
  return {
    viewBox: `${-pad} ${-pad} ${(w + pad * 2).toFixed(2)} ${(h + pad * 2).toFixed(2)}`,
    width: w + pad * 2,
    height: h + pad * 2,
    fills: kept.filter((i) => !i.accent).map((i) => shift(i.d)),
    accents: kept.filter((i) => i.accent).map((i) => shift(i.d)),
    strokes: [],
  };
}

function offsetPath(pathD: string, dx: number, dy: number) {
  return pathD.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${(Number(x) + dx).toFixed(2)} ${(Number(y) + dy).toFixed(2)}`);
}

// --- Monogram / maker's mark -----------------------------------------------
function monogram(): Lockup {
  const size = 200;
  const c = size / 2;
  const wm = textPath(serif, "WM", 78, 0.02);
  const w = wm.box.x2 - wm.box.x1;
  const h = wm.box.y2 - wm.box.y1;
  translate(wm.path, c - w / 2 - wm.box.x1, c + 14 - h / 2 - wm.box.y1);
  const r = ridge(64);
  const strokes = [
    { d: `M${c} ${c - 92} A92 92 0 1 1 ${c - 0.01} ${c - 92}`, width: 3 },
    { d: offsetPath(r.d, c - 32, c - 58), width: 3 },
  ];
  return { viewBox: `0 0 ${size} ${size}`, width: size, height: size, fills: [d(wm.path)], accents: [], strokes };
}

// --- Site mark (favicon): WM on a solid tile --------------------------------
function siteMarkSvg(bg: string, fg: string) {
  // Favicon-scale mark: the WM monogram alone, large enough to read at 16px.
  const size = 64;
  const wm = textPath(serif, "WM", 40, 0.0);
  const w = wm.box.x2 - wm.box.x1;
  const h = wm.box.y2 - wm.box.y1;
  translate(wm.path, size / 2 - w / 2 - wm.box.x1, size / 2 - h / 2 - wm.box.y1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="6" fill="${bg}"/><path d="${d(wm.path)}" fill="${fg}"/></svg>`;
}

function toSvg(l: Lockup, color: string, accent: string, title: string) {
  const strokes = l.strokes.map((s) => `<path d="${s.d}" fill="none" stroke="${color}" stroke-width="${s.width}" stroke-linejoin="miter"/>`).join("");
  const fills = l.fills.map((f) => `<path d="${f}" fill="${color}"/>`).join("");
  const accents = l.accents.map((f) => `<path d="${f}" fill="${accent}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${l.viewBox}" role="img" aria-label="${title}"><title>${title}</title>${strokes}${accents}${fills}</svg>\n`;
}

const lockups = {
  horizontal: artworkLockup("public/brand/WMW-horizonal.svg"),
  stacked: artworkLockup("public/brand/WMW-stacked.svg"),
  compact: artworkLockup("public/brand/WMW-stacked.svg", { withoutMark: true }),
  monogram: monogram(),
};

// Component data
const ts = `// Generated by scripts/generate-brand.ts — do not edit by hand.\nexport const LOGO_DATA = ${JSON.stringify(lockups, null, 0)} as const;\n`;
writeFileSync(path.join(root, "src/components/brand/logo-data.ts"), ts);

// Standalone SVG assets
const outDir = path.join(root, "public/brand");
mkdirSync(outDir, { recursive: true });
const title = "Wild Mountain Woodworks";
for (const [name, l] of Object.entries(lockups)) {
  writeFileSync(path.join(outDir, `wild-mountain-${name}-dark.svg`), toSvg(l, CHARCOAL, ACCENT, title));
  writeFileSync(path.join(outDir, `wild-mountain-${name}-light.svg`), toSvg(l, IVORY, ACCENT_ON_DARK, title));
}
const markDark = siteMarkSvg(CHARCOAL, IVORY);
const markLight = siteMarkSvg(IVORY, CHARCOAL);
writeFileSync(path.join(outDir, "wild-mountain-sitemark-dark.svg"), markDark);
writeFileSync(path.join(outDir, "wild-mountain-sitemark-light.svg"), markLight);
writeFileSync(path.join(root, "src/app/icon.svg"), markDark);

async function rasterize() {
  await sharp(Buffer.from(markDark)).resize(180, 180).png().toFile(path.join(root, "src/app/apple-icon.png"));
  await sharp(Buffer.from(markDark)).resize(512, 512).png().toFile(path.join(outDir, "wild-mountain-sitemark-512.png"));
  await sharp(Buffer.from(markDark)).resize(192, 192).png().toFile(path.join(outDir, "wild-mountain-sitemark-192.png"));
  // A generic brand social card used only until an OG image is set in admin.
  const stackedLight = toSvg(lockups.stacked, IVORY, ACCENT_ON_DARK, title).replace("<svg ", `<svg width="640" `);
  const card = await sharp({ create: { width: 1200, height: 630, channels: 4, background: CHARCOAL } })
    .composite([{ input: await sharp(Buffer.from(stackedLight)).png().toBuffer(), gravity: "center" }])
    .png()
    .toBuffer();
  writeFileSync(path.join(outDir, "wild-mountain-social-card.png"), card);
  for (const [name, l] of Object.entries(lockups)) {
    for (const [tone, color, accent] of [["dark", CHARCOAL, ACCENT], ["light", IVORY, ACCENT_ON_DARK]] as const) {
      const svg = toSvg(l, color, accent, title).replace("<svg ", `<svg width="${name === "monogram" ? 1024 : 2400}" `);
      await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `wild-mountain-${name}-${tone}.png`));
    }
  }
}

rasterize().then(() => console.log("Brand assets generated."));
