import { NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { sendZnsOtp, znsConfigured } from '@/lib/zalo-zns'
import { sendTelegramOtp, sendWhatsAppOtp, sendSpeedSmsOtp, telegramConfigured, whatsappConfigured, normalizePhoneVN } from '@/lib/otp-channels'
import { rateLimit, escalatingCooldown, getRedis } from '@/lib/ratelimit'

// Supabase "Send SMS Hook". Supabase generates, rate-limits and verifies the
// phone OTP natively (signInWithOtp/verifyOtp unchanged); this endpoint only
// DELIVERS the code, cascading cheapest-first (user decision 2026-07-06):
//
//   1. Telegram Gateway (~260đ; free presence check, undelivered auto-refunds)
//   2. WhatsApp auth template (~294đ; expats)
//   3. Zalo ZNS (300đ; enables itself once the OA is verified post-registry)
//   4. SpeedSMS "Verify" shared brandname (~500đ; reaches EVERY VN number)
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

  // 5) Deliver — cheapest channel that can reach this number wins. `noApp`
  //    means "this number doesn't have that app": cascade, don't retry.
  let channel: 'telegram' | 'whatsapp' | 'zalo' | 'sms' | null = null
  if (telegramConfigured()) {
    if ((await sendTelegramOtp(phone, otp)).ok) channel = 'telegram'
  }
  if (!channel && whatsappConfigured()) {
    if ((await sendWhatsAppOtp(phone, otp)).ok) channel = 'whatsapp'
  }
  if (!channel && znsConfigured()) {
    const zns = await sendZnsOtp(phone, otp, requestId)
    if (zns.ok) channel = 'zalo'
    else if (zns.noZalo) console.warn('[send-sms] no Zalo on number — SMS fallback')
  }
  if (!channel && (await sendSpeedSmsOtp(phone, otp)).ok) channel = 'sms'
  const delivered = channel !== null

  // Remember WHERE the code landed so the sign-in form can say "check your
  // Telegram" instead of "check everywhere" (read back by /api/auth/otp-channel).
  // Best-effort: a Redis blip only degrades the copy, never the login.
  if (channel) {
    try { await getRedis()?.set(`otp-ch:${phone}`, channel, { ex: 600 }) } catch {}
  }

  // 6) Return 200 even on a transient delivery hiccup: Supabase already stored
  //    the code and the user can resend — a non-200 would ABORT their login. We
  //    log (without the OTP) so a silent provider outage is still noticed.
  if (!delivered) console.error('[send-sms] all channels failed for', phone)
  return NextResponse.json({}, { status: 200 })
}
