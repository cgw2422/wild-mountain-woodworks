/**
 * Generates placeholder "studio" imagery for sample content.
 *
 * These are NOT meant to represent real Wild Mountain work. They exist so the
 * site can be evaluated end-to-end before real photography is uploaded. Every
 * one is stored as an ordinary Media item and can be replaced in
 * Admin → Media (Replace) or reassigned anywhere it is used.
 */
import sharp from "sharp";

export type Wood = "pine" | "oak" | "maple" | "walnut" | "darkwalnut";
export type SceneKind =
  | "dining-trestle"
  | "dining-legs"
  | "bench"
  | "console"
  | "coffee"
  | "room"
  | "workshop"
  | "grain"
  | "edge"
  | "finish-swatch"
  | "joinery";

const WOODS: Record<Wood, { base: string; light: string; dark: string }> = {
  pine: { base: "#d7b487", light: "#e6c9a1", dark: "#a8804f" },
  oak: { base: "#b98d5f", light: "#cfa679", dark: "#8a6440" },
  maple: { base: "#e2c69b", light: "#eed9b8", dark: "#bf9f70" },
  walnut: { base: "#6e4b33", light: "#8a6245", dark: "#452c1d" },
  darkwalnut: { base: "#4d3424", light: "#654532", dark: "#2e1e14" },
};

const PALETTES = [
  { wall: ["#efe8dc", "#e2d8c8"], floor: ["#d9cdb9", "#c9bba4"] },
  { wall: ["#e9e3d9", "#d8cfc1"], floor: ["#cdbfa9", "#b9a88f"] },
  { wall: ["#f1ece4", "#e6ded1"], floor: ["#8f7a63", "#76624d"] },
  { wall: ["#dcd6cc", "#cbc3b6"], floor: ["#e2d9ca", "#d4c8b5"] },
];

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
}

/** Wood-grain filter: horizontally stretched fractal noise tinted to the species. */
function grainFilter(id: string, wood: Wood, seed: number, vertical = false) {
  const [r, g, b] = hexToRgb(WOODS[wood].dark);
  const freq = vertical ? "0.09 0.0025" : "0.0025 0.09";
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4" seed="${seed}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 ${r.toFixed(3)}  0 0 0 0 ${g.toFixed(3)}  0 0 0 0 ${b.toFixed(3)}  0 0 0 -1.6 1.25" result="tint"/>
    <feComposite in="tint" in2="SourceGraphic" operator="in" result="grain"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="grain"/></feMerge>
  </filter>`;
}

function woodRect(x: number, y: number, w: number, h: number, wood: Wood, filterId: string, extra = "") {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${WOODS[wood].base}" filter="url(#${filterId})" ${extra}/>`;
}

function studio(W: number, H: number, horizon: number, palette: (typeof PALETTES)[number], seed: number) {
  return `
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.wall[0]}"/><stop offset="1" stop-color="${palette.wall[1]}"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.floor[0]}"/><stop offset="1" stop-color="${palette.floor[1]}"/></linearGradient>
    <radialGradient id="light" cx="0.22" cy="0.1" r="0.9"><stop offset="0" stop-color="#fffaf0" stop-opacity="0.55"/><stop offset="0.6" stop-color="#fffaf0" stop-opacity="0"/></radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="${W * 0.012}"/></filter>
    <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}"/><feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0.06 0"/></filter>
  </defs>
  <rect width="${W}" height="${horizon}" fill="url(#wall)"/>
  <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#floor)"/>
  <rect y="${horizon - 2}" width="${W}" height="3" fill="#000" opacity="0.06"/>`;
}

function overlays(W: number, H: number) {
  return `<rect width="${W}" height="${H}" fill="url(#light)"/><rect width="${W}" height="${H}" filter="url(#paper)"/><rect width="${W}" height="${H}" fill="url(#vignette)"/>`;
}

function shadow(cx: number, cy: number, rx: number, ry: number, opacity = 0.28) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#2a2018" opacity="${opacity}" filter="url(#soft)"/>`;
}

/** A table/bench seen slightly from above: visible top plane + front apron + legs. */
function table(opts: {
  W: number;
  cx: number;
  floorY: number;
  width: number;
  height: number;
  topThickness: number;
  depthPx: number;
  wood: Wood;
  base: "trestle" | "legs" | "x" | "shelf" | "panel";
  legW: number;
}) {
  const { cx, floorY, width, height, topThickness: t, depthPx: d, wood, base, legW } = opts;
  const x0 = cx - width / 2;
  const topY = floorY - height;
  const c = WOODS[wood];
  let parts = "";
  parts += shadow(cx, floorY + 4, width * 0.52, d * 0.35 + 10, 0.32);
  const inset = width * 0.07;
  if (base === "trestle") {
    const lx = [x0 + inset, x0 + width - inset - legW];
    for (const x of lx) {
      parts += woodRect(x, topY + t, legW, height - t - legW * 0.5, wood, "gv");
      parts += woodRect(x - legW * 1.2, floorY - legW * 0.6, legW * 3.4, legW * 0.6, wood, "g1");
      parts += woodRect(x - legW * 0.8, topY + t, legW * 2.6, legW * 0.55, wood, "g1");
    }
    parts += woodRect(lx[0]! + legW, floorY - height * 0.42, lx[1]! - lx[0]! - legW, legW * 0.6, wood, "g1");
  } else if (base === "x") {
    const lx = [x0 + inset, x0 + width - inset];
    for (const x of lx) {
      const h = height - t;
      parts += `<path d="M${x - legW * 1.6} ${floorY} L${x + legW * 1.6} ${topY + t} L${x + legW * 2.6} ${topY + t} L${x - legW * 0.6} ${floorY} Z" fill="${c.base}" filter="url(#gv)"/>`;
      parts += `<path d="M${x + legW * 1.6} ${floorY} L${x - legW * 1.6} ${topY + t} L${x - legW * 0.6} ${topY + t} L${x + legW * 2.6} ${floorY} Z" fill="${c.dark}" opacity="0.92"/>`;
      void h;
    }
    parts += woodRect(lx[0]!, floorY - height * 0.45, lx[1]! - lx[0]!, legW * 0.55, wood, "g1");
  } else if (base === "panel") {
    for (const x of [x0 + inset * 0.5, x0 + width - inset * 0.5 - legW * 1.8]) {
      parts += woodRect(x, topY + t, legW * 1.8, height - t, wood, "gv");
    }
  } else {
    // legs (optionally with a lower shelf)
    const legs = [x0 + inset * 0.6, x0 + width - inset * 0.6 - legW];
    const back = [x0 + inset * 0.6 + d * 0.35, x0 + width - inset * 0.6 - legW - d * 0.35];
    for (const x of back) parts += `<rect x="${x}" y="${topY + t}" width="${legW * 0.9}" height="${height - t - d * 0.25}" fill="${c.dark}"/>`;
    if (base === "shelf") {
      parts += woodRect(x0 + inset * 0.6, floorY - height * 0.28, width - inset * 1.2, t * 0.7, wood, "g1");
    }
    for (const x of legs) parts += woodRect(x, topY + t, legW, height - t, wood, "gv");
    parts += woodRect(x0 + inset * 0.6, topY + t, width - inset * 1.2, t * 0.9, wood, "g1", `opacity="0.9"`);
  }
  // Top: visible top plane (lighter) + front edge
  parts += `<path d="M${x0 + d * 0.5} ${topY - d} L${x0 + width - d * 0.5} ${topY - d} L${x0 + width} ${topY} L${x0} ${topY} Z" fill="${c.light}" filter="url(#g2)"/>`;
  parts += woodRect(x0, topY, width, t, wood, "g1");
  parts += `<rect x="${x0}" y="${topY}" width="${width}" height="${Math.max(2, t * 0.08)}" fill="#fff" opacity="0.18"/>`;
  return parts;
}

export interface SceneOptions {
  kind: SceneKind;
  wood: Wood;
  width?: number;
  height?: number;
  seed?: number;
  palette?: number;
  base?: "trestle" | "legs" | "x" | "shelf" | "panel";
}

export function sceneSvg(o: SceneOptions): string {
  const W = o.width ?? 2400;
  const H = o.height ?? 1600;
  const seed = o.seed ?? 7;
  const palette = PALETTES[(o.palette ?? 0) % PALETTES.length]!;
  const defs = `<defs>${grainFilter("g1", o.wood, seed)}${grainFilter("g2", o.wood, seed + 3)}${grainFilter("gv", o.wood, seed + 5, true)}</defs>`;
  const s = Math.min(W, H * 1.5) / 2400; // scale factor
  let body = "";

  switch (o.kind) {
    case "grain": {
      body = `${defs}${woodRect(0, 0, W, H, o.wood, "g1")}<rect width="${W}" height="${H}" fill="url(#light)"/>`;
      return wrap(W, H, `<defs><radialGradient id="light" cx="0.3" cy="0.2" r="1"><stop offset="0" stop-color="#fff8ea" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0.15"/></radialGradient></defs>${body}`);
    }
    case "finish-swatch": {
      return wrap(W, H, `${defs}${woodRect(0, 0, W, H, o.wood, "g1")}<rect width="${W}" height="${H}" fill="#fff" opacity="0.06"/>`);
    }
    case "edge": {
      const c = WOODS[o.wood];
      body = `${defs}<rect width="${W}" height="${H}" fill="#e8e0d3"/>
        ${woodRect(0, H * 0.18, W * 0.78, H * 0.5, o.wood, "g1")}
        ${woodRect(W * 0.78, H * 0.18, W * 0.1, H * 0.5, o.wood, "gv")}
        <rect x="${W * 0.78}" y="${H * 0.18}" width="3" height="${H * 0.5}" fill="${c.dark}" opacity="0.7"/>
        <rect x="0" y="${H * 0.68}" width="${W * 0.88}" height="${H * 0.1}" fill="${c.dark}"/>
        <rect x="0" y="${H * 0.18}" width="${W * 0.88}" height="4" fill="#fff" opacity="0.35"/>
        <rect y="${H * 0.78}" width="${W}" height="${H * 0.22}" fill="#d5cab8"/>`;
      return wrap(W, H, body);
    }
    case "joinery": {
      const c = WOODS[o.wood];
      body = `${defs}<rect width="${W}" height="${H}" fill="#e6ddcf"/>
        ${woodRect(W * 0.1, H * 0.3, W * 0.8, H * 0.22, o.wood, "g1")}
        ${woodRect(W * 0.42, H * 0.52, W * 0.16, H * 0.48, o.wood, "gv")}
        <rect x="${W * 0.47}" y="${H * 0.33}" width="${W * 0.06}" height="${H * 0.16}" fill="${c.dark}" opacity="0.55"/>
        <rect x="${W * 0.1}" y="${H * 0.52}" width="${W * 0.8}" height="${H * 0.02}" fill="#000" opacity="0.12"/>`;
      return wrap(W, H, body);
    }
    case "workshop": {
      const horizon = H * 0.72;
      body = studio(W, H, horizon, PALETTES[2]!, seed) + defs;
      // Leaning boards
      const woods: Wood[] = ["walnut", "oak", "maple", "pine", "walnut", "oak"];
      woods.forEach((w, i) => {
        const bx = W * 0.08 + i * W * 0.06;
        body += `<g transform="rotate(${-4 + i * 1.3} ${bx} ${horizon})">${woodRect(bx, H * 0.12 + (i % 3) * 30 * s, W * 0.045, horizon - H * 0.12 - (i % 3) * 30 * s, w, "gv")}</g>`;
      });
      // Workbench
      body += table({ W, cx: W * 0.66, floorY: H * 0.9, width: W * 0.52, height: H * 0.36, topThickness: 70 * s, depthPx: 60 * s, wood: "oak", base: "shelf", legW: 60 * s });
      // Clamps / tools, abstract
      body += `<rect x="${W * 0.5}" y="${H * 0.46}" width="${W * 0.12}" height="${14 * s}" fill="#3a3530"/><rect x="${W * 0.52}" y="${H * 0.46 - 50 * s}" width="${10 * s}" height="${60 * s}" fill="#3a3530"/>`;
      body += overlays(W, H);
      return wrap(W, H, body);
    }
    case "room": {
      const horizon = H * 0.64;
      body = studio(W, H, horizon, palette, seed) + defs;
      // window light on wall
      body += `<g opacity="0.35"><rect x="${W * 0.12}" y="${H * 0.1}" width="${W * 0.16}" height="${H * 0.38}" fill="#fffaf0"/><rect x="${W * 0.3}" y="${H * 0.1}" width="${W * 0.16}" height="${H * 0.38}" fill="#fffaf0"/></g>`;
      // pendant lights
      for (const px of [0.47, 0.6]) {
        body += `<line x1="${W * px}" y1="0" x2="${W * px}" y2="${H * 0.26}" stroke="#2b2926" stroke-width="${3 * s}"/><path d="M${W * px - 60 * s} ${H * 0.3} Q${W * px} ${H * 0.23} ${W * px + 60 * s} ${H * 0.3} Z" fill="#2b2926"/>`;
      }
      body += table({ W, cx: W * 0.54, floorY: H * 0.9, width: W * 0.56, height: H * 0.3, topThickness: 50 * s, depthPx: 90 * s, wood: o.wood, base: o.base ?? "trestle", legW: 48 * s });
      body += overlays(W, H);
      return wrap(W, H, body);
    }
    default: {
      const horizon = H * (o.kind === "bench" || o.kind === "coffee" ? 0.6 : 0.62);
      body = studio(W, H, horizon, palette, seed) + defs;
      const portrait = H > W;
      const base = o.base ?? (o.kind === "dining-trestle" ? "trestle" : o.kind === "console" ? "shelf" : o.kind === "coffee" ? "shelf" : o.kind === "bench" ? "panel" : "legs");
      const dims = {
        "dining-trestle": { w: 0.74, h: 0.34, t: 46, d: 110 },
        "dining-legs": { w: 0.72, h: 0.34, t: 44, d: 110 },
        bench: { w: 0.7, h: 0.2, t: 44, d: 60 },
        console: { w: 0.5, h: 0.42, t: 36, d: 50 },
        coffee: { w: 0.6, h: 0.18, t: 44, d: 120 },
      }[o.kind as "dining-trestle" | "dining-legs" | "bench" | "console" | "coffee"];
      const width = W * dims.w * (portrait ? 1.15 : 1);
      body += table({
        W,
        cx: W * 0.5,
        floorY: H * (portrait ? 0.78 : 0.86),
        width,
        height: H * dims.h * (portrait ? 0.8 : 1),
        topThickness: dims.t * s,
        depthPx: dims.d * s,
        wood: o.wood,
        base,
        legW: (o.kind === "console" ? 34 : 44) * s,
      });
      body += overlays(W, H);
      return wrap(W, H, body);
    }
  }
}

function wrap(W: number, H: number, inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
}

export async function renderScene(o: SceneOptions): Promise<Buffer> {
  return sharp(Buffer.from(sceneSvg(o))).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}
