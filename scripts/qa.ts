/**
 * Automated site QA against a running server.
 *
 *   QA_BASE_URL=http://localhost:3000 npm run qa
 *   QA_SCREENSHOTS=./qa-shots npm run qa      # also save screenshots
 *   QA_ADMIN_COOKIE="wm_admin_session=…"      # also check admin pages
 *
 * Crawls public pages (starting from a seed list + discovered links) and,
 * at desktop / laptop / tablet / phone widths, checks:
 *   - HTTP status, console errors and uncaught exceptions
 *   - horizontal overflow
 *   - broken images (not loaded / zero size)
 *   - internal links that don't resolve
 *   - interactive elements smaller than 24×24 px on phones
 * Exits non-zero if anything fails.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const BASE = (process.env.QA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.env.QA_SCREENSHOTS;
const ADMIN_COOKIE = process.env.QA_ADMIN_COOKIE;
const WIDTHS = [1440, 1024, 768, 390];

const SEED_PATHS = [
  "/",
  "/furniture",
  "/our-work",
  "/custom-furniture",
  "/about",
  "/faq",
  "/contact",
  "/request-quote",
  "/shipping-delivery",
  "/returns-cancellations",
  "/warranty",
  "/wood-characteristics",
  "/furniture-care",
  "/privacy",
  "/terms",
];

const ADMIN_PATHS = [
  "/admin",
  "/admin/products",
  "/admin/products/new",
  "/admin/categories",
  "/admin/options",
  "/admin/add-ons",
  "/admin/portfolio",
  "/admin/quotes",
  "/admin/custom-requests",
  "/admin/messages",
  "/admin/faqs",
  "/admin/pages",
  "/admin/homepage",
  "/admin/media",
  "/admin/settings",
  "/admin/orders",
];

type Problem = { path: string; width?: number; kind: string; detail: string };
const problems: Problem[] = [];

async function checkPage(browser: Browser, pagePath: string, width: number, cookie?: string) {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 } });
  if (cookie) {
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name: name!, value: rest.join("="), url: BASE }]);
  }
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Download the React DevTools|favicon/.test(m.text())) errors.push(m.text());
  });
  const res = await page.goto(BASE + pagePath, { waitUntil: "networkidle", timeout: 60000 });
  const status = res?.status() ?? 0;
  if (status >= 400) problems.push({ path: pagePath, width, kind: "status", detail: String(status) });

  await autoScroll(page);
  const result = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const brokenImages = [...document.images]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && getComputedStyle(img).visibility !== "hidden";
        return visible && (!img.complete || img.naturalWidth === 0);
      })
      .map((img) => img.currentSrc || img.src);
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .map((a) => a.getAttribute("href")!)
      .filter((h) => h.startsWith("/") && !h.startsWith("//"));
    const small = [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || el.closest("[aria-hidden=true]")) return false;
        if (el.classList.contains("sr-only") || el.closest(".sr-only")) return false;
        // Inline text links inside paragraphs are exempt (WCAG 2.5.8 inline exception).
        if (el.tagName === "A" && el.closest("p, li, dd, td") && style.display === "inline") return false;
        const isInput = el.tagName === "INPUT" && ["checkbox", "radio"].includes((el as HTMLInputElement).type);
        if (isInput) return false;
        return r.width < 24 || r.height < 24;
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);
    const h1 = document.querySelectorAll("h1").length;
    const missingAlt = [...document.images].filter((img) => !img.hasAttribute("alt")).length;
    const unlabeled = [...document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea")]
      .filter((el) => !el.closest("[aria-hidden=true]") && !el.labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
      .map((el) => el.name || el.id);
    return { overflow, brokenImages, links, small, h1, missingAlt, unlabeled };
  });

  if (result.overflow > 1) problems.push({ path: pagePath, width, kind: "overflow", detail: `${result.overflow}px horizontal overflow` });
  for (const src of result.brokenImages) problems.push({ path: pagePath, width, kind: "image", detail: src });
  for (const e of errors) problems.push({ path: pagePath, width, kind: "console", detail: e.slice(0, 300) });
  if (width === 390) {
    for (const s of result.small.slice(0, 10)) problems.push({ path: pagePath, width, kind: "tap-target", detail: s });
  }
  if (width === 1440 && !pagePath.startsWith("/admin")) {
    if (result.h1 !== 1) problems.push({ path: pagePath, width, kind: "a11y", detail: `${result.h1} <h1> elements` });
  }
  if (result.missingAlt) problems.push({ path: pagePath, width, kind: "a11y", detail: `${result.missingAlt} images without alt attribute` });
  for (const u of result.unlabeled) problems.push({ path: pagePath, width, kind: "a11y", detail: `unlabeled field ${u}` });

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    const file = `${pagePath.replace(/\//g, "_") || "_home"}-${width}.png`;
    await page.screenshot({ path: path.join(SHOTS, file), fullPage: true });
  }
  await context.close();
  return result.links;
}

async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (process.env.PLAYWRIGHT_BROWSERS_PATH ? "/opt/pw-browsers/chromium" : undefined) });
  const visited = new Set<string>();
  const queue = [...SEED_PATHS];
  const allLinks = new Set<string>();

  while (queue.length && visited.size < 60) {
    const p = queue.shift()!;
    if (visited.has(p)) continue;
    visited.add(p);
    for (const w of WIDTHS) {
      const links = await checkPage(browser, p, w);
      for (const l of links) {
        const clean = l.split("#")[0]!.split("?")[0]!;
        if (!clean) continue;
        allLinks.add(clean);
        if (!visited.has(clean) && !clean.startsWith("/admin") && !clean.startsWith("/api") && !/\.(png|jpg|svg|xml|txt)$/.test(clean)) queue.push(clean);
      }
    }
    console.log(`✓ ${p}`);
  }

  // Every internal link must resolve.
  for (const link of allLinks) {
    if (visited.has(link) || link.startsWith("/admin")) continue;
    const res = await fetch(BASE + link, { redirect: "manual" });
    if (res.status >= 400) problems.push({ path: link, kind: "link", detail: `link target returns ${res.status}` });
  }

  if (ADMIN_COOKIE) {
    for (const p of ADMIN_PATHS) {
      for (const w of [1440, 768, 390]) await checkPage(browser, p, w, ADMIN_COOKIE);
      console.log(`✓ ${p}`);
    }
  }

  await browser.close();

  console.log(`\nChecked ${visited.size} public pages${ADMIN_COOKIE ? ` and ${ADMIN_PATHS.length} admin pages` : ""} at ${WIDTHS.join(", ")}px.`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const pr of problems) console.log(`  [${pr.kind}] ${pr.path}${pr.width ? ` @${pr.width}` : ""} — ${pr.detail}`);
    process.exit(1);
  }
  console.log("No problems found.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
