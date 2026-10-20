import { FORUM_TEACHER_HOST, TEACHER_SIGNUP_ORIGIN, TEACHER_SURFACE_PREFIXES, teacherSurfaceUrl } from './surface'

/**
 * THE SERVICES EDITION'S 308s THAT HAND THE TEACHER SURFACE TO eno.vn — next.config.ts `redirects()` spreads them on a
 * "services" build only (owner decision 6, 2026-10-20). The map, the reasons and the third way in (a teacher's /listings/<id>,
 * decided by the PDP) are in ./surface.ts.
 * ⛔ IMPORTED BY next.config.ts AND NOTHING ELSE, so no browser bundle carries a rule. A relative import, like
 * src/lib/root-segments.ts's: next.config resolves no `@/` alias.
 */

/** The shape next.config's `redirects()` takes (only what these rules use). */
type Redirect = { source: string; destination: string; permanent: boolean; has?: { type: 'host'; value: string }[] }

/**
 * The services edition's 308s, in next.config.ts order. next.config's redirects run BEFORE src/proxy.ts, so they also
 * catch what the proxy would otherwise have answered on the teacher host.
 *
 * ⛔ THE HOST RULE COMES FIRST: on teacher.eno.forum every page path goes to the same path on teacher.eno.vn (whose proxy
 * serves `/` as the form and 301s anything else to eno.vn), so a path rule must not take it to the apex instead. It keeps
 * what the forum apex's own move (the `eno.forum` rule in next.config.ts) keeps, for the same reasons: `api/` (a page
 * still open there posts its beacons to its own host, which the proxy passes through — a 308 would send a POST across
 * origins), `_next/` (that page's own chunks), `.well-known/` (documents about that host) and `sw.js` (a service worker's
 * update refuses a redirected script). `/` → `https://teacher.eno.vn/`.
 * ⚠️ `:path+`, NOT `:path*`, BELOW A PREFIX: the prefix's own page is its own rule (`root`), so nothing is left to Next's
 * handling of an empty repeated parameter in a destination.
 */
export function forumTeacherRedirects(): Redirect[] {
  return [
    {
      source: '/:path((?!(?:api|_next|\\.well-known)(?:/|$)|sw\\.js$).*)',
      has: [{ type: 'host', value: FORUM_TEACHER_HOST }],
      destination: `${TEACHER_SIGNUP_ORIGIN}/:path`,
      permanent: true,
    },
    ...TEACHER_SURFACE_PREFIXES.flatMap(({ prefix, root }) => [
      ...(root ? [{ source: prefix, destination: teacherSurfaceUrl(prefix), permanent: true }] : []),
      { source: `${prefix}/:path+`, destination: teacherSurfaceUrl(`${prefix}/:path+`), permanent: true },
    ]),
  ]
}
