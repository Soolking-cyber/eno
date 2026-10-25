import { storefrontBaseHost } from '@/lib/storefront-host'
import { CLASSROOM_PATH, CLASSROOM_SUBDOMAIN } from './constants'

/**
 * classroom.<base> — the ADDRESS of eno Classroom, not a second site (owner, 2026-10-25: "new app at classroom.eno.vn").
 * Every page path 302s to the app origin's /classroom with the path and query kept — the schools.<base> pattern
 * (src/lib/schools/host.ts). Import-light: the proxy runs on the edge. `base` follows storefrontBaseHost, so `www.` is
 * stripped exactly as for storefronts, teacher.<base> and schools.<base>.
 *
 * ⚠️ WHY A REDIRECT AND NOT A REWRITE (plan review, Opus 2026-10-25): teachers and parents need their eno.vn session, and
 * the session cookie is HOST-SCOPED. Serving the app on the subdomain means a second sign-in that touches seven places
 * (the sign-in form, the callback, confirm, the email link, the in-app-browser handoff, Google OAuth's host list and its
 * Cloud redirect URIs), the write guard and the providers' chrome. Until the owner wants the address bar to stay on the
 * subdomain, the name 302s (not 301 — the decision may change).
 */
export function classroomHost(appUrl: string | null | undefined): string {
  const base = storefrontBaseHost(appUrl)
  return base ? `${CLASSROOM_SUBDOMAIN}.${base}` : ''
}

/** Is this Host header the classroom host? Port and case are ignored. */
export function isClassroomHost(hostHeader: string | null | undefined, appUrl: string | null | undefined): boolean {
  const want = classroomHost(appUrl)
  if (!want || !hostHeader) return false
  return hostHeader.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '') === want // a fully-qualified "classroom.eno.vn." too
}

/**
 * The app-origin path for classroom.<base><pathname><search>: `/` → `/classroom`, `/join/x` → `/classroom/join/x`. A path
 * that already starts with /classroom is kept as it is (a link someone built by hand), never doubled.
 * ⚠️ CONCATENATED, NEVER new URL(path, base): `//evil.example` resolved against a base leaves our domain.
 */
export function classroomRedirectPath(pathname: string, search: string): string {
  const clean = `/${pathname.replace(/^\/+/, '').replace(/\/+$/, '')}`
  // ⛔ NO WAY OUT OF /classroom (rounds 4–5, codex + opus): a dot segment ("/join/../../visa", plain or %2e) or a backslash
  // (a URL parser reads "\" as "/") would leave it once resolved. classroomRedirectUrl also checks the PARSED result.
  if (clean.includes('\\') || clean.split('/').some((seg) => /^(?:\.|%2e){1,2}$/i.test(seg))) return CLASSROOM_PATH
  if (clean === CLASSROOM_PATH || clean.startsWith(`${CLASSROOM_PATH}/`)) return `${clean}${search}`
  return `${CLASSROOM_PATH}${clean === '/' ? '' : clean}${search}`
}

/** Where classroom.<base><path><query> goes: the app's own origin (www kept when the app uses it) + /classroom…. */
export function classroomRedirectUrl(appUrl: string | null | undefined, pathname: string, search: string): string | null {
  if (!appUrl) return null
  try {
    const origin = new URL(appUrl).origin
    // The parser has the last word: whatever the path became once resolved, it must still be /classroom on our origin.
    const url = new URL(`${origin}${classroomRedirectPath(pathname, search)}`)
    return url.origin === origin && isClassroomPath(url.pathname) ? url.toString() : `${origin}${CLASSROOM_PATH}`
  } catch {
    return null
  }
}

/** The public address teachers share and print: https://classroom.<base> (the app URL's scheme). */
export function classroomAddress(appUrl: string | null | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  const host = classroomHost(appUrl)
  if (!host || !appUrl) return CLASSROOM_PATH
  try { return `${new URL(appUrl).protocol}//${host}` } catch { return CLASSROOM_PATH }
}

/** Is this PUBLIC path (no /en|/vi prefix) a classroom page? Whole segment: /classroom and /classroom/…, never /classrooms. */
export function isClassroomPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return pathname === CLASSROOM_PATH || pathname.startsWith(`${CLASSROOM_PATH}/`)
}
