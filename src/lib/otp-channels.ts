import 'server-only'

// OTP delivery channels for the Supabase send-sms hook.
//
// ⚠️ APP-ONLY SINCE 2026-08-02 — THERE IS NO SMS FALLBACK. SpeedSMS was removed on the owner's
// instruction, and it was the FLOOR: the one channel needing nothing installed, reaching every VN
// number for ~500đ. So a code can now only arrive somewhere the recipient already has an app:
//   Zalo ZNS           300đ   VN numbers      (lib/zalo-zns.ts — live once the OA is verified)
//   WhatsApp auth     ~294đ   foreign numbers (Meta authentication template)
//   Telegram Gateway  ~260đ   either          (free presence check, undelivered auto-refunds)
// Someone with none of them CANNOT RECEIVE A CODE. That is the accepted trade, but it means the
// sign-in form has to say so before the send rather than after a silent failure — see channelHint().
//
// Every sender is env-gated and times out fast: an unreachable provider must cascade, never hang
// the hook. NEVER log the OTP.

export type ChannelResult = { ok: boolean; noApp?: boolean }

// ⚠️ BOTH OF THESE NOW LIVE IN lib/phone.ts (client-safe) AND ARE ONLY RE-EXPORTED HERE.
// This module is `server-only`, but the sign-in form has to name the SAME app the router will pick
// — and when the two had separate copies they diverged on a bare 9-digit mobile ('912345678' →
// '912345678' on the client, '84912345678' here), so the form promised WhatsApp while the server
// routed to Zalo. One implementation, two import sites. `normalizePhoneVN` keeps its old name so
// existing server callers and tests are untouched.
export { normalizePhoneForRouting as normalizePhoneVN, isVietnamesePhone } from './phone'
import { normalizePhoneForRouting, isVietnamesePhone } from './phone'
// znsConfigured is Zalo's own gate (app id + secret + template); imported so configuredOtpChannels
// answers for all three channels in one place rather than making the caller assemble it.
import { znsConfigured } from './zalo-zns'



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
 * dead-ending — which is what keeps this safe to ship before the keys exist. ⚠️ With no keys at
 * all NOTHING can be delivered, since the SMS floor is gone; production today has only
 * TELEGRAM_GATEWAY_TOKEN set.
 *
 * ⚠️ Zalo is Vietnam-only. Never make it the preference for a foreign number: sendZnsOtp would
 * spend a request to learn what the country code already said.
 */
// 'sms' is retained in the union ONLY so a value cached by a pre-2026-08-02 build (otp-ch:{phone},
// 10-min TTL) still type-checks when read back. Nothing writes it any more.
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

// ⚠️ SpeedSMS WAS REMOVED HERE (owner, 2026-08-02: "remove speed sms from both"). It was the
// cascade's FLOOR — the only channel needing no app on the handset, reaching every VN number for
// ~500đ. Deleting it is therefore not a cost tweak: OTP delivery now REQUIRES the recipient to have
// Telegram, Zalo (VN) or WhatsApp (foreign), and a user with none of them cannot receive a code at
// all. That is the accepted trade; the sign-in form now says so up front rather than letting the
// send fail silently — see `channelHint` below and its use in sign-in-form.tsx.
//
// Do not reinstate it without also removing that copy, or the form will promise an SMS that never
// comes.

// ⚠️ channelHint() WAS REMOVED (2026-08-03, codex: "channelHint() is stale/dead"). It named the
// PREFERRED app, which is a false promise in production: preference is not capability, and today
// only TELEGRAM_GATEWAY_TOKEN is set — so a VN user was told "check Zalo" for a code the server
// could never send there. The form now asks the server which channels are actually CONFIGURED
// (GET /api/auth/otp-channel) and names only those. See configuredOtpChannels() below.

/**
 * Which channels this deployment can ACTUALLY send through, for the sign-in form's pre-send copy.
 *
 * ⚠️ CAPABILITY, NOT PREFERENCE, and the distinction is the whole point of this function. With the
 * SMS floor gone a wrong promise is a dead end: the send hook answers 200 even when every channel
 * fails (a non-200 would abort a login Supabase already recorded), so the user waits forever with
 * no error. Naming only configured channels is what keeps the copy honest as keys are added one at
 * a time.
 *
 * Booleans only — never a token, never a phone number.
 */
export function configuredOtpChannels(): { telegram: boolean; whatsapp: boolean; zalo: boolean } {
  return { telegram: telegramConfigured(), whatsapp: whatsappConfigured(), zalo: znsConfigured() }
}
