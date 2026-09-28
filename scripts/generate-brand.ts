/**
 * Generates the Wild Mountain Woodworks logo system from the brand fonts.
 *
 * Text is converted to outlined SVG paths so every lockup renders identically
 * everywhere (browser, favicon, social cards, future engraving/branding-iron
 * maker's mark) without depending on installed fonts.
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
const sans = font("@fontsource/manrope/files/manrope-latin-600-normal.woff");

const CHARCOAL = "#1F1E1C";
const IVORY = "#F7F3EC";

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
  strokes: Array<{ d: string; width: number }>;
};

// --- Horizontal: WILD MOUNTAIN | WOODWORKS -------------------------------
function horizontal(): Lockup {
  const primary = textPath(serif, "WILD MOUNTAIN", 100, 0.06);
  const primaryH = primary.box.y2 - primary.box.y1;
  const secondary = textPath(sans, "WOODWORKS", 30, 0.34);
  const secH = secondary.box.y2 - secondary.box.y1;
  translate(primary.path, -primary.box.x1, -primary.box.y1);
  const gap = 34;
  const ruleX = primary.box.x2 - primary.box.x1 + gap;
  const secX = ruleX + gap;
  translate(secondary.path, secX - secondary.box.x1, (primaryH - secH) / 2 - secondary.box.y1);
  const width = secX + (secondary.box.x2 - secondary.box.x1);
  const pad = 2;
  return {
    viewBox: `${-pad} ${-pad} ${(width + pad * 2).toFixed(2)} ${(primaryH + pad * 2).toFixed(2)}`,
    width: width + pad * 2,
    height: primaryH + pad * 2,
    fills: [d(primary.path), d(secondary.path)],
    strokes: [{ d: `M${ruleX.toFixed(2)} ${(primaryH * 0.08).toFixed(2)} L${ruleX.toFixed(2)} ${(primaryH * 0.92).toFixed(2)}`, width: 2 }],
  };
}

// --- Stacked / compact ----------------------------------------------------
function stacked(withRidge: boolean): Lockup {
  const primary = textPath(serif, "WILD MOUNTAIN", 100, 0.06);
  const pW = primary.box.x2 - primary.box.x1;
  const pH = primary.box.y2 - primary.box.y1;
  const secondary = textPath(sans, "WOODWORKS", 27, 0.42);
  const sW = secondary.box.x2 - secondary.box.x1;
  const sH = secondary.box.y2 - secondary.box.y1;

  let y = 0;
  const strokes: Lockup["strokes"] = [];
  if (withRidge) {
    const r = ridge(pW * 0.2);
    const rx = (pW - pW * 0.2) / 2;
    strokes.push({ d: offsetPath(r.d, rx, 0), width: 2.4 });
    y += r.height + 30;
  }
  translate(primary.path, -primary.box.x1, y - primary.box.y1);
  y += pH + 26;
  const sx = (pW - sW) / 2;
  translate(secondary.path, sx - secondary.box.x1, y - secondary.box.y1);
  // Hairlines either side of WOODWORKS
  const lineY = y + sH / 2;
  const ruleGap = 26;
  strokes.push({ d: `M0 ${lineY.toFixed(2)} L${(sx - ruleGap).toFixed(2)} ${lineY.toFixed(2)}`, width: 1.6 });
  strokes.push({ d: `M${(sx + sW + ruleGap).toFixed(2)} ${lineY.toFixed(2)} L${pW.toFixed(2)} ${lineY.toFixed(2)}`, width: 1.6 });
  y += sH;
  const pad = 3;
  return {
    viewBox: `${-pad} ${-pad} ${(pW + pad * 2).toFixed(2)} ${(y + pad * 2).toFixed(2)}`,
    width: pW + pad * 2,
    height: y + pad * 2,
    fills: [d(primary.path), d(secondary.path)],
    strokes,
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
  return { viewBox: `0 0 ${size} ${size}`, width: size, height: size, fills: [d(wm.path)], strokes };
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

function toSvg(l: Lockup, color: string, title: string) {
  const strokes = l.strokes.map((s) => `<path d="${s.d}" fill="none" stroke="${color}" stroke-width="${s.width}" stroke-linejoin="miter"/>`).join("");
  const fills = l.fills.map((f) => `<path d="${f}" fill="${color}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${l.viewBox}" role="img" aria-label="${title}"><title>${title}</title>${strokes}${fills}</svg>\n`;
}

const lockups = {
  horizontal: horizontal(),
  stacked: stacked(true),
  compact: stacked(false),
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
  writeFileSync(path.join(outDir, `wild-mountain-${name}-dark.svg`), toSvg(l, CHARCOAL, title));
  writeFileSync(path.join(outDir, `wild-mountain-${name}-light.svg`), toSvg(l, IVORY, title));
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
  const stackedLight = toSvg(lockups.stacked, IVORY, title).replace("<svg ", `<svg width="640" `);
  const card = await sharp({ create: { width: 1200, height: 630, channels: 4, background: CHARCOAL } })
    .composite([{ input: await sharp(Buffer.from(stackedLight)).png().toBuffer(), gravity: "center" }])
    .png()
    .toBuffer();
  writeFileSync(path.join(outDir, "wild-mountain-social-card.png"), card);
  for (const [name, l] of Object.entries(lockups)) {
    for (const [tone, color] of [["dark", CHARCOAL], ["light", IVORY]] as const) {
      const svg = toSvg(l, color, title).replace("<svg ", `<svg width="${name === "monogram" ? 1024 : 2400}" `);
      await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, `wild-mountain-${name}-${tone}.png`));
    }
  }
}

rasterize().then(() => console.log("Brand assets generated."));
