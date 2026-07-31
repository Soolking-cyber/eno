/**
 * WHICH APP THIS BUILD IS.
 *
 * eno.vn is registering as a licensed Vietnamese company (sàn TMĐT) and CANNOT legally offer e-visa
 * services, itinerary services, or PayPal checkout. eno.forum serves those instead. Both are built
 * from THIS repo — one codebase, two images — and this module is the only place that knows which.
 *
 * ⚠️ THE FAILURE MODE IS A LEAK, NOT A BUG. Anywhere the marketplace edition still shows, links to,
 * describes, indexes, emails or serves one of those surfaces, the licensed company is advertising a
 * service it is not licensed for. Read that sentence again before relaxing anything in this file.
 *
 * ⚠️ THIS FILE HAS NO IMPORTS, AND THAT IS A REQUIREMENT RATHER THAN A STYLE. It must be importable
 * from a CLIENT component, because `IS_SERVICES && <VisaChip/>` in client code is precisely where the
 * dead-code elimination has to happen. The first draft resolved the desk sellers here too and was
 * therefore server-only by transitivity — `@/lib/visa-shop` and `@/lib/trips/dm-thread` both
 * `import 'server-only'` — which would have made every client use of the flag a build error and
 * quietly defeated the whole mechanism. The server-side predicate lives in `edition-scope.ts`
 * instead. Keep this file free of imports.
 *
 * ⚠️ ONE FLAG, NOT SEVERAL. No ENO_VISA_ENABLED beside this, no per-feature toggles. Every extra
 * flag is another combination that can disagree in a state nobody tested, and the whole point of one
 * codebase is that the two editions cannot drift.
 *
 * ⚠️ BUILD-TIME, NOT RUNTIME, and the `NEXT_PUBLIC_` prefix is what makes that true: it is the
 * prefix that makes Next inline the literal into client chunks, so the minifier can delete the
 * branch rather than merely skip it at render. The value is not a secret. Three measured facts force
 * build-time over a runtime check — all three verified against this repo's own production build on
 * 2026-07-31:
 *   1. PRERENDERED HTML. `/regulations` exports neither `revalidate` nor `dynamic`, so it is fully
 *      static and never regenerates; its HTML on disk names "the assisted e-Visa application
 *      service" and "PayPal". `.next/server/app/index.html` carries 12 occurrences of "E-Visa",
 *      including the live listing title "E-Visa - Standard Processing". A runtime `if` cannot
 *      un-bake a file that is served from disk before any of our code runs.
 *   2. INLINED HOST. `src/app/layout.tsx` constant-folds `NEXT_PUBLIC_APP_URL || 'https://eno.vn'`
 *      at build time. ONE image physically cannot emit two hostnames, so a shared artifact would
 *      have eno.forum serving `<link rel="canonical" href="https://eno.vn/vietnam-evisa">` — the
 *      licensed company claiming authorship of the visa pages. This alone forces two builds even if
 *      the visa feature did not exist.
 *   3. CLIENT BUNDLE. "Pay with PayPal" is present in two client chunks today. A runtime flag ships
 *      that vocabulary to every eno.vn browser and merely declines to render it, which is a weaker
 *      statement than "the string is not in the artifact".
 *
 * The cost is honest and was accepted by the owner: two builds roughly double Cloud Build, already
 * ~62% of this project's GCP spend. The triggers run in parallel, so time-to-prod is unchanged.
 */
export type Edition = 'marketplace' | 'services'

/**
 * ⚠️ DEFAULTS TO 'services', DELIBERATELY, AND THIS IS THE SAFE DIRECTION WHILE ONE DEPLOYMENT
 * EXISTS. Today a single image serves eno.vn with everything switched on. Defaulting to
 * 'marketplace' would make this module's arrival silently strip the live visa and trip business out
 * of production the moment it is imported — a self-inflicted outage on the way to a legal fix.
 * Phase 1 stands up the second build and sets the variable explicitly on BOTH services, and only
 * then does the default stop being load-bearing. Do not flip it before that.
 *
 * ⚠️ COMPARE THE LITERAL, do not read the env into a variable first. `process.env.NEXT_PUBLIC_X`
 * has to appear verbatim for Next to substitute it at build time; an indirection through a helper
 * defeats the inlining and with it the dead-code elimination this whole design rests on.
 */
export const EDITION: Edition =
  process.env.NEXT_PUBLIC_ENO_EDITION === 'marketplace' ? 'marketplace' : 'services'

/** True on eno.forum: visa, itinerary and PayPal are live. */
export const IS_SERVICES = EDITION === 'services'

/** True on eno.vn: the licensed marketplace, where none of those may appear. */
export const IS_MARKETPLACE = EDITION === 'marketplace'
