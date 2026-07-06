import { NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { sendZnsOtp, znsConfigured } from '@/lib/zalo-zns'
import { sendTelegramOtp, sendWhatsAppOtp, sendSpeedSmsOtp, telegramConfigured, whatsappConfigured } from '@/lib/otp-channels'
import { rateLimit } from '@/lib/ratelimit'

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
//  - Per-PREFIX limiter below throttles pumping runs across a number range
//    (many numbers, one carrier block) that per-number limits can't see, plus
//    a global daily breaker caps worst-case spend. Both fail CLOSED.
//  - NEVER log the OTP.
// Docs: https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook

export const runtime = 'nodejs' // standardwebhooks needs Node crypto, not edge
export const dynamic = 'force-dynamic'

const HOOK_SECRET = process.env.SEND_SMS_HOOK_SECRET // form: "v1,whsec_<base64>"

// Supabase usually delivers user.phone without a leading '+', but tolerate both
// shapes. All providers here expect the 84-prefixed digits-only form.
function normalizePhoneVN(raw: string): string {
  let d = (raw || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = '84' + d.slice(1)
  else if (!d.startsWith('84')) d = '84' + d
  return d
}

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

  // 3) Pumping breakers (fail CLOSED — a Redis blip must not open the wallet):
  //    ≤20 sends/hour per 6-digit prefix (a legit block of users never bursts
  //    like a pumping run does) and ≤2,000 sends/day globally. On trip: swallow
  //    the delivery, return 200 (Supabase keeps the code; a real user retries
  //    later), and log loudly.
  const [prefixGate, globalGate] = await Promise.all([
    rateLimit('otp-prefix', phone.slice(0, 6), 20, '1 h', { strict: true }),
    rateLimit('otp-global', 'all', 2000, '1 d', { strict: true }),
  ])
  if (!prefixGate.success || !globalGate.success) {
    console.error('[send-sms] pumping breaker tripped', { prefix: phone.slice(0, 6), global: !globalGate.success })
    return NextResponse.json({}, { status: 200 })
  }

  // 4) Deliver — cheapest channel that can reach this number wins. `noApp`
  //    means "this number doesn't have that app": cascade, don't retry.
  let delivered = false
  if (telegramConfigured()) {
    delivered = (await sendTelegramOtp(phone, otp)).ok
  }
  if (!delivered && whatsappConfigured()) {
    delivered = (await sendWhatsAppOtp(phone, otp)).ok
  }
  if (!delivered && znsConfigured()) {
    const zns = await sendZnsOtp(phone, otp, requestId)
    delivered = zns.ok
    if (!zns.ok && zns.noZalo) console.warn('[send-sms] no Zalo on number — SMS fallback')
  }
  if (!delivered) delivered = (await sendSpeedSmsOtp(phone, otp)).ok

  // 5) Return 200 even on a transient delivery hiccup: Supabase already stored
  //    the code and the user can resend — a non-200 would ABORT their login. We
  //    log (without the OTP) so a silent provider outage is still noticed.
  if (!delivered) console.error('[send-sms] all channels failed for', phone)
  return NextResponse.json({}, { status: 200 })
}
