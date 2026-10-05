import { storefrontBaseHost } from '@/lib/storefront-host'
import { SCHOOLS_SUBDOMAIN } from './constants'
import { schoolsRedirectPath } from './logic'

/**
 * schools.<base> — a memorable NAME for /schools, not a second site (owner, 2026-10-04: "push it under
 * schools.eno.vn"). Import-light: the proxy runs on the edge. `base` follows storefrontBaseHost, so
 * `www.` is stripped exactly as for storefronts and teacher.<base>.
 *
 * ⚠️ WHY A REDIRECT AND NOT A REWRITE: voting and reviewing need the eno.vn session, and the session
 * cookie is HOST-SCOPED, so on schools.eno.vn every visitor would be signed out and every write would
 * fail the canonical-origin guard. Serving the feature there is a cookie-domain project (owner call);
 * until then the name 302s (not 301 — the decision may change) to the app origin.
 */
export function schoolsHost(appUrl: string | null | undefined): string {
  const base = storefrontBaseHost(appUrl)
  return base ? `${SCHOOLS_SUBDOMAIN}.${base}` : ''
}

/** Is this Host header the schools host? Port and case are ignored. */
export function isSchoolsHost(hostHeader: string | null | undefined, appUrl: string | null | undefined): boolean {
  const want = schoolsHost(appUrl)
  if (!want || !hostHeader) return false
  return hostHeader.toLowerCase().replace(/:\d+$/, '') === want
}

/** Where schools.<base><path><query> goes: the app's own origin (www kept when the app uses it) + /schools…. */
export function schoolsRedirectUrl(appUrl: string | null | undefined, pathname: string, search: string): string | null {
  if (!appUrl) return null
  try {
    return `${new URL(appUrl).origin}${schoolsRedirectPath(pathname, search)}`
  } catch {
    return null
  }
}
