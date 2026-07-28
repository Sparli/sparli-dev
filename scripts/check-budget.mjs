/**
 * Performance budget, enforced as a build gate.
 *
 * The site claims to be fast. A claim nobody checks is a claim that decays: the
 * page is fast on the day it ships, then a font gets added, then an analytics
 * snippet, and eighteen months later it is a normal slow website with a stale
 * boast on it. So the budget is a script that fails the build.
 *
 * WHY THIS READS THE DOCUMENTS INSTEAD OF LISTING THE FILES
 *
 * The first version summed files by extension: anything ending .js counted as
 * client JavaScript, anything ending .css counted as CSS. Both checks were
 * wrong, and one of them was measuring nothing at all.
 *
 * `inlineStylesheets: "always"` means the build emits no .css files, so the CSS
 * check compared 0 against a 12 KB limit and passed unconditionally on every
 * run. A green check on an empty assertion.
 *
 * The JavaScript check had the same hole pointing the other way. A <script>
 * block written straight into a layout ships JavaScript to the browser without
 * ever producing a .js file, so the gate whose entire purpose is to stop that
 * would have reported 0 B and passed.
 *
 * Both are one mistake: measuring a proxy (files on disk, grouped by extension)
 * rather than the property that matters (bytes the browser parses and runs).
 * The proxy agreed with the property until the build changed how it delivered
 * the same bytes. So this version reads the shipped documents and counts what
 * is inside them, whichever way the build chose to deliver it.
 *
 *   node scripts/check-budget.mjs
 */
import { readdir, stat, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = "dist";

// Deliberately tight, and deliberately explained. A number with no reason
// attached is one nobody dares change and everyone eventually ignores.
const BUDGET = {
  // Zero is the point. Any client JS is a decision, and a decision should
  // require editing this file and writing down why.
  jsBytes: 0,
  // All the CSS for one document, however it is delivered. If this is under
  // pressure the answer is usually less CSS rather than a bigger number.
  cssBytesGzip: 12 * 1024,
  // Largest single HTML document, gzipped. Bounds how much prose can sit on one
  // page before it should have been split.
  htmlBytesGzip: 20 * 1024,
  // Total shipped weight. Catches the day somebody adds a 2MB hero photograph.
  totalBytes: 700 * 1024,
};

/**
 * Script types that do not execute, so they do not count against a JavaScript
 * budget. Anything NOT on this list counts, which means a type this script has
 * never heard of fails the build rather than slipping through.
 *
 * The bias is deliberate. A false alarm costs a minute of reading; a false
 * clear costs the claim on the front page, silently, for as long as nobody
 * happens to check by hand.
 */
const NON_EXECUTING_SCRIPT_TYPES = new Set([
  "application/ld+json", // structured data for search engines
  "importmap", // module resolution table, parsed not run
  "speculationrules", // prefetch hints, parsed not run
]);

/* -------------------------------------------------------------------------
 * Reading the HTML
 *
 * Regex over HTML is usually a mistake. It is defensible here because the input
 * is HTML this repo generates, not arbitrary pages off the web, and because
 * every ambiguous case is written to fail the build rather than pass it.
 *
 * The attribute pattern has to be quote-aware rather than "anything up to the
 * next >". This site already ships a counter-example: the favicon is an inline
 * SVG data URI, so a <link> tag's href legitimately contains > characters.
 * ---------------------------------------------------------------------- */
const ATTRS = `(?:"[^"]*"|'[^']*'|[^>"'])*`;
const SCRIPT_TAG = new RegExp(`<script\\b(${ATTRS})>([\\s\\S]*?)</script\\s*>`, "gi");
const STYLE_TAG = new RegExp(`<style\\b(${ATTRS})>([\\s\\S]*?)</style\\s*>`, "gi");
const OPEN_TAG = new RegExp(`<[a-z][a-z0-9-]*(${ATTRS})>`, "gi");
const EVENT_ATTR = /(?:^|\s)(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function attrValue(attrs, name) {
  const m = attrs.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function analyseDocument(html) {
  let jsBytes = 0;
  let css = "";
  const findings = [];
  const thirdParty = [];

  for (const [, attrs, body] of html.matchAll(SCRIPT_TAG)) {
    const src = attrValue(attrs, "src");
    if (src) {
      // A local bundle is already counted by the file walk below. An off-origin
      // one is counted separately rather than in bytes, because it weighs zero
      // on this disk and an unknown amount in the browser. Counting it by size
      // would let a third-party tag pass a byte budget it obviously violates,
      // which is the same proxy-versus-property mistake this file exists to fix.
      if (/^(?:https?:)?\/\//i.test(src)) thirdParty.push(`<script src="${src}">`);
      continue;
    }
    const type = (attrValue(attrs, "type") ?? "").trim().toLowerCase();
    if (NON_EXECUTING_SCRIPT_TYPES.has(type)) continue;
    const bytes = Buffer.byteLength(body);
    if (bytes === 0) continue;
    jsBytes += bytes;
    findings.push(`inline <script${type ? ` type="${type}"` : ""}> ${bytes} B`);
  }

  for (const [, , body] of html.matchAll(STYLE_TAG)) css += body;

  // Event-handler attributes are executable JavaScript that never touches a .js
  // file and never sits inside a <script> block. onclick="..." is client JS by
  // the only definition that matters, which is the browser's.
  for (const [, attrs] of html.matchAll(OPEN_TAG)) {
    for (const [, name, dq, sq, bare] of attrs.matchAll(EVENT_ATTR)) {
      const value = dq ?? sq ?? bare ?? "";
      jsBytes += Buffer.byteLength(name) + Buffer.byteLength(value);
      findings.push(`inline handler ${name}="${value.slice(0, 40)}"`);
    }
  }

  return { jsBytes, css, findings, thirdParty };
}

/* ---------------------------------------------------------------------- */

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

const files = await walk(DIST);
let totalBytes = 0;
let jsBytes = 0;
let maxCssGzip = 0;
let maxCssPath = "";
let maxHtmlGzip = 0;
let maxHtmlPath = "";
let htmlCount = 0;
const findings = [];
const thirdParty = [];

for (const file of files) {
  const { size } = await stat(file);
  totalBytes += size;
  const ext = extname(file).toLowerCase();

  if (ext === ".js" || ext === ".mjs") {
    jsBytes += size;
    findings.push(`${file} is a JavaScript file (${size} B)`);
  }

  if (ext === ".css") {
    const gz = gzipSync(await readFile(file)).length;
    if (gz > maxCssGzip) {
      maxCssGzip = gz;
      maxCssPath = file;
    }
  }

  if (ext === ".html") {
    htmlCount += 1;
    const html = await readFile(file, "utf8");

    const gz = gzipSync(html).length;
    if (gz > maxHtmlGzip) {
      maxHtmlGzip = gz;
      maxHtmlPath = file;
    }

    const doc = analyseDocument(html);
    jsBytes += doc.jsBytes;
    findings.push(...doc.findings.map((f) => `${file}: ${f}`));
    thirdParty.push(...doc.thirdParty.map((f) => `${file}: ${f}`));

    // Inline CSS competes with an external stylesheet for the same budget. The
    // limit is about how much CSS the site has, not about how it is delivered.
    if (doc.css) {
      const cssGz = gzipSync(doc.css).length;
      if (cssGz > maxCssGzip) {
        maxCssGzip = cssGz;
        maxCssPath = `${file} (inline)`;
      }
    }
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const bytes = (n) => `${n} B`;

const checks = [
  ["client JavaScript", jsBytes, BUDGET.jsBytes, bytes],
  // Counted rather than weighed, deliberately. See analyseDocument.
  ["third-party scripts", thirdParty.length, 0, (n) => `${n}`],
  [`largest CSS, gzip  ${maxCssPath}`, maxCssGzip, BUDGET.cssBytesGzip, kb],
  [`largest HTML, gzip ${maxHtmlPath}`, maxHtmlGzip, BUDGET.htmlBytesGzip, kb],
  ["total output", totalBytes, BUDGET.totalBytes, kb],
];

let failed = false;
console.log(`\n  performance budget — ${files.length} files, ${htmlCount} documents in ${DIST}/\n`);

for (const [label, actual, limit, fmt] of checks) {
  const ok = actual <= limit;
  if (!ok) failed = true;
  console.log(
    `  ${ok ? "pass" : "FAIL"}  ${label.padEnd(52)} ${fmt(actual).padStart(10)} / ${fmt(limit)}`,
  );
}

// A check that finds nothing to measure has not passed, it has abstained. This
// site has CSS, so zero here means the measurement broke rather than the site
// got smaller, which is exactly the failure the previous version shipped with.
if (maxCssGzip === 0) {
  failed = true;
  console.log(`\n  FAIL  found no CSS anywhere in ${DIST}/, so that check measured nothing`);
}
if (htmlCount === 0) {
  failed = true;
  console.log(`\n  FAIL  found no HTML documents in ${DIST}/, so nothing was inspected`);
}

if (findings.length || thirdParty.length) {
  console.log("\n  client-side code found:");
  for (const f of [...findings, ...thirdParty]) console.log(`    ${f}`);
}

if (failed) {
  console.error(
    "\n  Budget exceeded. Either make it smaller, or raise the limit in" +
      " scripts/check-budget.mjs and write down why in the same commit.\n",
  );
  process.exit(1);
}
console.log("\n  within budget\n");
