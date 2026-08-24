import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HANDLE_RE } from './handle-format'

/**
 * EVERY ROOT-LEVEL URL PATH THIS EDITION'S APP ROUTER OWNS, READ FROM DISK.
 *
 * ⛔ THIS EXISTS BECAUSE `afterFiles` REWRITES OUTRANK APP ROUTES, WHICH IS NOT OBVIOUS AND WAS
 * MEASURED THE HARD WAY. The documented order is
 * `beforeFiles -> check_fs -> afterFiles -> dynamic routes -> fallback`, and `check_fs` covers
 * `public/` ONLY — app-router pages, static ones included, resolve in the LATER "dynamic routes"
 * phase. So a catch-all `afterFiles` rewrite shadows real pages: with a naive `/:seg` source,
 * `GET /moving-to-vietnam` with `Accept: text/markdown` answered `404 text/markdown`
 * (measured 2026-08-24) while the same URL rendered 200 in a browser. Telling an agent a real page
 * does not exist is strictly worse than the empty 404 body that rewrite set out to fix.
 *
 * ⚠️ DERIVED, NEVER TYPED OUT. A hand-kept list is the version that rots: the next SEO landing page
 * would silently 404 for markdown clients ONLY, so no browser test would catch it.
 *
 * ⛔ EDITION-AWARE, AND THAT IS A LICENSING REQUIREMENT, NOT A NICETY. A directory is a route only
 * if it holds a `page`/`route` file whose extension THIS build compiles. `src/app/itinerary`
 * contains just `page.forum.svc.tsx`, so it is a real route on eno.forum and NOT A ROUTE AT ALL on
 * eno.vn. Listing directory names blindly would have written `itinerary` into the marketplace
 * artifact's config — the edition-leak class that passes tsc, lint and every test.
 */
/**
 * Next generates these URLs from single FILES, so there is no directory for the walk to find.
 *
 * ⚠️ THE STATIC ONES ARE SERVED UNDER THEIR OWN FILENAME AND ALL CONTAIN A DOT, which means they
 * are not handle-shaped and would be claimed by the rewrite. `apple-icon.png`, `favicon.ico` and
 * `icon.svg` all exist at this app's root (measured 2026-08-24) — a reviewer caught that an
 * earlier map listed only `favicon.ico`, so the other two would have answered a false markdown 404.
 */
const GENERATED_METADATA: Record<string, string> = {
  manifest: 'manifest.webmanifest', robots: 'robots.txt', sitemap: 'sitemap.xml',
}
const STATIC_METADATA = /^(favicon\.ico|(?:icon|apple-icon|opengraph-image|twitter-image)\d*\.(?:ico|png|jpe?g|svg))$/

function metadataRouteFor(file: string): string | null {
  if (STATIC_METADATA.test(file)) return file
  const m = /^(manifest|robots|sitemap)\.(?:ts|tsx|js|jsx)$/.exec(file)
  return m ? GENERATED_METADATA[m[1]] : null
}

function pageExtOf(file: string): string | null {
  const m = /^(?:page|route)\.(.+)$/.exec(file)
  return m ? m[1] : null
}

export function appRootSegments(pageExtensions: string[], appDir?: string): string[] {
  const dir = appDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'app')
  const enabled = new Set(pageExtensions)
  const out = new Set<string>()

  const hasRouteForThisEdition = (base: string, depth: number): boolean => {
    if (depth > 4) return false
    let found = false
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) {
        const ext = pageExtOf(e.name)
        if (ext && enabled.has(ext)) found = true
        continue
      }
      // A nested route GROUP still belongs to this segment's URL; a real child segment does not,
      // but its parent is still a path prefix we must not claim, so either way this counts.
      if (e.name.startsWith('(') && hasRouteForThisEdition(join(base, e.name), depth + 1)) found = true
    }
    return found
  }

  const walk = (base: string, depth: number) => {
    if (depth > 4) return
    for (const e of readdirSync(base, { withFileTypes: true })) {
      const name = e.name
      if (!e.isDirectory()) {
        const url = depth === 0 ? metadataRouteFor(name) : null
        if (url) out.add(url)
        continue
      }
      if (name.startsWith('[')) continue
      // `_private` folders are NOT routes and their children are not URL segments — do not walk in.
      if (name.startsWith('_')) continue
      // A route GROUP `(name)` is not a URL segment: its children sit at this level.
      if (name.startsWith('(')) { walk(join(base, name), depth + 1); continue }
      // A directory with no page/route file for THIS edition (or only a folded-out `.svc.` one) is
      // not a URL. Its subtree may still hold one, so look down before rejecting it.
      // ⛔ NO "…BUT IT HAS SUBDIRECTORIES" FALLBACK. An earlier draft added a directory when it
      // held any child directory, on the theory that a parent path should never be claimed. A
      // reviewer refuted it and measurement agreed: `src/app/vietnam-evisa` holds
      // `page.forum.svc.tsx` PLUS child route directories, so the fallback put `vietnam-evisa`
      // into the MARKETPLACE list even though eno.vn genuinely 404s it (measured 2026-08-24) —
      // the exact edition leak this function exists to prevent. The fallback is also unnecessary:
      // this rewrite matches ONE segment (`[^/]+`, no slashes), so `/vietnam-evisa/by-nationality`
      // can never reach it and a parent prefix needs no protection.
      if (hasRouteForThisEdition(join(base, name), 0)) out.add(name)
    }
  }

  try {
    walk(dir, 0)
  } catch {
    // ⛔ FAIL SAFE, NEVER FAIL OPEN. If src/app cannot be read (a CLI invoked from another cwd, a
    // pruned standalone image), returning [] would make the pattern below claim EVERY path. An
    // empty result here is turned into a pattern that matches nothing — see markdown404Source.
    return []
  }
  return [...out]
}

/** The handle grammar, taken from the one definition rather than restated. */
const HANDLE_SHAPE = HANDLE_RE.source.replace(/^\^/, '').replace(/\$$/, '')

/**
 * The `source` for the markdown-404 rewrite: one path segment that is NEITHER a real page NOR
 * shaped like a storefront handle. What remains — dashes, dots, uppercase, too short, too long —
 * can be neither, so answering 404 is a fact rather than an inference.
 *
 * Returns a pattern that matches NOTHING when the segment list came back empty, so a failed
 * filesystem read disables the rewrite instead of 404ing the whole site.
 */
export function markdown404Source(segments: string[]): string {
  if (!segments.length) return '/:seg(?!)'
  const escaped = segments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return `/:seg((?!(?:${escaped})$)(?!${HANDLE_SHAPE}$)[^/]+)`
}
