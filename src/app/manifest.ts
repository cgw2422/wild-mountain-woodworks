import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wild Mountain Woodworks",
    short_name: "Wild Mountain Woodworks",
    description: "Handcrafted furniture built one piece at a time in Ohio.",
    start_url: "/",
    display: "browser",
    background_color: "#f7f3ec",
    theme_color: "#1f1e1c",
    icons: [
      { src: "/brand/wild-mountain-sitemark-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/wild-mountain-sitemark-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
