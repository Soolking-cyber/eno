import 'server-only'

// OTP delivery channels for the Supabase send-sms hook — ordered by cost
// (research 2026-07-06, prices per OTP to a VN number):
//   Telegram Gateway  ~260đ  ($0.01, auto-refunded when undelivered)
//   WhatsApp auth     ~294đ  (Meta authentication template)
//   Zalo ZNS           300đ  (lib/zalo-zns.ts — live once the OA is verified)
//   SpeedSMS "Verify" ~500đ  (shared brandname — reaches every VN number)
// Every sender is env-gated and times out fast: an unreachable provider must
// cascade, never hang the hook. NEVER log the OTP.

export type ChannelResult = { ok: boolean; noApp?: boolean }

// Supabase usually delivers user.phone without a leading '+', but tolerate both
// shapes. Providers here expect digits-only; VN forms are canonicalized to the
// 84-prefix. ⚠️ A number that already carries its OWN country code must pass
// through untouched (audit P2): the old blanket 84-prefix turned every foreign
// sign-up (+1…, +44… — the expat audience) into a bogus VN number, so the OTP
// was dispatched to a nonexistent recipient on every channel.
export function normalizePhoneVN(raw: string): string {
  const trimmed = (raw || '').trim()
  const hadPlus = trimmed.startsWith('+')
  let d = trimmed.replace(/\D/g, '')
  if (d.startsWith('0')) return '84' + d.slice(1) // local VN form
  if (d.startsWith('84')) return d                // already canonical VN
  if (hadPlus) return d                            // explicit E.164 → its own country code
  // Bare digits: a 9-digit VN mobile typed without the leading 0 gets the prefix;
  // anything longer is a full international number delivered without '+'.
  return d.length === 9 ? '84' + d : d
}

/**
 * Is this a Vietnamese number? Takes the output of {@link normalizePhoneVN}, which has already
 * resolved every local form ('0…', bare 9-digit) to the 84 country code.
 *
 * ⚠️ '84' AS A PREFIX IS NOT ENOUGH ON ITS OWN — it is also the start of longer numbers in other
 * countries once the '+' is gone, so the LENGTH is checked too. A VN mobile in E.164 is 84 followed
 * by 9 digits (11 total); the old 10-digit local mobiles were retired in 2018 but a stale contact
 * record can still carry one, so 10 is accepted as well. Anything longer that merely starts with 84
 * is somebody else's country, and must not be routed to a Vietnam-only channel.
 */
export function isVietnamesePhone(normalized: string): boolean {
  const d = (normalized || '').replace(/\D/g, '')
  return d.startsWith('84') && (d.length === 11 || d.length === 10)
}

/**
 * Which channel to TRY FIRST for this number (owner, 2026-08-02: "zalo otp for local phone numbers
 * and whatsapp otp for foreign numbers").
 *
 * ⚠️ THIS REPLACES A COST-ORDERED CASCADE, AND THE OLD ORDER WAS ACTIVELY WRONG FOR VN NUMBERS.
 * Delivery used to try Telegram → WhatsApp → Zalo → SMS for EVERY number, cheapest first. So a
 * Vietnamese user — the majority case, and the one Zalo exists to serve — got their code on
 * Telegram or WhatsApp whenever those were configured, and reached Zalo only if both failed. Zalo
 * is where a Vietnamese phone actually lives; WhatsApp barely registers there, while for the expat
 * audience it is the opposite.
 *
 * The RETURN VALUE IS A PREFERENCE, NOT AN EXCLUSION. The caller still cascades through every other
 * configured channel afterwards, so an unconfigured or failing preference degrades instead of
 * dead-ending — which is what keeps this safe to ship before the keys exist. With no keys at all,
 * every channel is unconfigured and behaviour is identical to today: SpeedSMS, or nothing.
 *
 * ⚠️ Zalo is Vietnam-only. Never make it the preference for a foreign number: sendZnsOtp would
 * spend a request to learn what the country code already said.
 */
export type OtpChannel = 'telegram' | 'whatsapp' | 'zalo' | 'sms'

export function preferredOtpChannel(normalized: string): OtpChannel {
  return isVietnamesePhone(normalized) ? 'zalo' : 'whatsapp'
}

const TIMEOUT_MS = 3000

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ── Telegram Gateway (gateway.telegram.org) ─────────────────────────────────
// checkSendAbility is a FREE presence check; passing its request_id to
// sendVerificationMessage keeps the discounted rate and undeliverable codes
// are auto-refunded. `noApp` → the number has no Telegram → cascade on.
const TG_TOKEN = process.env.TELEGRAM_GATEWAY_TOKEN

export const telegramConfigured = () => !!TG_TOKEN

export async function sendTelegramOtp(phone: string, otp: string): Promise<ChannelResult> {
  if (!TG_TOKEN) return { ok: false }
  const call = async (method: string, body: Record<string, unknown>) => {
    const res = await timedFetch(`https://gatewayapi.telegram.org/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TG_TOKEN}` },
      body: JSON.stringify(body),
    })
    return (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { request_id?: string }; error?: string }
  }
  try {
    const ability = await call('checkSendAbility', { phone_number: `+${phone}` })
    if (!ability.ok) return { ok: false, noApp: true } // no Telegram on this number
    const sent = await call('sendVerificationMessage', {
      phone_number: `+${phone}`,
      request_id: ability.result?.request_id,
      code: otp,
      ttl: 300,
    })
    return { ok: !!sent.ok }
  } catch (e) {
    console.error('[otp] telegram failed:', (e as Error).name)
    return { ok: false }
  }
}

// ── WhatsApp authentication template (Meta Cloud API) ───────────────────────
// Requires a verified Meta Business + an approved AUTHENTICATION template with
// the copy-code button. Error 131026 = number not on WhatsApp → cascade on.
const WA_TOKEN = process.env.WHATSAPP_TOKEN
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID
const WA_TEMPLATE = process.env.WHATSAPP_OTP_TEMPLATE || 'eno_otp'

export const whatsappConfigured = () => !!(WA_TOKEN && WA_PHONE_ID)

export async function sendWhatsAppOtp(phone: string, otp: string): Promise<ChannelResult> {
  if (!WA_TOKEN || !WA_PHONE_ID) return { ok: false }
  try {
    const res = await timedFetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WA_TOKEN}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: WA_TEMPLATE,
          language: { code: 'en' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: otp }] },
            // Authentication templates REQUIRE the copy-code button parameter.
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] },
          ],
        },
      }),
    })
    if (res.ok) return { ok: true }
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: number } }
    // 131026 = undeliverable (usually: recipient has no WhatsApp)
    if (body.error?.code === 131026) return { ok: false, noApp: true }
    console.error('[otp] whatsapp error code:', body.error?.code)
    return { ok: false }
  } catch (e) {
    console.error('[otp] whatsapp failed:', (e as Error).name)
    return { ok: false }
  }
}

// ── SpeedSMS "Verify" shared brandname (works pre-business-license) ─────────
// sendSpeedSmsOtp already gates on SPEEDSMS_TOKEN internally, so no separate
// *Configured() guard is needed (unlike the telegram/whatsapp/zns channels).
const SPEEDSMS_TOKEN = process.env.SPEEDSMS_TOKEN

const SMS_BODY = (otp: string) => `Ma OTP ENO cua ban la ${otp}. Hieu luc 5 phut. Khong chia se ma nay voi bat ky ai.`

export async function sendSpeedSmsOtp(phone: string, otp: string): Promise<ChannelResult> {
  if (!SPEEDSMS_TOKEN) return { ok: false }
  try {
    const res = await timedFetch('https://api.speedsms.vn/index.php/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${SPEEDSMS_TOKEN}:x`).toString('base64'),
      },
      body: JSON.stringify({ to: [phone], content: SMS_BODY(otp), sms_type: 5, sender: 'Verify' }),
    })
    const json = (await res.json().catch(() => ({}))) as { status?: string }
    return { ok: res.ok && json?.status === 'success' }
  } catch (e) {
    console.error('[otp] speedsms failed:', (e as Error).name)
    return { ok: false }
  }
}
