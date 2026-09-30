/**
 * Teachers (owner, 2026-09-30) — shared constants. Import-free so client components, the proxy and
 * server code can all read them.
 */
export const TEACHERS_CATEGORY_SLUG = 'teachers'
export const TEACHER_LISTING_TYPE = 'teacher'
/** The subdomain label that serves the teacher sign-up form (teacher.eno.vn). */
export const TEACHER_SUBDOMAIN = 'teacher'
/**
 * teacher.eno.vn has no session (cookies are host-scoped), so its half of the form hands the draft to
 * eno.vn in the URL FRAGMENT: `https://eno.vn/teachers/join#d=<base64url JSON>`. A fragment never
 * reaches any server, so there is no anonymous write endpoint and no origin-guard exemption.
 */
export const TEACHER_DRAFT_HASH_KEY = 'd'
