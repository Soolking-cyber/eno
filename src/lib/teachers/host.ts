import { storefrontBaseHost } from '@/lib/storefront-host'
import { TEACHER_SUBDOMAIN } from '@/lib/teachers/constants'
import { IS_SERVICES } from '@/lib/edition'
import { FORUM_TEACHER_HOST, TEACHER_SIGNUP_ORIGIN, isTeacherSurfacePath, teacherSurfaceUrl } from '@/lib/teachers/surface'

/**
 * teacher.<base> — the teacher sign-up host (owner, 2026-09-30: "teacher.eno.vn is a form like page").
 * Import-light: the proxy (edge) and the pages both use it. `base` follows storefrontBaseHost, so
 * `www.` is stripped exactly as for storefronts (www.eno.forum → teacher.eno.forum, never
 * teacher.www.eno.forum).
 */
export function teacherHost(appUrl: string | null | undefined): string {
  const base = storefrontBaseHost(appUrl)
  return base ? `${TEACHER_SUBDOMAIN}.${base}` : ''
}

/** Is this Host header the teacher host? Port and case are ignored; loopback never is. */
export function isTeacherHost(hostHeader: string | null | undefined, appUrl: string | null | undefined): boolean {
  const want = teacherHost(appUrl)
  if (!want || !hostHeader) return false
  return hostHeader.toLowerCase().replace(/:\d+$/, '') === want
}

/** https://teacher.<base> — the canonical URL of the sign-up form. */
export function teacherOrigin(appUrl: string | null | undefined): string {
  const host = teacherHost(appUrl)
  if (!host || !appUrl) return ''
  try { return `${new URL(appUrl).protocol}//${host}` } catch { return '' }
}

/** The canonical app origin (apex, no www) — where the second half of the form lives. */
export function apexOrigin(appUrl: string | null | undefined): string {
  if (!appUrl) return ''
  try { const u = new URL(appUrl); return `${u.protocol}//${storefrontBaseHost(appUrl)}` } catch { return '' }
}

/**
 * The link INTO the sign-up form from any page of the app (owner, 2026-10-09: "redirect to teacher.eno.vn to create their
 * profile"): its own host — https://teacher.eno.vn/. ⛔ eno.forum's own, teacher.eno.forum, 308s there since 2026-10-20
 * (owner decision 6, src/lib/teachers/surface.ts), so the forum links eno.vn's form directly rather than a redirect. A build
 * with no app URL (a bare local run) falls back to the same form on this host. NEXT_PUBLIC_APP_URL is inlined at build, so a
 * client component reads the deployment's own value.
 */
export function teacherJoinUrl(appUrl: string | null | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  const origin = teacherOrigin(appUrl)
  if (!origin) return '/teachers/join'
  return teacherHost(appUrl) === FORUM_TEACHER_HOST ? `${TEACHER_SIGNUP_ORIGIN}/` : `${origin}/`
}

/**
 * An href as THIS edition links it, for a link that may point at a teacher page. On eno.forum a teacher-surface path —
 * /c/teachers and below, /teachers/<…>, /schools and below (`isTeacherSurfacePath`) — is eno.vn's page, which the forum
 * 308s to (owner decision 6, 2026-10-20; src/lib/teachers/surface.ts): the link goes there directly, query kept, instead of
 * through a redirect — and an in-app <Link> to it never asks the forum for an RSC payload that answers with a cross-origin
 * 308. Every other href, and every href on eno.vn, comes back exactly as given.
 */
export function teacherSurfaceHref(href: string): string {
  if (!IS_SERVICES || !href.startsWith('/')) return href
  const end = href.search(/[?#]/)
  return isTeacherSurfacePath(end < 0 ? href : href.slice(0, end)) ? teacherSurfaceUrl(href) : href
}

/**
 * Client only: is this document served on the teacher host? There a sign-in can never hold (cookies are host-scoped, the
 * proxy refuses writes), so nothing on that host may open one — the timed prompt checks this (signup-prompt.tsx).
 * NEXT_PUBLIC_APP_URL is inlined at build, so it names this deployment's own teacher host (eno.vn or eno.forum).
 */
export function onTeacherHost(): boolean {
  try { return typeof window !== 'undefined' && isTeacherHost(window.location.host, process.env.NEXT_PUBLIC_APP_URL) } catch { return false }
}
