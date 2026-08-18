/**
 * CLEAR ABANDONED PKCE FLOWS BEFORE STARTING A NEW ONE.
 *
 * ⛔ WHAT WAS MEASURED (2026-08-18, headless Chromium against a production build). Starting Google
 * sign-in three times and abandoning each — which is what a visitor does when the tab is slow, or
 * they hit back, or they change their mind — leaves this behind:
 *
 *   start 1  flows index ["3b8ee5…"]                    legacy …-code-verifier = fd637a…
 *   start 2  flows index ["3b8ee5…","cde94e…"]          legacy …-code-verifier = 3be4df…
 *   start 3  flows index ["3b8ee5…","cde94e…","683e88…"] legacy …-code-verifier = 69a1fa…
 *
 * Two separate problems in that table:
 *
 * ⚠️ 1. THE COOKIES ACCUMULATE FOREVER. Every abandoned attempt adds a permanent
 * `sb-<ref>-auth-token-flow-<id>-code-verifier` cookie (~159 bytes) plus an entry in the index, and
 * NOTHING removes them — not a later success, not a sign-out. Cookies are sent on every request to
 * the origin, so this is a request header that only grows. Far enough along that is a 431 and the
 * site stops answering for that visitor, which is a much bigger failure than a bad login.
 *
 * ⚠️ 2. THE LEGACY SINGLE KEY IS OVERWRITTEN EACH TIME while the per-flow cookies survive, so the
 * stored verifiers disagree with each other. Supabase's own auth log recorded the matching failure
 * in production on 2026-08-18T01:45:54Z:
 *     400: code challenge does not match previously saved code verifier
 * which is the server exchanging a code against the wrong verifier — the shape of the owner's
 * report that the first attempt does not sign in and a second one does.
 *
 * ⚠️ HOW HONEST TO BE ABOUT THE LINK: the accumulation and the overwrite are MEASURED, and the
 * mismatch error is MEASURED in production. That completing a specific stale flow is what produced
 * that specific log line is INFERRED, not proven — proving it needs the callback logging added in
 * the same batch as this, running in production. This function is worth having either way, because
 * problem 1 above is a defect on its own.
 *
 * ⚠️ WHY CLEARING IS SAFE AT THIS MOMENT AND NOT AT ANY OTHER. It runs immediately before starting a
 * NEW flow, and a visitor can only complete one. Clearing here is exactly what the old single-key
 * behaviour did implicitly by overwriting. It is NOT safe to call at page load or on sign-out: a
 * verifier written seconds ago belongs to a flow that is mid-round-trip at Google, and deleting it
 * would break the sign-in that is actually happening.
 *
 * ⚠️ TWO TABS ARE THE KNOWN LIMIT, and it is not a regression. If a visitor starts OAuth in tab A
 * and then in tab B, tab A's flow dies — but it dies today too, because the legacy key is
 * overwritten. This does not fix that case; it stops the debris.
 */

/** Every cookie @supabase/ssr uses to hold a PKCE verifier, per-flow and legacy alike. */
const VERIFIER_RE = /^sb-.*-code-verifier$/

/**
 * Delete the browser's stored PKCE verifier cookies.
 *
 * ⚠️ EXPIRY *AND* Max-Age, AND THE PATH MUST MATCH. A cookie is deleted by writing it back with an
 * elapsed expiry on the SAME path it was set with — @supabase/ssr writes `path=/`, so anything else
 * silently creates a second cookie instead of removing the first, and the stale value keeps being
 * sent. Both attributes are written because the two have different browser support histories and
 * one of them costs nothing.
 *
 * Returns how many it cleared, which is what the test asserts on.
 */
export function clearStalePkceCookies(): number {
  if (typeof document === 'undefined') return 0
  let cleared = 0
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (!name || !VERIFIER_RE.test(name)) continue
    document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`
    cleared += 1
  }
  return cleared
}
