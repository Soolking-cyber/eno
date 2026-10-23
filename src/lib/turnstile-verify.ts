import 'server-only'
import { isProductionEnoHost } from '@/lib/consent-value'

// Server-side Cloudflare Turnstile verification.
//
// Until now the widget's token was only ever handed to Supabase Auth, which verified it
// for us on signInWithOtp. Any endpoint that sends mail or SMS *itself* has to do that
// check on its own — an unverified token is just a string the client made up.
//
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** True once the secret is set — callers can distinguish "unconfigured" from "failed". */
export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim())
}

/**
 * Verify a Turnstile token.
 *
 * Returns true when the token is genuine, AND when the secret isn't configured at all —
 * matching the widget, which renders nothing and resolves `getToken()` to undefined when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset. The two halves must agree: if the widget can't
 * mint a token, a route that demanded one would lock every visitor out of sign-in. That is
 * exactly the failure that took email auth down on 2026-07-19, and it is worse than the
 * spam it would prevent. Configure both halves or neither.
 *
 * Once configured, an absent or invalid token is REJECTED — no fallback, no leniency. The ONE
 * exception is a failure that describes our own request rather than the visitor's answer (a wrong
 * or missing SECRET, a malformed request, a Cloudflare internal error): those allow, loudly, for
 * the reason spelled out at that branch.
 *
 * Pass `requestHost` (the request's Host header): a request that reached a live eno site is accepted only with a token
 * minted on a live eno site — see the check after `success`.
 */
export async function verifyTurnstile(token: string | undefined, ip?: string, requestHost?: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return true // unconfigured — see above
  if (!token) return false

  // ⛔ SHAPE CHECK BEFORE WE CALL CLOUDFLARE (security review 2026-10-22, item 17). A genuine Turnstile
  // token is a bounded string (Cloudflare documents a 2048-char ceiling). A non-string or an oversized
  // one is a forgery — reject it here. Without this, an attacker could hand us a malformed token so that
  // Cloudflare answers `bad-request`, which used to be in the allow-through set below and would have let
  // the request past the bot gate. Validating the shape ourselves also means a `bad-request` from a
  // well-formed request can no longer be blamed on the token, which is why it is no longer allowed through.
  if (typeof token !== 'string' || token.length > 2048) {
    console.warn('[turnstile] rejected — token is not a well-formed string')
    return false
  }

  const body = new URLSearchParams({ secret, response: token })
  // remoteip is optional and advisory; Cloudflare treats a mismatch as a signal, not a
  // hard fail, so a visitor behind a shifting mobile IP isn't punished for it.
  if (ip) body.set('remoteip', ip)

  try {
    // Never let Cloudflare being slow become sign-in being broken: 5s then decide.
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[]; hostname?: string }
    if (!data.success) {
      const codes = data['error-codes'] ?? []
      // ⚠️ A BROKEN SECRET IS OUR FAULT, NOT THE VISITOR'S — AND IT MUST NOT LOCK THEM OUT.
      // This exact failure took email sign-in down for every visitor TWICE (2026-07-19, and again
      // 2026-07-27: 9 `invalid-input-secret` rejections and 15 × HTTP 403 on /api/auth/email-link
      // in one day). Both times the cause was configuration, and both times the code answered by
      // refusing real people.
      //
      // The decisive point is that failing closed here buys NOTHING. When Cloudflare says the
      // secret is invalid it has not checked the visitor at all — the bot protection is already
      // absent — so refusing merely adds an outage on top of a gap that exists either way. Same
      // security, worse service. That is the same reasoning the catch below already applies to an
      // unreachable Cloudflare, and the same reasoning as the unconfigured case above; this branch
      // was simply missed.
      //
      // Codes that describe OUR request, never the visitor's answer. Anything else — an invalid or
      // replayed token, i.e. a real captcha failure — still fails closed.
      // ⚠️ `bad-request` IS NO LONGER HERE (security review 2026-10-22, item 17). It can be provoked by a
      // malformed `response` the client controls, so allowing it through handed an attacker the bypass.
      // The shape check above now rejects a malformed token before we ask Cloudflare, so with a secret set
      // and a bounded string sent, a `bad-request` is Cloudflare judging the ANSWER — a real failure.
      // These three stay: a wrong/absent secret and a Cloudflare internal error are genuinely not the
      // visitor's fault, and failing open on them is the documented fix for the 2026-07 sign-in outages.
      const SERVER_SIDE = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error'])
      if (codes.length > 0 && codes.every((c) => SERVER_SIDE.has(c))) {
        // error, not warn: this is a live misconfiguration that silently disables bot protection.
        console.error('[turnstile] MISCONFIGURED — allowing sign-in; captcha is not protecting anything', codes)
        return true
      }
      // Never log the token itself — it is a single-use credential.
      console.warn('[turnstile] rejected', codes)
      return false
    }
    // ⛔ A TOKEN SPENT ON A LIVE SITE WAS MINTED ON A LIVE SITE (Cloudflare's server-side validation guide: "Validate the
    // action and hostname"). Both editions share one site key, and its hostname allow-list also holds `localhost` for
    // local runs (CLAUDE.md, 2026-08-02) — so anyone can render our widget on their own machine and farm tokens there,
    // and siteverify alone calls them valid. So a request that reached eno.vn, eno.forum or one of their subdomains
    // needs `hostname` to be one of those too (either edition: they are one company). A local run keeps accepting its
    // own localhost tokens. No `hostname` in a success answer is Cloudflare's side, not the visitor's — allowed, loudly,
    // for the outage reasoning above.
    if (isProductionEnoHost(requestHost)) {
      if (!data.hostname) console.error('[turnstile] success without a hostname — not checked')
      else if (!isProductionEnoHost(data.hostname)) {
        console.warn('[turnstile] rejected — token minted on another site', data.hostname)
        return false
      }
    }
    return true
  } catch (e) {
    // Timeout or network failure. FAIL OPEN: the alternative is that a Cloudflare blip
    // locks everyone out of their account. The rate limiter downstream is the backstop
    // that keeps this from being an open relay.
    console.error('[turnstile] verify unreachable — allowing', e)
    return true
  }
}
