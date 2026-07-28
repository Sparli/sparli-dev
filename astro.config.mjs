// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

// Static output, no adapter, no server. The site is content and links, so the
// whole thing is HTML and CSS on a CDN with nothing to run, patch or monitor.
//
// Astro is here for one reason: its default output ships zero client JavaScript.
// That makes the performance claim on the front page the DEFAULT state rather
// than something to fight for, which matters because the claim is checked in CI
// and a budget you have to fight to hold is a budget you eventually stop holding.
export default defineConfig({
  site: "https://sparli.dev",
  output: "static",
  integrations: [mdx(), sitemap()],
  build: {
    // One stylesheet inlined into the document rather than a separate request.
    // The CSS is small enough that a round trip costs more than the bytes.
    inlineStylesheets: "always",
  },
  compressHTML: true,
  markdown: {
    shikiConfig: { theme: "github-light", wrap: true },
  },
});
