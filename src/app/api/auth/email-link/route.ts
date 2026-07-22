import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { verifyTurnstile } from '@/lib/turnstile-verify'
import { rateLimit, escalatingCooldown } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { safeNextPath } from '@/lib/url'
import { canonicalEmail } from '@/lib/email-alias'
import { sendMail } from '@/lib/mail'
import { renderSignInEmail } from '@/lib/emails/sign-in-link'
import { renderSignInCodeEmail } from '@/lib/emails/sign-in-code'

// Magic-link sender — eno.vn's own, replacing supabase.auth.signInWithOtp({ email }).
//
// WHY WE LEFT SUPABASE'S SMTP. `signInWithOtp` asks Supabase to compose AND deliver the
// email over SMTP credentials stored in its dashboard. On 2026-07-19 a Resend key
// rotation invalidated those credentials and every email sign-in and signup began failing
// with `535 "Authentication credentials invalid"` — silently, from the visitor's side:
// the request returned 200 and no mail ever arrived. Three days of blocked signups.
//
// `admin.generateLink` mints exactly the same token but does NOT send anything, so
// delivery becomes ours: the Resend path the rest of the app already uses, the brand
// shell every other email already renders through, and failures that show up in OUR logs
// instead of inside a service whose config the repo cannot read.
//
// WHAT MOVED HERE AS A RESULT. Supabase was also enforcing two things on that endpoint
// that now have no owner unless this route takes them:
//   · the Turnstile captcha (verifyTurnstile — the token was previously checked by
//     Supabase Auth, never by us);
//   · send rate limits. Both are below, keyed per-email AND per-IP, because this route
//     spends real money per call and mails an address the caller chose.
//
// ENUMERATION. Every outcome returns the same 200 `{ ok: true }`, and — because minting
// takes exactly ONE upstream call whether or not the account exists — the same shape of
// work, so the response time doesn't leak what the status code won't. (An earlier draft
// tried magiclink then fell back to signup; that second call would have made a
// nonexistent address measurably slower than a real one.) Whether an address has
// an account is not something an unauthenticated caller gets to learn, so "sent",
// "already exists", and "generate failed" are indistinguishable from outside.

export const runtime = 'nodejs' // supabase-js admin + Resend, not edge
export const dynamic = 'force-dynamic'

// Deliberately generous vs. the SMS ladder (60s → 5m → 15m → 30m): email costs a
// fraction of an SMS and has no toll-fraud analogue, and the commonest real reason to
// press resend is a slow inbox. Still escalating, so a script can't loop it.
const RESEND_STEPS_SEC = [30, 60, 300, 900]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(req: Request) {
  let body: { email?: string; captchaToken?: string; next?: string; lang?: string; deliver?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const typed = String(body.email || '').trim().toLowerCase()
  if (!typed || typed.length > 254 || !EMAIL_RE.test(typed)) {
    // A malformed address is the caller's own input — safe to name, and useful.
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  // Resolve mail-routing aliases to the one account they physically share, BEFORE the
  // address is used for anything: rate limiting, minting, or delivery. Signing in as
  // support@eno.vn must land in the support@eno.forum account, not create a twin.
  const email = canonicalEmail(typed)

  const ip = clientIp(req)

  // 1) Captcha. Fails CLOSED once configured (see turnstile-verify for why an
  //    unconfigured secret deliberately allows).
  if (!(await verifyTurnstile(body.captchaToken, ip))) {
    return NextResponse.json({ error: 'captcha_failed' }, { status: 403 })
  }

  // 2) Per-IP ceiling first — it's the limit an attacker can't shed by varying the
  //    address, and checking it before the cooldown means a spray across many emails
  //    doesn't get a fresh cooldown slot for each one. strict: a limiter outage denies.
  const ipLimit = await rateLimit('auth-email-ip', ip, 12, '1 h', { strict: true })
  if (!ipLimit.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // 3) Per-address escalating cooldown — protects the OWNER of the address from being
  //    mail-bombed by someone else typing it in, which per-IP limits cannot see.
  const cooldown = await escalatingCooldown('auth-email-send', cooldownKey(email), RESEND_STEPS_SEC)
  if (!cooldown.allowed) {
    return NextResponse.json(
      { error: 'cooldown', retryAfterSec: cooldown.retryAfterSec },
      { status: 429, headers: { 'retry-after': String(cooldown.retryAfterSec) } },
    )
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
  // `next` is where the visitor resumes after signing in. It arrives from the client, so
  // it goes through the same same-origin guard /auth/callback uses — an open redirect
  // here would hand the freshly-minted session to whoever crafted the link.
  const next = safeNextPath(body.next, origin)

  // WHICH ARTEFACT TO DELIVER. Declared AFTER every guard above so this branch can never
  // reorder or skip one — captcha, the per-IP ceiling and the per-address cooldown are
  // deliberately SHARED by both modes. Forking their keys would hand an attacker two
  // independent budgets per address.
  //
  // ⚠️ ONE OR THE OTHER, NEVER BOTH. The link and the code are the same GoTrue token
  // (measured: consuming hashed_token makes email_otp return otp_expired), so an email
  // containing both lets a corporate link-prefetcher burn the code the user is typing.
  //
  // The CLIENT decides, via a body flag, and that is correct rather than lazy: the same
  // predicate that sets it also chooses which screen to render. If the server sniffed the
  // UA and disagreed, the user would face a code entry box with only a link in their inbox
  // — a dead end. Spoofing it is not interesting: it only causes the address's OWN inbox to
  // receive a single-use 8-digit token instead of a longer one, at the same rate limit,
  // and the caller could already trigger the send either way.
  const wantCode = body.deliver === 'code'

  const admin = getSupabaseAdmin()

  // 4) Mint the token. ONE call handles both cases: verified against this project on
  //    2026-07-22, `generateLink({ type: 'magiclink' })` succeeds for an address with no
  //    account and creates it — the same implicit behaviour signInWithOtp had via its
  //    `shouldCreateUser: true` default. It also succeeds for an existing account that
  //    hasn't confirmed yet, which is the ordinary "signed up, didn't click, tried again"
  //    path and must never dead-end.
  //
  //    ⚠️ Do NOT add a 'signup' fallback here. It cannot help — magiclink does not error
  //    for a missing user, so the branch would be unreachable — and if it ever did run it
  //    would fail anyway: this project enforces a password-complexity policy, so the
  //    random password such a call must supply is rejected as `weak_password`, and the
  //    user would get nothing.
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) {
    console.error('[auth/email-link] generateLink failed', error.message)
    return NextResponse.json({ ok: true }) // generic 200: see ENUMERATION above
  }

  const hashedToken = data.properties?.hashed_token
  // The 8-digit code. ⚠️ A STRING with meaningful leading zeros (observed 00730251) —
  // never coerce it through Number().
  const emailOtp = data.properties?.email_otp
  // ⚠️ The type is whatever Supabase says it is, NEVER a hardcoded 'magiclink'. A token
  // minted for a new or unconfirmed account comes back as `signup`, and verifyOtp rejects
  // a token presented under the wrong type — which would break sign-in for exactly the
  // first-time users this is most important for.
  const verifyType = data.properties?.verification_type
  if (!verifyType || (wantCode ? !emailOtp : !hashedToken)) {
    console.error('[auth/email-link] generateLink returned no usable token for mode', wantCode ? 'code' : 'link')
    return NextResponse.json({ ok: true })
  }

  // The link points at OUR /auth/confirm, not Supabase's /auth/v1/verify — see the header
  // of that route for why the hosted hop cannot work for a server-minted token.
  const actionLink = wantCode
    ? null
    : `${origin}/auth/confirm?${new URLSearchParams({ token_hash: hashedToken!, type: verifyType, next }).toString()}`

  // 5) Deliver it ourselves.
  // 'signup' means this address had no account and one is being created. The HTTP
  // response stays identical either way (enumeration), but the EMAIL says which —
  // it only reaches the inbox owner, and a mistyped address must be visible BEFORE
  // someone finishes onboarding into a ghost profile.
  const lang = body.lang === 'vi' ? 'vi' : 'en'
  const mode = verifyType === 'signup' ? 'signup' : 'signin'
  const { subject, html, text } = wantCode
    ? renderSignInCodeEmail({ code: emailOtp!, origin, email, lang, mode })
    : renderSignInEmail({ url: actionLink!, origin, email, lang, mode })
  const sent = await sendMail({ to: email, subject, html, text })
  if (!sent) {
    // sendMail already logged the reason. This is the failure mode that was invisible
    // before — now it's a 502 the form can actually tell the user about, instead of a
    // success screen in front of an inbox that will stay empty.
    return NextResponse.json({ error: 'send_failed' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}

/**
 * The key the per-address cooldown counts against.
 *
 * Rate-limiting the raw string is trivially defeated: `victim+1@`, `victim+2@` … are
 * distinct keys that all land in ONE inbox, so an attacker gets a fresh cooldown per
 * variant while the victim gets every message. Strip the +tag, and Gmail's ignored dots,
 * so all of them collapse to the same bucket.
 *
 * This is ONLY ever a limiter key — mail is still sent to the address exactly as typed,
 * because subaddressing is a legitimate feature and the recipient chose it.
 */
function cooldownKey(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  let local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  if (domain === 'gmail.com' || domain === 'googlemail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}
