/**
 * Sanitize a ?next= redirect target to a SAME-ORIGIN, root-relative path.
 *
 * A string-prefix check ("starts with / and not //") is NOT enough: the WHATWG
 * URL parser normalizes tricks like "/\evil.com" or "/\t/evil.com" to an
 * EXTERNAL origin, which a router/redirect would then navigate to (open
 * redirect). We resolve the candidate against the app origin and accept it only
 * when the resolved origin matches; otherwise we fall back to "/".
 *
 * Used by every post-auth redirect: the /signin page, /onboard, and the
 * server-side /auth/callback. `origin` must be a real origin string
 * (window.location.origin on the client; the request origin on the server).
 */
export function safeNextPath(raw: string | null | undefined, origin: string): string {
  if (!raw) return '/'
  try {
    const u = new URL(raw, origin)
    if (u.origin !== origin) return '/'
    const path = u.pathname + u.search + u.hash
    if (!path.startsWith('/')) return '/'
    // Reject post-auth CONTROL routes as a destination. Following /signin, /auth/* or /onboard as
    // `next` bounces the user straight back into the auth flow — a redirect loop the reporter hit.
    // These are interstitials, never a place to "return to"; fall back to home.
    if (/^\/(signin|auth|onboard)(\/|$)/.test(u.pathname)) return '/'
    return path
  } catch {
    return '/'
  }
}
