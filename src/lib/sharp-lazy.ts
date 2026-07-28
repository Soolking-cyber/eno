import 'server-only'

/**
 * THE ONLY WAY THIS APP LOADS sharp — never `import sharp from 'sharp'` at module scope again.
 *
 * ⚠️ A TOP-LEVEL sharp IMPORT TOOK BROWSE DOWN FOR NINE HOURS. On 2026-07-27 `sharp@0.35.3` shipped
 * a container whose native backend could not load on linux-x64. Nothing about browsing needs an
 * image library — but `/api/listings` imports `lib/core/listings`, which imported `lib/ai-moderation`,
 * `lib/image-provenance` → `lib/image-hash`, and `lib/core/media`, and ALL THREE did
 * `import sharp from 'sharp'` at module scope for code paths that only run on create/upload. A
 * native module that fails to load at module scope takes down every route that transitively imports
 * it, GET included. `/api/listings` returned 500 on every request; the fix was reverting sharp.
 *
 * Deferring the load moves the blast radius to the feature that actually needs it: with sharp
 * broken, moderation and hashing fail (fail-open, as they already do on any error) and browse,
 * search and the PDP keep serving.
 *
 * ⚠️ THIS IS DEFENCE IN DEPTH, NOT THE FIX. The Dockerfile proves sharp works inside the image
 * before it ships (a build-stage encode, run as the server's own user). That guard stops a broken
 * image from deploying at all; this file limits the damage if one ever gets past it.
 *
 * A rejected load is NOT cached: `cached` is cleared on failure so a later call retries rather than
 * inheriting a permanently poisoned promise. Native-load failures are not really transient, but
 * caching a rejection buys nothing and makes the failure harder to reason about.
 */
/**
 * ⚠️ THE CALLABLE, WHICH IS NOT THE SAME THING AS THE MODULE — and the two lines disagree about it.
 * sharp 0.34 is CommonJS (`export = sharp`), so `typeof import('sharp')` IS the callable and there
 * is no `.default` on the type. 0.35 ships a real ES module, so `typeof import('sharp')` is the
 * NAMESPACE and the callable is its `default`. Writing the 0.34 form under 0.35 produces
 * "This expression is not callable" at all seven call sites; writing the 0.35 form under 0.34
 * produces "Property 'default' does not exist". Both were observed here, on this repo, hours apart.
 */
type Sharp = (typeof import('sharp'))['default']

let cached: Promise<Sharp> | null = null

export function getSharp(): Promise<Sharp> {
  cached ??= import('sharp')
    // ⚠️ THE RUNTIME SHAPE IS STILL RESOLVED DEFENSIVELY, even though the TYPE is now pinned to
    // 0.35's namespace form. Under esModuleInterop a dynamic import of a CJS build hands back
    // `{ default: fn }` while a true ESM build may hand back the namespace whose `default` is the
    // fn — and a bundler can produce either. `?? m` covers both so a packaging change is a
    // typecheck failure (loud, local, one line) instead of a production one.
    .then((m) => ((m as unknown as { default?: Sharp }).default ?? (m as unknown as Sharp)))
    .catch((e) => {
      cached = null
      throw e
    })
  return cached
}
