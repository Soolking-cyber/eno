import { NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { sendZnsOtp, znsConfigured } from '@/lib/zalo-zns'
import { sendTelegramOtp, sendWhatsAppOtp, telegramConfigured, whatsappConfigured, normalizePhoneVN, preferredOtpChannel, type OtpChannel } from '@/lib/otp-channels'
import { rateLimit, escalatingCooldown, kv } from '@/lib/ratelimit'

// Supabase "Send SMS Hook". Supabase generates, rate-limits and verifies the
// phone OTP natively (signInWithOtp/verifyOtp unchanged); this endpoint only
// DELIVERS the code.
//
// ⚠️ ROUTED BY THE NUMBER'S COUNTRY (owner, 2026-08-02), not cheapest-first as it was from
// 2026-07-06. The country code picks who goes FIRST; everything else still cascades behind it:
//
//   VN number (+84)  → Zalo ZNS · then Telegram · then WhatsApp
//   foreign number   → WhatsApp · then Telegram · then Zalo
//
// ⚠️ THERE IS NO SMS FALLBACK ANY MORE (owner, 2026-08-02: "remove speed sms from both"). SpeedSMS
// was the floor — the only channel needing no app installed — so a recipient with none of Zalo,
// WhatsApp or Telegram can no longer receive a code AT ALL. Delivery failure is now a dead end
// rather than a slower path, which is why the sign-in form warns BEFORE the send (channelHint()).
// Costs per OTP, still the tiebreak among non-preferred channels: Telegram ~260đ (free presence
// check, undelivered auto-refunds) · WhatsApp ~294đ · Zalo ZNS 300đ.
//
// Every channel is env-gated and DORMANT until its keys exist, so this ordering is inert today and
// starts working the moment a key is added. See preferredOtpChannel() in lib/otp-channels.ts.
//
// ABUSE POSTURE (Vietnam is an SMS-pumping hotspot):
//  - Cloudflare Turnstile gates the SEND upstream: Supabase auth enforces the
//    captcha on signInWithOtp before this hook ever fires (sign-in-form passes
//    the token; enabled in the Supabase dashboard 2026-07-05).
//  - Standard Webhooks HMAC is the only auth on this public route — verify
//    every request.
//  - Per-NUMBER escalating cooldown (60s → 5m → 15m → 30m cap — the Twilio/
//    Auth0-recommended resend pattern) + 8 sends/day hard cap: a real user
//    retries once or twice; a script hammers. Violations 429 with a visible
//    wait time so the user knows to wait, not mash resend.
//  - Per-PREFIX limiter throttles pumping runs across a number range (many
//    numbers, one carrier block) that per-number limits can't see, plus a
//    global daily breaker caps worst-case spend. All limits fail CLOSED.
//  - NEVER log the OTP.
// Docs: https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook

export const runtime = 'nodejs' // standardwebhooks needs Node crypto, not edge
export const dynamic = 'force-dynamic'

const HOOK_SECRET = process.env.SEND_SMS_HOOK_SECRET // form: "v1,whsec_<base64>"

// ⚠️ WS6 — NOT MIGRATED: this is a Supabase webhook, not a first-party route, and it fails every
// assumption the wrapper is built on.
//   · AUTH IS AN HMAC OVER THE RAW BODY, AND IT MUST RUN FIRST. `wh.verify(await req.text(), headers)`
//     needs the exact bytes — "do NOT parse then re-stringify". `body:` would call `req.json()` on the
//     same stream, and the wrapper has no auth mode that means "verify a signature".
//   · A MISSING SECRET IS A 500 BEFORE ANY OF THAT: `{"error":"Not configured"}` 500.
//   · THE ERROR STRINGS ARE PROSE, NOT CODES. `{"error":"Invalid signature"}` 401,
//     `{"error":"Missing phone/otp"}` 400 — neither is an `ApiErrorCode`, and both are read by
//     Supabase's hook plumbing rather than by our client.
//   · THE COOLDOWN 429 IS A NESTED OBJECT: `{"error":{"http_code":429,"message":"Please wait 60s
//     before requesting another code."}}` — Supabase surfaces `message` to the sign-in form verbatim.
//     `apiFail()` emits a bare string under `error` and cannot produce this.
//   · FOUR THROTTLES, NONE OF THEM EXPRESSIBLE. `escalatingCooldown('otp-send', …)` is not
//     `rateLimit()` at all, and then `otp-number` / `otp-prefix` / `otp-global` must ALL pass
//     (`rateLimit:` takes one bucket). Their keys — `phone`, `phone.slice(0, 6)` — come from the
//     SIGNED payload, which does not exist until after step 2.
//   · TRIPPING THOSE BREAKERS RETURNS `{}` AT 200, not a 429: "swallow the delivery, return 200
//     (Supabase keeps the code)". A 429 there would abort a real user's login.
export async function POST(req: Request) {
  if (!HOOK_SECRET) {
    console.error('[send-sms] SEND_SMS_HOOK_SECRET not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  // 1) Read the RAW body — required for HMAC (do NOT parse then re-stringify).
  const raw = await req.text()
  const headers = Object.fromEntries(req.headers)

  // 2) Verify the Standard Webhooks signature — the only auth on this public route.
  let payload: { user: { phone: string }; sms: { otp: string } }
  try {
    const wh = new Webhook(HOOK_SECRET.replace('v1,whsec_', ''))
    payload = wh.verify(raw, headers) as typeof payload
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const phone = normalizePhoneVN(payload.user?.phone || '')
  const otp = String(payload.sms?.otp || '')
  const requestId = headers['webhook-id'] || phone // correlation/idempotency key
  if (!phone || !otp) return NextResponse.json({ error: 'Missing phone/otp' }, { status: 400 })

  // 3) Per-number escalating cooldown — the send that clears each gate arms
  //    the next one: 1st send → 60s, 2nd → 5m, 3rd → 15m, 4th+ → 30m (counter
  //    resets after 24h quiet). Unlike the silent breakers below, a cooldown
  //    hit returns a 429 whose message Supabase surfaces to the sign-in form,
  //    so a legit user sees HOW LONG to wait instead of a dead resend button.
  const cd = await escalatingCooldown('otp-send', phone, [60, 300, 900, 1800])
  if (!cd.allowed) {
    const wait = cd.retryAfterSec < 120 ? `${cd.retryAfterSec}s` : `${Math.ceil(cd.retryAfterSec / 60)} min`
    return NextResponse.json(
      { error: { http_code: 429, message: `Please wait ${wait} before requesting another code.` } },
      { status: 429 },
    )
  }

  // 4) Pumping breakers (fail CLOSED — a Redis blip must not open the wallet):
  //    ≤8 sends/day per number, ≤20 sends/hour per 6-digit prefix (a prefix is
  //    a ~10k-number carrier block shared by many users — this catches runs
  //    across MANY numbers that per-number limits can't see) and ≤2,000
  //    sends/day globally. On trip: swallow the delivery, return 200 (Supabase
  //    keeps the code; a real user retries later), and log loudly.
  const [numberGate, prefixGate, globalGate] = await Promise.all([
    rateLimit('otp-number', phone, 8, '1 d', { strict: true }),
    rateLimit('otp-prefix', phone.slice(0, 6), 20, '1 h', { strict: true }),
    rateLimit('otp-global', 'all', 2000, '1 d', { strict: true }),
  ])
  if (!numberGate.success || !prefixGate.success || !globalGate.success) {
    console.error('[send-sms] pumping breaker tripped', { prefix: phone.slice(0, 6), number: !numberGate.success, global: !globalGate.success })
    return NextResponse.json({}, { status: 200 })
  }

  // 5) Deliver — the channel the NUMBER'S OWN COUNTRY actually uses goes first, then everything
  //    else cascades behind it. `noApp` means "this number doesn't have that app": move on, don't
  //    retry.
  //
  // ⚠️ ORDERED BY ORIGIN, NOT BY PRICE (owner, 2026-08-02: "zalo otp for local phone numbers and
  // whatsapp otp for foreign numbers"). It was a flat cheapest-first list —
  // Telegram → WhatsApp → Zalo → SMS for every number — so a Vietnamese user got their code on
  // Telegram or WhatsApp whenever those were configured and reached Zalo only if both failed. Zalo
  // is where a Vietnamese phone actually lives; for the expat audience WhatsApp is. And Zalo is
  // Vietnam-only, so trying it on a foreign number spends a request to learn what the country code
  // already said.
  //
  // ⚠️ THE PREFERENCE IS AN ORDERING, NOT A RESTRICTION. Every other configured channel is still
  // attempted behind it, so an unconfigured or failing preferred channel degrades rather than
  // dead-ends — which is what makes this safe to ship BEFORE the keys exist. With no keys set every
  // channel is unconfigured and nothing is delivered — there is no SMS floor left to catch it.
  let channel: OtpChannel | null = null

  const tryZalo = async () => {
    if (channel || !znsConfigured()) return
    const zns = await sendZnsOtp(phone, otp, requestId)
    if (zns.ok) channel = 'zalo'
    else if (zns.noZalo) console.warn('[send-sms] no Zalo on number — falling through')
  }
  const tryWhatsApp = async () => {
    if (channel || !whatsappConfigured()) return
    if ((await sendWhatsAppOtp(phone, otp)).ok) channel = 'whatsapp'
  }
  const tryTelegram = async () => {
    if (channel || !telegramConfigured()) return
    if ((await sendTelegramOtp(phone, otp)).ok) channel = 'telegram'
  }

  // Preferred first; the remainder keeps the old cheapest-first order.
  if (preferredOtpChannel(phone) === 'zalo') {
    await tryZalo()
    await tryTelegram()
    await tryWhatsApp()
  } else {
    await tryWhatsApp()
    await tryTelegram()
    await tryZalo()
  }
  const delivered = channel !== null

  // Remember WHERE the code landed so the sign-in form can say "check your
  // Telegram" instead of "check everywhere" (read back by /api/auth/otp-channel).
  // Best-effort: a kv blip only degrades the copy, never the login.
  if (channel) {
    try { await kv.set(`otp-ch:${phone}`, channel, { ex: 600 }) } catch {}
  }

  // 6) Return 200 even on a transient delivery hiccup: Supabase already stored
  //    the code and the user can resend — a non-200 would ABORT their login. We
  //    log (without the OTP) so a silent provider outage is still noticed.
  // ⚠️ PREFIX ONLY — this line logged the FULL number until 2026-08-05, sixty lines after :98 got
  // it right with the same `phone.slice(0, 6)`. It is also the line that fires most during a
  // provider outage, so the failure mode was: the worse the incident, the more complete the dump of
  // subscriber phone numbers into Cloud Logging, where retention outlives the incident. Six digits
  // (+84 plus the operator prefix) is enough to see WHICH carrier prefix is failing, which is the
  // operational question here; identifying an individual is not. (An external review of this change
  // rightly flagged an earlier version of this comment for claiming the prefix distinguishes
  // ESMS/Telegram/WhatsApp — it does not: this line records no channel at all, only that every
  // channel failed. `channel` above is the one that carries delivery routing.)
  if (!delivered) console.error('[send-sms] all channels failed', { prefix: phone.slice(0, 6) })

  /**
   * ⛔⛔ THE CODE IS ALSO WRITTEN INTO THE CALLER'S SUPPORT THREAD. THIS IS A SECURITY TRADE THE
   * OWNER MADE WITH THE FACTS IN FRONT OF THEM — NOT AN OVERSIGHT, AND NOT A PATTERN TO COPY.
   *
   * What it costs: a login code becomes a MESSAGE. Anyone who can open that thread can read it,
   * and /admin/support lists every support thread to every ADMIN_EMAILS address. The rest of this
   * codebase separates the two deliberately — src/lib/whatsapp.ts:12 says merging them "would put
   * a login secret through a relay that writes into a readable conversation" — so this is that
   * file's stated hazard, accepted knowingly rather than walked into.
   *
   * Why it is defensible TODAY: ADMIN_EMAILS on the box is `support@eno.forum` and nothing else
   * (measured 2026-09-09 on BOTH containers), so the only person who can read the thread is the
   * only person the code is for. It exists because a WhatsApp Cloud API number cannot receive —
   * a number registered to the API has no consumer inbox — so the owner had no way to complete a
   * phone sign-in at all.
   *
   * ⚠️ THE FLAG IS THE EXIT, AND IT MUST BE TURNED OFF THE DAY A SECOND OPERATOR IS ADDED.
   * `OTP_TO_SUPPORT_THREAD` is opt-in and unset everywhere by default, so this path does not exist
   * for any deployment that has not deliberately switched it on. Adding one address to
   * ADMIN_EMAILS silently turns "the owner reads their own code" into "a colleague reads yours",
   * and no check here can notice that for you.
   *
   * ⚠️ AFTER the delivery attempt, in its own try/catch, and never fatal: a thread write must not
   * be able to fail a login, and this route must keep returning 200 whatever happens.
   */
  if (process.env.OTP_TO_SUPPORT_THREAD === 'true') {
    try {
      const { db } = await import('@/lib/db')
      const { getOrCreateSupportThread } = await import('@/lib/support-thread')
      const { insertMessage } = await import('@/lib/messages')
      const { isAdminEmail } = await import('@/lib/admin')
      const profile = await db.profile.findUnique({ where: { phone }, select: { id: true, email: true } })
      /**
       * ⛔ THE OWNER'S OWN CODE, AND NOBODY ELSE'S — THE FLAG ALONE WAS NOT THE SCOPE, AND ALL FOUR
       * REVIEWERS SAID SO INDEPENDENTLY. The justification for this path is "the only person who
       * can read the thread is the person the code is for". An unscoped flag does not say that: it
       * copies EVERY user's code into a thread /admin/support shows to every ADMIN_EMAILS address,
       * and under passwordless auth the OTP *is* the credential — so it is an admin-to-any-account
       * takeover, which is a different and much larger trade than the one that was agreed.
       * Requiring the RECIPIENT to be an admin makes the comment above true of the code below.
       */
      if (profile && isAdminEmail(profile.email)) {
        const thread = await getOrCreateSupportThread(db, profile.id)
        await insertMessage(
          { id: thread.id, buyerProfileId: profile.id, sellerProfileId: null, listingId: null },
          profile.id,
          `eno sign-in code: ${otp}`,
        )
      }
    } catch (e) {
      // Never surfaced, never fatal — every configured channel has already been tried above.
      console.error('[send-sms] support-thread copy failed', (e as Error).name)
    }
  }

  return NextResponse.json({}, { status: 200 })
}
