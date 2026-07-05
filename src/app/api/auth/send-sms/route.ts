import { NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { sendZnsOtp, znsConfigured } from '@/lib/zalo-zns'

// Supabase "Send SMS Hook". Supabase generates, rate-limits and verifies the
// phone OTP natively (the app's signInWithOtp/verifyOtp flow is unchanged); this
// endpoint only DELIVERS the code — NATIVE Zalo ZNS first (direct Business
// OpenAPI, no aggregator — user decision 2026-07-05 replaced eSMS), falling back
// to plain SMS (SpeedSMS stopgap) when the number has no Zalo account.
// Docs: https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
//
// SECURITY: this route is PUBLIC. The Standard Webhooks HMAC signature is the
// only thing preventing an attacker from spraying OTP sends and burning the
// ZNS/SMS balance — verify every request, and NEVER log the OTP.

export const runtime = 'nodejs' // standardwebhooks needs Node crypto, not edge
export const dynamic = 'force-dynamic'

const HOOK_SECRET = process.env.SEND_SMS_HOOK_SECRET // form: "v1,whsec_<base64>"

// SpeedSMS.vn — SMS fallback for numbers without Zalo, using its pre-approved
// "Verify" sender (usable before any custom brandname approval clears).
const SPEEDSMS_TOKEN = process.env.SPEEDSMS_TOKEN

const SMS_BODY = (otp: string) => `Ma OTP ENO cua ban la ${otp}. Hieu luc 5 phut. Khong chia se ma nay voi bat ky ai.`

// Supabase usually delivers user.phone without a leading '+', but tolerate both
// shapes. Zalo + SMS providers expect the 84-prefixed digits-only form.
function normalizePhoneVN(raw: string): string {
  let d = (raw || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = '84' + d.slice(1)
  else if (!d.startsWith('84')) d = '84' + d
  return d
}

async function deliverViaSpeedSms(phone: string, otp: string): Promise<boolean> {
  if (!SPEEDSMS_TOKEN) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch('https://api.speedsms.vn/index.php/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${SPEEDSMS_TOKEN}:x`).toString('base64'),
      },
      signal: controller.signal,
      body: JSON.stringify({ to: [phone], content: SMS_BODY(otp), sms_type: 5, sender: 'Verify' }),
    })
    const json = await res.json().catch(() => ({}))
    return res.ok && json?.status === 'success'
  } catch (e) {
    console.error('[send-sms] SpeedSMS failed:', (e as Error).name)
    return false
  } finally {
    clearTimeout(timer)
  }
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

  // 3) Deliver: native Zalo ZNS first (300 VND, 1-5s, 24/7 for OTP templates);
  //    no-Zalo numbers (or any ZNS failure) fall back to plain SMS. NEVER log the OTP.
  let delivered = false
  if (znsConfigured()) {
    const zns = await sendZnsOtp(phone, otp, requestId)
    delivered = zns.ok
    if (!zns.ok && zns.noZalo) console.warn('[send-sms] no Zalo on number — SMS fallback')
  }
  if (!delivered) delivered = await deliverViaSpeedSms(phone, otp)

  // 4) Return 200 even on a transient delivery hiccup: Supabase already stored
  //    the code and the user can resend — a non-200 would ABORT their login. We
  //    log (without the OTP) so a silent provider outage is still noticed.
  if (!delivered) console.error('[send-sms] all channels failed for', phone)
  return NextResponse.json({}, { status: 200 })
}
