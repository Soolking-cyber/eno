/**
 * Teachers (owner, 2026-09-30) — shared constants. Import-free so client components, the proxy and
 * server code can all read them.
 */
export const TEACHERS_CATEGORY_SLUG = 'teachers'
export const TEACHER_LISTING_TYPE = 'teacher'
/** The subdomain label that serves the teacher sign-up form (teacher.eno.vn). */
export const TEACHER_SUBDOMAIN = 'teacher'
/** An anonymous teacher.eno.vn draft lives this long before the cron purges it. */
export const TEACHER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
