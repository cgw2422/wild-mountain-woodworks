/**
 * Sample catalog. Clearly demonstration content: every product, project and
 * image seeded here is flagged `isSample` and can be edited or removed from
 * admin. Descriptions avoid specific construction/material claims and mark
 * where the owner should describe their actual methods.
 */
import type { SceneOptions } from "./images";

/* ------------------------------------------------------------------ images */

export const IMAGE_SPECS: Record<string, { scene: SceneOptions; alt: string; name: string }> = {
  // Page imagery
  "hero-room": { scene: { kind: "room", wood: "walnut", base: "trestle", width: 2560, height: 1600 }, alt: "Walnut trestle dining table beneath two pendant lights", name: "sample-hero-dining-room.jpg" },
  "custom-feature": { scene: { kind: "dining-legs", wood: "oak", palette: 3, width: 1600, height: 2000 }, alt: "Oak dining table in a bright room", name: "sample-custom-feature.jpg" },
  "craft-detail": { scene: { kind: "edge", wood: "walnut", width: 2100, height: 1400 }, alt: "Close-up of a walnut tabletop edge and breadboard end", name: "sample-craft-detail.jpg" },
  "about-feature": { scene: { kind: "workshop", wood: "oak", width: 1600, height: 2000 }, alt: "Lumber and workbench in the workshop", name: "sample-about-workshop.jpg" },
  "cta-grain": { scene: { kind: "grain", wood: "darkwalnut", width: 2560, height: 1100 }, alt: "Dark walnut wood grain", name: "sample-dark-walnut-grain.jpg" },
  "cta-room": { scene: { kind: "room", wood: "oak", base: "legs", palette: 1, width: 2560, height: 1100 }, alt: "Oak dining table in a quiet room", name: "sample-oak-room.jpg" },
  "custom-hero": { scene: { kind: "room", wood: "oak", base: "x", palette: 3, width: 2560, height: 1600 }, alt: "Custom oak dining table with an X base", name: "sample-custom-hero.jpg" },
  "custom-intro": { scene: { kind: "console", wood: "maple", palette: 1, width: 1600, height: 2000 }, alt: "Maple console table", name: "sample-custom-intro.jpg" },
  "custom-possibilities": { scene: { kind: "grain", wood: "oak", width: 2100, height: 1400 }, alt: "Oak wood grain", name: "sample-oak-grain.jpg" },
  "detail-grain": { scene: { kind: "grain", wood: "walnut", width: 1600, height: 1600 }, alt: "Walnut wood grain close-up", name: "sample-walnut-grain.jpg" },
  "detail-edge": { scene: { kind: "edge", wood: "oak", width: 1600, height: 1600 }, alt: "Oak tabletop edge detail", name: "sample-oak-edge.jpg" },
  "detail-joinery": { scene: { kind: "joinery", wood: "maple", width: 1600, height: 1600 }, alt: "Maple joinery detail", name: "sample-maple-joinery.jpg" },
  "about-hero": { scene: { kind: "workshop", wood: "walnut", width: 2560, height: 1600 }, alt: "Boards leaning against the workshop wall beside a workbench", name: "sample-about-hero.jpg" },
  "about-intro": { scene: { kind: "bench", wood: "walnut", palette: 2, width: 1600, height: 2000 }, alt: "Walnut bench", name: "sample-about-intro.jpg" },
  "about-craft": { scene: { kind: "joinery", wood: "walnut", width: 2100, height: 1400 }, alt: "Walnut joinery detail", name: "sample-about-craft.jpg" },
  "workshop-1": { scene: { kind: "workshop", wood: "maple", palette: 1, width: 1500, height: 2000, seed: 11 }, alt: "Lumber in the workshop", name: "sample-workshop-lumber.jpg" },
  "workshop-2": { scene: { kind: "edge", wood: "pine", width: 1500, height: 2000 }, alt: "Pine board edge at the bench", name: "sample-workshop-bench.jpg" },

  // Products
  "ridge-1": { scene: { kind: "dining-trestle", wood: "walnut", base: "trestle", width: 1600, height: 2000 }, alt: "The Ridge Dining Table in walnut with a trestle base", name: "sample-ridge-walnut.jpg" },
  "ridge-2": { scene: { kind: "room", wood: "oak", base: "trestle", palette: 1, seed: 21 }, alt: "The Ridge Dining Table in oak", name: "sample-ridge-oak-room.jpg" },
  "ridge-3": { scene: { kind: "dining-trestle", wood: "maple", base: "x", palette: 3, seed: 5 }, alt: "The Ridge Dining Table in maple with an X base", name: "sample-ridge-maple-xbase.jpg" },
  "ridge-4": { scene: { kind: "edge", wood: "walnut", seed: 9 }, alt: "Breadboard end detail on the Ridge Dining Table", name: "sample-ridge-detail.jpg" },
  "heritage-1": { scene: { kind: "dining-legs", wood: "oak", base: "legs", palette: 1, width: 1600, height: 2000 }, alt: "The Heritage Dining Table in oak", name: "sample-heritage-oak.jpg" },
  "heritage-2": { scene: { kind: "room", wood: "darkwalnut", base: "legs", palette: 3, seed: 14 }, alt: "The Heritage Dining Table in dark walnut", name: "sample-heritage-room.jpg" },
  "heritage-3": { scene: { kind: "joinery", wood: "oak", seed: 17 }, alt: "Heritage Dining Table joinery detail", name: "sample-heritage-detail.jpg" },
  "timberline-1": { scene: { kind: "bench", wood: "oak", palette: 0, width: 1600, height: 2000 }, alt: "The Timberline Bench in oak", name: "sample-timberline-oak.jpg" },
  "timberline-2": { scene: { kind: "bench", wood: "walnut", palette: 2, seed: 8 }, alt: "The Timberline Bench in walnut", name: "sample-timberline-walnut.jpg" },
  "timberline-3": { scene: { kind: "grain", wood: "oak", seed: 31 }, alt: "Oak grain on the Timberline Bench", name: "sample-timberline-detail.jpg" },
  "summit-1": { scene: { kind: "console", wood: "walnut", palette: 3, width: 1600, height: 2000 }, alt: "The Summit Console in walnut", name: "sample-summit-walnut.jpg" },
  "summit-2": { scene: { kind: "console", wood: "oak", palette: 1, seed: 12 }, alt: "The Summit Console in oak", name: "sample-summit-oak.jpg" },
  "summit-3": { scene: { kind: "edge", wood: "walnut", seed: 22 }, alt: "Summit Console top edge", name: "sample-summit-detail.jpg" },
  "overlook-1": { scene: { kind: "coffee", wood: "oak", palette: 2, width: 1600, height: 2000 }, alt: "The Overlook Coffee Table in oak", name: "sample-overlook-oak.jpg" },
  "overlook-2": { scene: { kind: "coffee", wood: "walnut", palette: 0, seed: 19 }, alt: "The Overlook Coffee Table in walnut", name: "sample-overlook-walnut.jpg" },
  "overlook-3": { scene: { kind: "grain", wood: "maple", seed: 41 }, alt: "Maple grain detail", name: "sample-overlook-detail.jpg" },
  "ledge-1": { scene: { kind: "bench", wood: "pine", palette: 1, seed: 27, width: 1600, height: 2000 }, alt: "The Ledge Entry Bench in pine", name: "sample-ledge-pine.jpg" },

  // Portfolio
  "p-walnut-1": { scene: { kind: "room", wood: "walnut", base: "trestle", palette: 3, seed: 33 }, alt: "Walnut trestle dining table", name: "sample-portfolio-walnut-table.jpg" },
  "p-walnut-2": { scene: { kind: "dining-trestle", wood: "walnut", seed: 34, width: 1600, height: 2000 }, alt: "Walnut dining table from the front", name: "sample-portfolio-walnut-table-2.jpg" },
  "p-walnut-3": { scene: { kind: "grain", wood: "walnut", seed: 35 }, alt: "Walnut tabletop grain", name: "sample-portfolio-walnut-grain.jpg" },
  "p-console-1": { scene: { kind: "console", wood: "oak", palette: 0, seed: 36, width: 1600, height: 2000 }, alt: "Oak entry console", name: "sample-portfolio-oak-console.jpg" },
  "p-console-2": { scene: { kind: "edge", wood: "oak", seed: 37 }, alt: "Oak console edge detail", name: "sample-portfolio-oak-console-2.jpg" },
  "p-bench-1": { scene: { kind: "bench", wood: "maple", palette: 3, seed: 38 }, alt: "Maple bench", name: "sample-portfolio-maple-bench.jpg" },
  "p-bench-2": { scene: { kind: "joinery", wood: "maple", seed: 39 }, alt: "Maple bench joinery", name: "sample-portfolio-maple-bench-2.jpg" },
  "p-coffee-1": { scene: { kind: "coffee", wood: "darkwalnut", palette: 1, seed: 40, width: 1600, height: 2000 }, alt: "Dark walnut coffee table", name: "sample-portfolio-coffee-table.jpg" },
  "p-coffee-2": { scene: { kind: "grain", wood: "darkwalnut", seed: 42 }, alt: "Dark walnut finish", name: "sample-portfolio-coffee-table-2.jpg" },
  "p-farm-1": { scene: { kind: "room", wood: "pine", base: "legs", palette: 0, seed: 43 }, alt: "Pine farmhouse dining table", name: "sample-portfolio-pine-table.jpg" },
  "p-farm-2": { scene: { kind: "dining-legs", wood: "pine", seed: 44, width: 1600, height: 2000 }, alt: "Pine dining table", name: "sample-portfolio-pine-table-2.jpg" },

  // Option imagery
  "wood-pine": { scene: { kind: "finish-swatch", wood: "pine", width: 600, height: 600, seed: 51 }, alt: "Pine", name: "sample-swatch-pine.jpg" },
  "wood-oak": { scene: { kind: "finish-swatch", wood: "oak", width: 600, height: 600, seed: 52 }, alt: "Oak", name: "sample-swatch-oak.jpg" },
  "wood-maple": { scene: { kind: "finish-swatch", wood: "maple", width: 600, height: 600, seed: 53 }, alt: "Maple", name: "sample-swatch-maple.jpg" },
  "wood-walnut": { scene: { kind: "finish-swatch", wood: "walnut", width: 600, height: 600, seed: 54 }, alt: "Walnut", name: "sample-swatch-walnut.jpg" },
  "base-trestle": { scene: { kind: "dining-trestle", wood: "oak", base: "trestle", width: 900, height: 600, seed: 61 }, alt: "Trestle base", name: "sample-base-trestle.jpg" },
  "base-x": { scene: { kind: "dining-trestle", wood: "oak", base: "x", width: 900, height: 600, seed: 62 }, alt: "X base", name: "sample-base-x.jpg" },
  "base-traditional": { scene: { kind: "dining-legs", wood: "oak", base: "legs", width: 900, height: 600, seed: 63 }, alt: "Traditional legs", name: "sample-base-traditional.jpg" },
  "base-modern": { scene: { kind: "dining-legs", wood: "oak", base: "panel", width: 900, height: 600, seed: 64 }, alt: "Modern panel base", name: "sample-base-modern.jpg" },
  "addon-bench": { scene: { kind: "bench", wood: "oak", width: 900, height: 600, seed: 65 }, alt: "Matching bench", name: "sample-addon-bench.jpg" },
};

/* ----------------------------------------------------------------- options */

export interface SeedOptionGroup {
  key: string;
  name: string;
  displayName: string;
  description?: string;
  inputType: "BUTTONS" | "IMAGE" | "SWATCH" | "DROPDOWN" | "RADIO";
  required?: boolean;
  values: Array<{ name: string; displayName?: string; description?: string; price: number; image?: string; swatch?: string; isCustom?: boolean }>;
}

export const OPTION_GROUPS: SeedOptionGroup[] = [
  {
    key: "dining-size",
    name: "Dining Table Size",
    displayName: "Size",
    description: "Length × width in inches.",
    inputType: "BUTTONS",
    values: [
      { name: "60 x 36", displayName: "60 × 36", description: "Seats 4–6", price: 0 },
      { name: "72 x 36", displayName: "72 × 36", description: "Seats 6", price: 150 },
      { name: "84 x 38", displayName: "84 × 38", description: "Seats 6–8", price: 300 },
      { name: "96 x 40", displayName: "96 × 40", description: "Seats 8–10", price: 500 },
      { name: "Custom", displayName: "Custom", description: "Tell us your dimensions", price: 0, isCustom: true },
    ],
  },
  {
    key: "bench-size",
    name: "Bench Size",
    displayName: "Length",
    inputType: "BUTTONS",
    values: [
      { name: "48 in", displayName: "48″", price: 0 },
      { name: "60 in", displayName: "60″", price: 60 },
      { name: "72 in", displayName: "72″", price: 120 },
      { name: "Custom", displayName: "Custom", description: "Tell us your length", price: 0, isCustom: true },
    ],
  },
  {
    key: "console-size",
    name: "Console Size",
    displayName: "Size",
    description: "Length × depth in inches.",
    inputType: "BUTTONS",
    values: [
      { name: "48 x 14", displayName: "48 × 14", price: 0 },
      { name: "60 x 16", displayName: "60 × 16", price: 100 },
      { name: "72 x 16", displayName: "72 × 16", price: 200 },
      { name: "Custom", displayName: "Custom", price: 0, isCustom: true },
    ],
  },
  {
    key: "coffee-size",
    name: "Coffee Table Size",
    displayName: "Size",
    description: "Length × width in inches.",
    inputType: "BUTTONS",
    values: [
      { name: "42 x 24", displayName: "42 × 24", price: 0 },
      { name: "48 x 26", displayName: "48 × 26", price: 75 },
      { name: "54 x 28", displayName: "54 × 28", price: 150 },
      { name: "Custom", displayName: "Custom", price: 0, isCustom: true },
    ],
  },
  {
    key: "wood",
    name: "Wood Species",
    displayName: "Wood",
    description: "Every species has its own grain and color.",
    inputType: "IMAGE",
    values: [
      { name: "Pine", price: 0, image: "wood-pine", description: "Warm and rustic, with visible knots" },
      { name: "Oak", price: 300, image: "wood-oak", description: "Strong, open grain" },
      { name: "Maple", price: 400, image: "wood-maple", description: "Pale, smooth and fine-grained" },
      { name: "Walnut", price: 800, image: "wood-walnut", description: "Rich, dark and dramatic" },
    ],
  },
  {
    key: "finish",
    name: "Standard Finishes",
    displayName: "Finish",
    inputType: "SWATCH",
    values: [
      { name: "Natural", price: 0, swatch: "#D9BC8E" },
      { name: "Early American", price: 0, swatch: "#9A6A3E" },
      { name: "Dark Walnut", price: 0, swatch: "#4A3324" },
      { name: "Weathered Oak", price: 50, swatch: "#A39785" },
    ],
  },
  {
    key: "base",
    name: "Table Base Style",
    displayName: "Base",
    inputType: "IMAGE",
    values: [
      { name: "Trestle", price: 0, image: "base-trestle" },
      { name: "X Base", price: 100, image: "base-x" },
      { name: "Traditional", price: 0, image: "base-traditional", description: "Four legs with apron" },
      { name: "Modern", price: 150, image: "base-modern", description: "Clean panel legs" },
    ],
  },
  {
    key: "edge",
    name: "Edge Profile",
    displayName: "Edge profile",
    inputType: "RADIO",
    required: false,
    values: [
      { name: "Square", price: 0, description: "Crisp, squared edge" },
      { name: "Eased", price: 0, description: "Softly rounded edge" },
      { name: "Chamfered", price: 40, description: "Beveled edge" },
    ],
  },
  {
    key: "bench-legs",
    name: "Bench Leg Style",
    displayName: "Leg style",
    inputType: "DROPDOWN",
    values: [
      { name: "Panel", displayName: "Panel legs", price: 0 },
      { name: "Tapered", displayName: "Tapered legs", price: 40 },
      { name: "X Legs", displayName: "X legs", price: 60 },
    ],
  },
];

/*
 * Option groups that belong to the configurable "Dining Chairs" add-on (not to
 * the tables). Chair styles have no sample photos — upload real chair photos
 * in Admin → Options → Chair Style and switch it to "Image cards".
 */
export const CHAIR_OPTION_GROUPS: SeedOptionGroup[] = [
  {
    key: "chair-style",
    name: "Chair Style",
    displayName: "Choose Your Chair Style",
    inputType: "BUTTONS",
    // Full price of ONE chair (this group "sets the price per unit" on the add-on).
    values: [
      { name: "X Back", description: "Classic cross back", price: 192.5 },
      { name: "Double X Back", description: "Two crosses, a fuller back", price: 217.5 },
    ],
  },
  {
    key: "chair-wood",
    name: "Chair Wood Species",
    displayName: "Choose Wood Species",
    description: "The chairs' wood can match your table or complement it.",
    inputType: "IMAGE",
    values: [
      { name: "Pine", price: 0, image: "wood-pine" },
      { name: "Oak", price: 20, image: "wood-oak" },
      { name: "Maple", price: 25, image: "wood-maple" },
      { name: "Walnut", price: 60, image: "wood-walnut" },
    ],
  },
  {
    key: "chair-finish",
    name: "Chair Finish",
    displayName: "Chair Finish",
    description: "The finish for the chair frame.",
    inputType: "SWATCH",
    values: [
      { name: "Natural", price: 0, swatch: "#c9a878" },
      { name: "Special Walnut", price: 10, swatch: "#5b3d27" },
      { name: "Black", price: 15, swatch: "#1f1e1c" },
      { name: "Antique White", price: 15, swatch: "#ece5d6" },
    ],
  },
  {
    key: "seat-finish",
    name: "Seat Finish",
    displayName: "Seat Finish",
    description: "Finished separately from the frame.",
    inputType: "SWATCH",
    values: [
      { name: "Natural", price: 0, swatch: "#c9a878" },
      { name: "Special Walnut", price: 10, swatch: "#5b3d27" },
      { name: "Early American", price: 10, swatch: "#7a4f2c" },
      { name: "Black", price: 15, swatch: "#1f1e1c" },
    ],
  },
];

/* ------------------------------------------------------------------ add-ons */

export const ADD_ONS = [
  {
    key: "chairs",
    name: "Dining Chairs",
    displayName: "Add Dining Chairs",
    description:
      "Add matching dining chairs to complete your table set. Choose your chair style, quantity, wood species, chair finish, and seat finish to create a coordinated look that complements your table.",
    price: 192.5,
    minQuantity: 2,
    maxQuantity: 12,
    defaultQuantity: 4,
    groups: ["chair-style", "chair-wood", "chair-finish", "seat-finish"],
    /** Chair Style values are full per-chair prices; wood and finishes are adjustments. */
    unitPriceGroup: "chair-style",
  },
  { key: "bench", name: "Matching Bench", description: "A bench built to match your table's wood and finish.", price: 325, maxQuantity: 2, image: "addon-bench" },
  { key: "breadboard", name: "Breadboard Ends", description: "Classic end caps across the width of the top.", price: 150 },
  { key: "drawer", name: "Drawer", description: "A discreet drawer under the top.", price: 125, maxQuantity: 2 },
  { key: "premium-finish", name: "Premium Finish", description: "An upgraded, more durable finish.", price: 100 },
  { key: "shelf", name: "Lower Shelf", description: "A lower shelf for baskets, books or display.", price: 95, scope: "PRODUCT_SPECIFIC" as const },
  { key: "white-glove", name: "White Glove Delivery", description: "In-home placement and packaging removal. (Not yet offered — enable when available.)", price: 250, active: false },
];

/* ---------------------------------------------------------------- products */

const SAMPLE_CONSTRUCTION =
  "_Sample content — describe how this piece is actually built: top thickness, joinery, how the top is attached to allow for wood movement, and the finish you use._";

const CARE = "Dust with a soft, dry cloth. Wipe spills promptly with a damp cloth and dry immediately. Use coasters and trivets, and avoid harsh cleaners. See our [furniture care guide](/furniture-care).";
const DELIVERY = "Delivery options and timing are confirmed with your quote. See [Shipping & Delivery](/shipping-delivery).";

export interface SeedProduct {
  slug: string;
  name: string;
  sku: string;
  category: string;
  status: "ACTIVE" | "DRAFT";
  featured?: boolean;
  basePrice: number;
  short: string;
  description: string;
  dimensions: string;
  materials: string;
  leadTime: string;
  images: string[];
  groups: Array<{ key: string; defaults?: string; disable?: string[]; priceOverrides?: Record<string, number> }>;
  addOns: Array<{ key: string; price?: number }>;
}

export const PRODUCTS: SeedProduct[] = [
  {
    slug: "ridge-dining-table",
    name: "The Ridge Dining Table",
    sku: "WM-RDT",
    category: "dining-tables",
    status: "ACTIVE",
    featured: true,
    basePrice: 1295,
    short: "A generous, grounded dining table designed for everyday meals and long gatherings.",
    description:
      "The Ridge is a generously proportioned dining table with a substantial top and a base that stays out of the way of knees and chairs. It's designed to be the center of a home — for weeknight dinners, homework, holidays and everything in between.\n\nConfigure the size, wood species, finish and base style to suit your room, then request your configuration for a confirmed quote.\n\n_This is sample demonstration content. Edit it in Admin → Products._",
    dimensions: "- 60 × 36 in — seats 4–6\n- 72 × 36 in — seats 6\n- 84 × 38 in — seats 6–8\n- 96 × 40 in — seats 8–10\n- Standard height: 30 in\n- Custom sizes available",
    materials: "Available in pine, oak, maple or walnut. Each top is selected for grain and color.",
    leadTime: "Estimated 8–10 weeks",
    images: ["ridge-1", "ridge-2", "ridge-3", "ridge-4"],
    groups: [{ key: "dining-size", defaults: "72 x 36" }, { key: "wood", defaults: "Oak" }, { key: "finish", defaults: "Natural" }, { key: "base", defaults: "Trestle" }],
    addOns: [{ key: "chairs" }, { key: "bench" }, { key: "breadboard" }, { key: "drawer" }, { key: "premium-finish" }],
  },
  {
    slug: "heritage-dining-table",
    name: "The Heritage Dining Table",
    sku: "WM-HDT",
    category: "dining-tables",
    status: "ACTIVE",
    featured: true,
    basePrice: 1650,
    short: "Classic proportions and a traditional four-leg base, made to anchor a dining room.",
    description:
      "The Heritage takes its cues from traditional farmhouse and Shaker tables: a clean top, a four-leg base with apron, and proportions that feel right in both formal and casual rooms.\n\nChoose from our standard sizes or request custom dimensions.\n\n_This is sample demonstration content. Edit it in Admin → Products._",
    dimensions: "- 60 × 36 in to 96 × 40 in\n- Standard height: 30 in\n- Custom sizes available",
    materials: "Available in pine, oak, maple or walnut.",
    leadTime: "Estimated 10–12 weeks",
    images: ["heritage-1", "heritage-2", "heritage-3"],
    groups: [
      { key: "dining-size", defaults: "84 x 38" },
      { key: "wood", defaults: "Walnut" },
      { key: "finish", defaults: "Natural" },
      { key: "edge", defaults: "Eased" },
    ],
    addOns: [{ key: "chairs" }, { key: "bench" }, { key: "breadboard", price: 175 }, { key: "premium-finish" }],
  },
  {
    slug: "timberline-bench",
    name: "The Timberline Bench",
    sku: "WM-TBB",
    category: "benches",
    status: "ACTIVE",
    featured: true,
    basePrice: 425,
    short: "A simple, sturdy bench for the dining table, entryway or foot of the bed.",
    description:
      "The Timberline is a clean-lined bench that works almost anywhere: pulled up to a dining table, in an entryway, or at the foot of a bed. Choose a length to match your table.\n\n_This is sample demonstration content. Edit it in Admin → Products._",
    dimensions: "- Lengths: 48, 60 or 72 in\n- Depth: 14 in\n- Height: 18 in",
    materials: "Available in pine, oak, maple or walnut.",
    leadTime: "Estimated 4–6 weeks",
    images: ["timberline-1", "timberline-2", "timberline-3"],
    groups: [
      { key: "bench-size", defaults: "60 in" },
      { key: "wood", defaults: "Oak", priceOverrides: { Oak: 120, Maple: 160, Walnut: 300 } },
      { key: "finish", defaults: "Natural" },
      { key: "bench-legs", defaults: "Panel" },
    ],
    addOns: [{ key: "premium-finish", price: 60 }],
  },
  {
    slug: "summit-console",
    name: "The Summit Console",
    sku: "WM-SCT",
    category: "console-tables",
    status: "ACTIVE",
    featured: true,
    basePrice: 895,
    short: "A slim console for entryways, hallways and behind the sofa.",
    description:
      "The Summit is a slim, tall console with an optional lower shelf. It's sized for entryways and hallways, and for standing behind a sofa.\n\n_This is sample demonstration content. Edit it in Admin → Products._",
    dimensions: "- 48 × 14, 60 × 16 or 72 × 16 in\n- Height: 32 in\n- Custom sizes available",
    materials: "Available in oak, maple or walnut.",
    leadTime: "Estimated 6–8 weeks",
    images: ["summit-1", "summit-2", "summit-3"],
    groups: [
      { key: "console-size", defaults: "60 x 16" },
      { key: "wood", defaults: "Walnut", disable: ["Pine"], priceOverrides: { Oak: 180, Maple: 240, Walnut: 450 } },
      { key: "finish", defaults: "Natural" },
    ],
    addOns: [{ key: "shelf" }, { key: "drawer" }, { key: "premium-finish", price: 80 }],
  },
  {
    slug: "overlook-coffee-table",
    name: "The Overlook Coffee Table",
    sku: "WM-OCT",
    category: "coffee-tables",
    status: "ACTIVE",
    featured: true,
    basePrice: 725,
    short: "A low, substantial coffee table with room underneath for books and baskets.",
    description:
      "The Overlook is a low, substantial coffee table with an optional lower shelf — generous enough for books, board games and feet up at the end of the day.\n\n_This is sample demonstration content. Edit it in Admin → Products._",
    dimensions: "- 42 × 24, 48 × 26 or 54 × 28 in\n- Height: 18 in\n- Custom sizes available",
    materials: "Available in pine, oak, maple or walnut.",
    leadTime: "Estimated 6–8 weeks",
    images: ["overlook-1", "overlook-2", "overlook-3"],
    groups: [
      { key: "coffee-size", defaults: "48 x 26" },
      { key: "wood", defaults: "Oak", priceOverrides: { Oak: 200, Maple: 250, Walnut: 450 } },
      { key: "finish", defaults: "Natural" },
    ],
    addOns: [{ key: "shelf" }, { key: "drawer" }, { key: "premium-finish" }],
  },
  {
    slug: "ledge-entry-bench",
    name: "The Ledge Entry Bench",
    sku: "WM-LEB",
    category: "benches",
    status: "DRAFT",
    basePrice: 385,
    short: "A compact entry bench with a lower ledge for shoes. (Draft — not yet public.)",
    description: "A draft product used to demonstrate the publishing workflow. Draft products are never shown publicly until you publish them.",
    dimensions: "- 42 × 14 in\n- Height: 18 in",
    materials: "Available in pine, oak, maple or walnut.",
    leadTime: "Estimated 4–6 weeks",
    images: ["ledge-1"],
    groups: [{ key: "wood", defaults: "Pine", priceOverrides: { Oak: 100, Maple: 140, Walnut: 260 } }, { key: "finish", defaults: "Natural" }],
    addOns: [],
  },
];

export const PRODUCT_TEXT = { construction: SAMPLE_CONSTRUCTION, care: CARE, delivery: DELIVERY };

/* -------------------------------------------------------------- categories */

export const CATEGORIES = [
  { slug: "dining-tables", name: "Dining Tables", description: "Tables for everyday meals and long gatherings, built to your size.", image: "ridge-2", homepage: true },
  { slug: "benches", name: "Benches", description: "Benches for the table, the entryway and the foot of the bed.", image: "timberline-1", homepage: true },
  { slug: "console-tables", name: "Console Tables", description: "Slim tables for entryways, hallways and behind the sofa.", image: "summit-1", homepage: true },
  { slug: "coffee-tables", name: "Coffee Tables", description: "Low, substantial tables for the living room.", image: "overlook-1", homepage: true },
  { slug: "custom-furniture", name: "Custom Furniture", description: "Something specific in mind? We'll build it.", image: "about-feature", homepage: true, linkUrl: "/custom-furniture" },
];

/* --------------------------------------------------------------- portfolio */

export const PORTFOLIO = [
  {
    slug: "walnut-dining-table",
    name: "Walnut Trestle Dining Table",
    summary: "A long walnut trestle table sized to seat ten.",
    description:
      "_Sample project — replace with your own photographs and the story of the piece._\n\nThis walnut trestle table was sized for a long dining room and a family that gathers often. The trestle base keeps the ends clear for extra chairs.",
    furnitureType: "Dining table",
    wood: "Walnut",
    finish: "Natural",
    dimensions: "96 × 40 × 30 in",
    images: ["p-walnut-1", "p-walnut-2", "p-walnut-3"],
    featured: true,
  },
  {
    slug: "oak-entry-console",
    name: "Oak Entry Console",
    summary: "A slim oak console built for a narrow entry hall.",
    description: "_Sample project — replace with your own photographs and the story of the piece._\n\nA slim console built to fit a narrow entry hall, with a lower shelf for baskets.",
    furnitureType: "Console table",
    wood: "White oak",
    finish: "Natural",
    dimensions: "60 × 14 × 32 in",
    images: ["p-console-1", "p-console-2"],
    featured: true,
  },
  {
    slug: "maple-dining-bench",
    name: "Maple Dining Bench",
    summary: "A maple bench made to match an existing table.",
    description: "_Sample project — replace with your own photographs and the story of the piece._\n\nA bench made to match an existing maple dining table.",
    furnitureType: "Bench",
    wood: "Maple",
    finish: "Natural",
    dimensions: "72 × 14 × 18 in",
    images: ["p-bench-1", "p-bench-2"],
    featured: true,
  },
  {
    slug: "dark-walnut-coffee-table",
    name: "Dark Walnut Coffee Table",
    summary: "A low coffee table in a deep walnut finish.",
    description: "_Sample project — replace with your own photographs and the story of the piece._\n\nA low, generous coffee table finished in a deep walnut tone.",
    furnitureType: "Coffee table",
    wood: "Walnut",
    finish: "Dark Walnut",
    dimensions: "54 × 28 × 18 in",
    images: ["p-coffee-1", "p-coffee-2"],
    featured: false,
  },
  {
    slug: "pine-farmhouse-table",
    name: "Pine Farmhouse Table",
    summary: "A pine farmhouse table for a busy family kitchen.",
    description: "_Sample project — replace with your own photographs and the story of the piece._\n\nA pine farmhouse table built for a busy family kitchen.",
    furnitureType: "Dining table",
    wood: "Pine",
    finish: "Early American",
    dimensions: "84 × 38 × 30 in",
    images: ["p-farm-1", "p-farm-2"],
    featured: false,
  },
];

/* --------------------------------------------------------------------- FAQ */

export const FAQ_CATEGORIES = [
  { slug: "ordering", name: "Ordering" },
  { slug: "custom-furniture", name: "Custom Furniture" },
  { slug: "materials", name: "Materials" },
  { slug: "finishes", name: "Finishes" },
  { slug: "delivery", name: "Delivery" },
  { slug: "care", name: "Care" },
];

export const FAQS: Array<{ category: string; q: string; a: string; product?: boolean }> = [
  {
    category: "ordering",
    q: "How do I order a piece?",
    a: "Choose a piece, configure its size, wood, finish and options, then select **Request This Configuration**. We'll review your request and follow up with a confirmed quote, lead time and delivery details. Online checkout isn't available yet.",
    product: true,
  },
  {
    category: "ordering",
    q: "Is the price shown on the website final?",
    a: "Prices shown while you configure a piece are estimates. Your final price is confirmed in your written quote, which will include any custom details and delivery.",
    product: true,
  },
  {
    category: "ordering",
    q: "How long will my piece take?",
    a: "Every piece is built to order, so lead times vary by piece and by the current workshop schedule. An estimated lead time is shown on each product page and confirmed with your quote.",
    product: true,
  },
  {
    category: "custom-furniture",
    q: "Can you build something that isn't on the website?",
    a: "Yes. Tell us about the piece you have in mind on our [Custom Furniture](/custom-furniture) page — dimensions, wood, finish and any inspiration photos — and we'll follow up to talk it through.",
  },
  {
    category: "custom-furniture",
    q: "Can I change the size of a standard piece?",
    a: "In most cases, yes. Choose **Custom** in the size options when configuring a piece and describe the dimensions you need.",
    product: true,
  },
  {
    category: "materials",
    q: "Which wood species do you offer?",
    a: "Our standard options are pine, oak, maple and walnut. Other species may be available on request — just ask.",
  },
  {
    category: "materials",
    q: "Will my piece look exactly like the photos?",
    a: "Not exactly — and that's part of what makes real wood special. Grain, color, knots and mineral streaks vary from board to board. Learn more about [natural wood characteristics](/wood-characteristics).",
    product: true,
  },
  {
    category: "finishes",
    q: "Can I see a finish sample?",
    a: "Screens show color differently, so if finish color matters, ask about samples when you request your quote. **[Owner to confirm whether finish samples are available.]**",
  },
  {
    category: "delivery",
    q: "Do you deliver?",
    a: "Delivery options depend on your location and are confirmed with your quote. See [Shipping & Delivery](/shipping-delivery) for details.",
    product: true,
  },
  {
    category: "care",
    q: "How do I care for my furniture?",
    a: "Dust with a soft cloth, wipe spills promptly, use coasters and trivets, and keep the piece out of prolonged direct sunlight and away from heat sources. See our full [care guide](/furniture-care).",
  },
];
