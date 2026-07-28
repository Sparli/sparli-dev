# sparli.dev

Personal site. Static, no client JavaScript, deployed to Cloudflare.

## Why it is built this way

The site makes a claim about performance, so the claim is enforced rather than asserted.
`npm run budget` fails the build if client JavaScript exceeds **zero bytes**, if the largest page
exceeds 20 KB gzipped, or if total output exceeds 700 KB. CI runs it on every push, and the deploy
job depends on it passing.

Content is MDX behind a Zod schema. Every case study must carry an `evidence` field saying how the
outcome could be checked, and a `layer` field recording what I actually did. A missing field is a
build error, not a review comment.

## Commands

```bash
npm run dev      # localhost:4321
npm run build    # static output to dist/
npm run budget   # performance budget
npx astro check  # types and content schema
```

## Measured

| | |
|---|---|
| Client JavaScript | 0 B |
| Largest page, gzipped | 5.0 KB |
| Total output | 36.5 KB |

## Stack

Astro 7 static · hand-written CSS · MDX content collections · Cloudflare Workers static assets ·
GitHub Actions for CI and deploy.
