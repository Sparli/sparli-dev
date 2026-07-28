/**
 * Horizontal-overflow check across real viewport widths.
 *
 * This exists because of a measurement mistake worth not repeating. I screenshot
 * the site with headless Chrome at `--window-size=390,1400`, saw content clipped
 * on the right, and started "fixing" a mobile overflow bug. A control page
 * printing `innerWidth` showed the truth: **headless Chrome enforces a minimum
 * window width of 500px**, rendered the page at 500, and then cropped the image
 * to 390. The site had no overflow at all. I nearly shipped CSS changes to fix a
 * bug that did not exist, on the evidence of a tool that was quietly lying.
 *
 * So this measures rather than looks: it asserts `scrollWidth === innerWidth` at
 * each width, using real viewport emulation, and names the offending elements
 * when it fails instead of leaving a bisect by hand.
 *
 *   node scripts/check-viewport.mjs          # against the dev server
 *   node scripts/check-viewport.mjs --built  # against dist/ over file://
 */
import { chromium } from "playwright";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const WIDTHS = [
  ["small phone", 320],
  ["iPhone", 390],
  ["large phone", 430],
  ["tablet", 768],
  ["laptop", 1280],
];

const useBuilt = process.argv.includes("--built");
const base = useBuilt ? `file://${process.cwd()}/dist` : "http://localhost:4321";

// Check every page, not just the home page. A case study with a wide table is
// far more likely to overflow than the page I happen to be looking at.
//
// Both branches are derived rather than listed. A hardcoded route list is a
// second copy of the site's structure that goes stale silently: the page you
// forgot to add is exactly the page nobody has looked at on a phone.
async function routes() {
  if (useBuilt) {
    // Any .html, not just index.html, so 404.html is covered too.
    const found = [];
    async function walk(dir, prefix = "") {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(dir, e.name), `${prefix}/${e.name}`);
        else if (e.name.endsWith(".html")) found.push(`${prefix}/${e.name}`);
      }
    }
    await walk("dist");
    return found;
  }

  // Dev server: reconstruct the routes from the sources Astro builds them from.
  // Dynamic routes ([...id].astro) are skipped here and reached via the content
  // files that populate them.
  const pages = (await readdir("src/pages", { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".astro") && !e.name.startsWith("["))
    .map((e) => (e.name === "index.astro" ? "/" : `/${e.name.replace(/\.astro$/, "")}`));

  const studies = (await readdir("src/content/shipped"))
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => `/shipped/${f.replace(/\.mdx$/, "")}/`);

  return [...pages, ...studies];
}

const browser = await chromium.launch();
let failed = false;
console.log(`\n  viewport check — ${base}\n`);

for (const route of await routes()) {
  for (const [label, width] of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(base + route, { waitUntil: "load" });
    const r = await page.evaluate(() => ({
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 5)
        .map((el) => {
          const cls = el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : "";
          return `${el.tagName.toLowerCase()}${cls} extends to ${Math.round(el.getBoundingClientRect().right)}px`;
        }),
    }));
    await page.close();

    const ok = r.scroll <= r.inner;
    if (!ok) {
      failed = true;
      console.log(`  FAIL  ${route.padEnd(46)} ${label} ${width}px — scrollWidth ${r.scroll}`);
      r.offenders.forEach((o) => console.log(`          ${o}`));
    }
  }
  console.log(`  pass  ${route}`);
}

await browser.close();

if (failed) {
  console.error("\n  Horizontal overflow. A page wider than the viewport means a sideways scrollbar on a phone.\n");
  process.exit(1);
}
console.log("\n  no horizontal overflow at any width\n");
