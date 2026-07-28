import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * The schema is a build-time gate on my own writing, not decoration.
 *
 * Two fields exist purely to stop me from publishing a claim I could not defend:
 *
 *   `evidence` — every entry must say how the outcome could be checked. A number
 *   with no stated source is the shape of claim an interviewer picks first, so
 *   the schema refuses to build one.
 *
 *   `layer` — what I actually did. `delivery` means I built, integrated, deployed
 *   or operated it. `architecture` means I designed it and others built it. There
 *   is deliberately no value for work on model internals, because I do not do
 *   that and a schema that cannot express a claim is a claim I cannot
 *   accidentally make.
 *
 * A missing or invalid field is a build error, so nothing reaches the site
 * without it.
 */
const shipped = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/shipped" }),
  schema: z.object({
    // Written as the SYMPTOM, not the deliverable. "Calls dropped after four
    // seconds" is legible in a way "Voice agent integration" is not.
    title: z.string().max(90),
    // One line, carrying the outcome. Shown on the home page.
    outcome: z.string().max(190),
    period: z.string(),
    context: z.string().max(120),
    layer: z.enum(["delivery", "architecture"]),
    evidence: z.string().min(10),
    stack: z.array(z.string()).min(1),
    order: z.number(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { shipped };
