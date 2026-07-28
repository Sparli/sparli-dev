/**
 * Performance budget, enforced as a build gate.
 *
 * The site claims to be fast. A claim nobody checks is a claim that decays: the
 * page is fast on the day it ships, then a font gets added, then an analytics
 * snippet, and eighteen months later it is a normal slow website with a stale
 * boast on it. So the budget is a script that fails the build.
 *
 * The JS limit is the one that matters. Astro's default output is zero client
 * JavaScript, so this is not a target to hit -- it is a ratchet that stops a
 * future me from casually reaching for a component library.
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
  // One inlined stylesheet for the whole site. If this is under pressure, the
  // answer is usually less CSS rather than a bigger number.
  cssBytesGzip: 12 * 1024,
  // Largest single HTML document, gzipped. Bounds how much prose can sit on one
  // page before it should have been split.
  htmlBytesGzip: 20 * 1024,
  // Total shipped weight. Catches the day somebody adds a 2MB hero photograph.
  totalBytes: 700 * 1024,
};

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
let maxHtmlGzip = 0;
let maxHtmlPath = "";

for (const file of files) {
  const { size } = await stat(file);
  totalBytes += size;
  const ext = extname(file);

  if (ext === ".js" || ext === ".mjs") jsBytes += size;

  if (ext === ".css") {
    maxCssGzip = Math.max(maxCssGzip, gzipSync(await readFile(file)).length);
  }
  if (ext === ".html") {
    const gz = gzipSync(await readFile(file)).length;
    if (gz > maxHtmlGzip) {
      maxHtmlGzip = gz;
      maxHtmlPath = file;
    }
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const checks = [
  ["client JavaScript", jsBytes, BUDGET.jsBytes, (n) => `${n} B`],
  ["largest CSS (gzip)", maxCssGzip, BUDGET.cssBytesGzip, kb],
  [`largest HTML (gzip) ${maxHtmlPath}`, maxHtmlGzip, BUDGET.htmlBytesGzip, kb],
  ["total output", totalBytes, BUDGET.totalBytes, kb],
];

let failed = false;
console.log(`\n  performance budget — ${files.length} files in ${DIST}/\n`);
for (const [label, actual, limit, fmt] of checks) {
  const ok = actual <= limit;
  if (!ok) failed = true;
  console.log(
    `  ${ok ? "pass" : "FAIL"}  ${label.padEnd(46)} ${fmt(actual).padStart(10)} / ${fmt(limit)}`,
  );
}

if (failed) {
  console.error(
    "\n  Budget exceeded. Either make it smaller, or raise the limit in" +
      " scripts/check-budget.mjs and write down why in the same commit.\n",
  );
  process.exit(1);
}
console.log("\n  within budget\n");
