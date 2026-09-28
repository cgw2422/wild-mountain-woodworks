import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { getSiteOrigin } from "@/lib/site-url";
import "./globals.css";

const cormorant = localFont({
  variable: "--font-cormorant",
  display: "swap",
  src: [
    { path: "./fonts/cormorant-garamond-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/cormorant-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const manrope = localFont({
  variable: "--font-manrope",
  display: "swap",
  src: [{ path: "./fonts/manrope-latin-wght-normal.woff2", weight: "200 800", style: "normal" }],
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getSiteOrigin()),
  title: { default: "Wild Mountain Woodworks", template: "%s | Wild Mountain Woodworks" },
  applicationName: "Wild Mountain Woodworks",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#1f1e1c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${cormorant.variable} ${manrope.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
