import { resumesInPlace } from '@/lib/onboarding-gate'

// Where a sign-in LANDS, as pure functions (no server imports, so routes and their tests share them): the pathname of a
// `next`, and the landing of a failed sign-in. finishSignInPath (auth-finish.ts) owns the successful one.

/** The pathname of a sanitized same-origin `next` (query and hash dropped); '' when it cannot be parsed. */
export function nextPathname(next: string): string {
  try { return new URL(next, 'http://next.invalid').pathname } catch { return '' }
}

/** `next` cut into path, query and hash AS WRITTEN — never re-resolved, so a path is handed back byte for byte. */
function splitNext(next: string): { path: string; query: string; hash: string } {
  const h = next.indexOf('#')
  const hash = h >= 0 ? next.slice(h) : ''
  const rest = h >= 0 ? next.slice(0, h) : next
  const q = rest.indexOf('?')
  return { path: q >= 0 ? rest.slice(0, q) : rest, query: q >= 0 ? rest.slice(q + 1) : '', hash }
}
/**
 * ⛔ Only the QUERY is edited: re-resolving the path through the URL parser could turn "/a/..//evil.com" into the
 * protocol-relative "//evil.com" (commit gate, opus 2026-10-11). safeNextPath refuses those; this refuses them again.
 */
function joinNext(path: string, params: URLSearchParams, hash: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return '/'
  const qs = params.toString()
  return `${path}${qs ? `?${qs}` : ''}${hash}`
}

/**
 * Where a FAILED sign-in lands: the home page with `?auth_error=<kind>` (the global AuthErrorToast reads it on any page)
 * — except for a page that keeps its place (onboarding-gate.ts resumesInPlace), which gets its failure back on itself, so
 * a refused Apple or Google sign-in from the teacher form never throws the form away. `next` must already be sanitized.
 */
export function authFailurePath(next: string, kind: string): string {
  if (!resumesInPlace(nextPathname(next))) return `/?auth_error=${encodeURIComponent(kind)}`
  const { path, query, hash } = splitNext(next)
  const params = new URLSearchParams(query)
  params.set('auth_error', kind)
  return joinNext(path, params, hash)
}

/**
 * A SUCCESSFUL landing never carries an earlier failure's `?auth_error=` (a retry started from a page that still showed
 * one would land on it and toast the old error over a sign-in that worked). Everything else in `next` is kept.
 */
export function withoutAuthError(next: string): string {
  if (!next.includes('auth_error')) return next
  const { path, query, hash } = splitNext(next)
  const params = new URLSearchParams(query)
  params.delete('auth_error')
  return joinNext(path, params, hash)
}
