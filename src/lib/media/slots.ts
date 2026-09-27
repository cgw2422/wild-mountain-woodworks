/**
 * Design locations ("slots") and their display ratios. Uploaded originals
 * are never altered — each location crops at display time using the image's
 * focal point, so any upload fits every layout without breaking it.
 */
export const IMAGE_SLOTS = {
  hero: { label: "Full-width hero", ratio: 16 / 9, mobileRatio: 4 / 5, sizes: "100vw" },
  banner: { label: "Wide banner", ratio: 21 / 9, mobileRatio: 4 / 3, sizes: "100vw" },
  feature: { label: "Editorial feature", ratio: 4 / 5, sizes: "(min-width: 1024px) 50vw, 100vw" },
  landscape: { label: "Landscape feature", ratio: 3 / 2, sizes: "(min-width: 1024px) 60vw, 100vw" },
  category: { label: "Category tile", ratio: 4 / 5, sizes: "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" },
  productCard: { label: "Product card", ratio: 4 / 5, sizes: "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" },
  productGallery: { label: "Product gallery", ratio: 4 / 3, sizes: "(min-width: 1024px) 60vw, 100vw" },
  portfolioCard: { label: "Portfolio card", ratio: 3 / 4, sizes: "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" },
  square: { label: "Square", ratio: 1, sizes: "(min-width: 1024px) 25vw, 50vw" },
  swatch: { label: "Option swatch", ratio: 1, sizes: "96px" },
  og: { label: "Social preview", ratio: 1200 / 630, sizes: "1200px" },
} as const;

export type ImageSlot = keyof typeof IMAGE_SLOTS;

export function ratioLabel(ratio: number): string {
  const known: Array<[number, string]> = [
    [16 / 9, "16:9"],
    [21 / 9, "21:9"],
    [4 / 5, "4:5"],
    [3 / 2, "3:2"],
    [4 / 3, "4:3"],
    [3 / 4, "3:4"],
    [1, "1:1"],
    [1200 / 630, "1.91:1"],
  ];
  const hit = known.find(([r]) => Math.abs(r - ratio) < 0.01);
  return hit ? hit[1] : ratio.toFixed(2);
}
