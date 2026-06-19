import { NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'

// Supabase "Send SMS Hook". Supabase generates, rate-limits and verifies the
// phone OTP natively (the app's signInWithOtp/verifyOtp flow is unchanged); this
// endpoint only DELIVERS the code — routing it through Zalo ZNS (primary) with
// SMS-brandname auto-fallback via the eSMS.vn multichannel API.
// Docs: https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
//
// SECURITY: this route is PUBLIC. The Standard Webhooks HMAC signature is the
// only thing preventing an attacker from spraying OTP sends and burning the
// SMS/ZNS balance — verify every request, and NEVER log the OTP.

export const runtime = 'nodejs' // standardwebhooks needs Node crypto, not edge
export const dynamic = 'force-dynamic'

const HOOK_SECRET = process.env.SEND_SMS_HOOK_SECRET // form: "v1,whsec_<base64>"

// eSMS.vn — one call does Zalo ZNS first, then SMS-brandname fallback when the
// number has no active Zalo / ZNS isn't delivered (server-side, out-of-band).
const ESMS_API_KEY = process.env.ESMS_API_KEY
const ESMS_SECRET_KEY = process.env.ESMS_SECRET_KEY
const ESMS_OAID = process.env.ESMS_OAID
const ESMS_ZNS_TEMPLATE = process.env.ESMS_ZNS_OTP_TEMPLATE
const ESMS_BRANDNAME = process.env.ESMS_SMS_BRANDNAME || 'ENO'

// SpeedSMS.vn — day-1 stopgap using its pre-approved "Verify" sender, usable
// before the custom ENO brandname + ZNS template approvals clear.
const SPEEDSMS_TOKEN = process.env.SPEEDSMS_TOKEN

const SMS_BODY = (otp: string) => `Ma OTP ENO cua ban la ${otp}. Hieu luc 5 phut. Khong chia se ma nay voi bat ky ai.`

// Supabase usually delivers user.phone without a leading '+', but tolerate both
// shapes. eSMS expects the 84-prefixed, digits-only form (e.g. 84901234567).
function normalizePhoneVN(raw: string): string {
  let d = (raw || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = '84' + d.slice(1)
  else if (!d.startsWith('84')) d = '84' + d
  return d
}

// Returns true if the aggregator ACCEPTED the request. Field names follow eSMS's
// documented MultiChannelMessage schema — confirm against your account's current
// API reference before go-live.
async function deliverViaEsms(phone: string, otp: string, requestId: string): Promise<boolean> {
  if (!ESMS_API_KEY || !ESMS_SECRET_KEY || !ESMS_OAID || !ESMS_ZNS_TEMPLATE) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000) // stay under the hook's ~5s budget
  try {
    const res = await fetch('https://rest.esms.vn/MainService.svc/json/MultiChannelMessage/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        ApiKey: ESMS_API_KEY,
        SecretKey: ESMS_SECRET_KEY,
        Phone: phone,
        RequestId: requestId, // idempotency: a retried hook invocation won't double-send/charge
        Channels: ['zalo', 'sms'],
        Data: [
          { Channel: 'zalo', OAID: ESMS_OAID, TempID: ESMS_ZNS_TEMPLATE, Params: [otp] },
          { Channel: 'sms', Brandname: ESMS_BRANDNAME, SmsType: '2', Content: SMS_BODY(otp) },
        ],
      }),
    })
    if (!res.ok) {
      console.error('[send-sms] eSMS HTTP', res.status)
      return false
    }
    const json = await res.json().catch(() => ({}))
    // CodeResult '100' = accepted (delivery + ZNS->SMS fallback then happen async).
    const ok = String(json?.CodeResult ?? '') === '100'
    if (!ok) console.error('[send-sms] eSMS rejected, CodeResult', json?.CodeResult)
    return ok
  } catch (e) {
    console.error('[send-sms] eSMS request failed:', (e as Error).name)
    return false
  } finally {
    clearTimeout(timer)
  }
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
  const requestId = headers['webhook-id'] || phone // idempotency key
  if (!phone || !otp) return NextResponse.json({ error: 'Missing phone/otp' }, { status: 400 })

  // 3) Deliver via Zalo ZNS + SMS fallback (eSMS), else the SpeedSMS stopgap.
  //    NEVER log the OTP.
  const delivered = (await deliverViaEsms(phone, otp, requestId)) || (await deliverViaSpeedSms(phone, otp))

  // 4) Return 200 even on a transient delivery hiccup: Supabase already stored
  //    the code and the user can resend — a non-200 would ABORT their login. We
  //    log (without the OTP) so a silent provider outage is still noticed.
  if (!delivered) console.error('[send-sms] all channels failed for', phone)
  return NextResponse.json({}, { status: 200 })
}
