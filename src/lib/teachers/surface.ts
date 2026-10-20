/**
 * ⛔ THE TEACHER SURFACE IS eno.vn's — eno.forum HANDS EVERY TEACHER PAGE TO IT WITH A 308 (owner decision 6, approved;
 * plan P1 item 13, 2026-10-20). One teacher marketplace, on the licensed site that runs the outreach, the ads and the school
 * directory, instead of two self-canonical copies of every profile splitting one small audience and its ranking. Measured
 * 2026-10-20 before the change: www.eno.forum answered 200 on /c/teachers, /teachers/cover, /schools and every teacher
 * profile (canonical to itself), and its sitemaps submitted /c/teachers plus all 112 live profiles.
 *
 * ON THE SERVICES EDITION ONLY, three ways in, one rule:
 *   · BY PATH — next.config.ts `redirects()` (./surface-redirects.ts): /c/teachers and every page under it (the
 *     district pages), /teachers/<…> (the cover-lessons landing, the sign-up form, the profile editor) and /schools and
 *     every page under it, each to the SAME path on https://eno.vn — the query kept (Next appends it to a redirect);
 *   · BY HOST — teacher.eno.forum, every page path, to the same path on https://teacher.eno.vn (the same file);
 *   · BY ROW — a teacher's profile at /listings/<id>, whose path does not say it is a teacher: the PDP decides, before it
 *     renders (src/app/[lang]/listings/[id]/(pdp)/layout.tsx).
 * And the forum's sitemaps submit none of them (src/lib/sitemap.ts, src/app/sitemaps/pages.xml/build.ts): a submitted URL
 * that redirects is a Search Console error.
 *
 * ⛔ eno.forum → eno.vn IS THE ALLOWED DIRECTION — the edition rule restricts what eno.vn links to, not what links to it.
 * The precedent is the teacher guide library (/teach-in-vietnam, 2026-10-10, the block above this one's in next.config.ts).
 * eno.vn is untouched: next.config builds these rules for a "services" build only, and the PDP and the links read
 * IS_SERVICES — so eno.vn can never redirect a page to itself.
 * ⚠️ A 308 IS KEPT BY BROWSERS WITH NO LIFETIME. Undoing this later leaves everyone who already followed one landing on
 * eno.vn until their cache lets go — what "permanent" was approved as.
 *
 * ⛔ A LEAF MODULE WITH NO IMPORTS: next.config.ts reaches it (through ./surface-redirects.ts), and next.config resolves no
 * `@/` alias (like src/lib/retired-categories.ts). Client code imports it too (src/lib/teachers/host.ts — the links), so it
 * holds only the map; the redirect rules themselves live in ./surface-redirects.ts, which nothing but next.config imports,
 * so no browser bundle of either edition carries them.
 */

/** eno.vn's apex — where the forum's teacher pages live. Never `www`: www.eno.vn 308s to the apex on every path. */
export const TEACHER_SURFACE_ORIGIN = 'https://eno.vn'
/** eno.vn's teacher sign-up host, where teacher.eno.forum goes. */
export const TEACHER_SIGNUP_ORIGIN = 'https://teacher.eno.vn'
/**
 * eno.forum's own teacher sign-up host — `teacherHost('https://www.eno.forum')` (src/lib/teachers/host.ts). A literal, not
 * derived, because next.config cannot import that module; next.config already refuses a services build whose app URL is
 * not on www.eno.forum, so the two cannot disagree on a real build.
 */
export const FORUM_TEACHER_HOST = 'teacher.eno.forum'

/**
 * THE PATHS THE FORUM HANDS OVER, ONCE: each prefix with every page below it, and the prefix itself where it is a page.
 * `/teachers` has no page of its own (only /teachers/cover, /join, /edit), so only the paths BELOW it move — a bare
 * /teachers keeps the 404 it answers today rather than being sent to a 404 on eno.vn.
 */
export const TEACHER_SURFACE_PREFIXES: readonly { prefix: string; root: boolean }[] = [
  { prefix: '/c/teachers', root: true },
  { prefix: '/teachers', root: false },
  { prefix: '/schools', root: true },
]

/** The absolute eno.vn URL of a teacher-surface path (`/listings/<id>`, `/c/teachers`, …). */
export function teacherSurfaceUrl(path: string): string {
  return `${TEACHER_SURFACE_ORIGIN}${path}`
}

/**
 * Does the forum 308 this PATH (no query, no fragment) to eno.vn? Exactly the path rules ./surface-redirects.ts builds —
 * src/lib/teachers/surface.test.ts runs both through Next's own matcher over the same paths, so the two cannot drift.
 * Case-insensitive, as Next matches a redirect source. A teacher's /listings/<id> is not a path rule (only the row knows).
 */
export function isTeacherSurfacePath(pathname: string): boolean {
  const p = pathname.toLowerCase()
  return TEACHER_SURFACE_PREFIXES.some(({ prefix, root }) =>
    (root && p === prefix) || (p.startsWith(`${prefix}/`) && p.slice(prefix.length + 1).split('/').every(Boolean)))
}
