import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * THE WHATSAPP BUSINESS BRIDGE — the number 0772007921, wired to the in-app support thread.
 *
 * Owner, 2026-09-08: *"whatsapp 0772007921 api make it deliver messages to support@eno.forum within
 * app and backwards user should receive messages from our admin in app messages"*. So: a message
 * sent to the business number becomes a message in that person's SUPPORT THREAD (/messages), and a
 * reply written there goes back out over WhatsApp. One conversation, two transports.
 *
 * ⚠️ THE OTP SENDER IS A DIFFERENT THING AND STAYS SEPARATE. src/lib/otp-channels.ts sends the
 * `eno_otp` AUTHENTICATION template and nothing else; this file sends and receives free-form
 * SESSION messages. They share the phone number id and token deliberately (one WhatsApp sender
 * identity), but not the code — an OTP is a template send with no reply path, and merging them
 * would put a login secret through a relay that writes into a readable conversation.
 */

const TOKEN = () => process.env.WHATSAPP_TOKEN
const PHONE_ID = () => process.env.WHATSAPP_PHONE_ID
/**
 * ⛔ THE APP SECRET IS WHAT MAKES THE WEBHOOK TRUSTWORTHY, AND WITHOUT IT THE BRIDGE STAYS SHUT.
 * The webhook URL is public by necessity — Meta must reach it — so anything that can POST to it
 * could otherwise author messages into a support thread as any phone number in the world. See
 * `verifyWhatsAppSignature`; the route refuses rather than falling open.
 */
const APP_SECRET = () => process.env.WHATSAPP_APP_SECRET
/** Echoed back on Meta's GET handshake. Any opaque string; it only proves the URL is ours. */
const VERIFY_TOKEN = () => process.env.WHATSAPP_VERIFY_TOKEN

export const whatsappBridgeConfigured = () => !!(TOKEN() && PHONE_ID() && APP_SECRET())

/**
 * ⛔ CONSTANT-TIME, AND OVER THE RAW BYTES. Two ways to get this wrong, both fatal:
 *   · comparing with `===` leaks the signature a byte at a time to a patient caller;
 *   · verifying a re-serialised body instead of the bytes Meta signed — `JSON.parse` then
 *     `JSON.stringify` reorders nothing today but normalises unicode escapes and whitespace, so a
 *     legitimate payload fails and, worse, the fix is usually "skip verification".
 * The route reads `await req.text()` ONCE and parses that same string after this returns true.
 */
export function verifyWhatsAppSignature(rawBody: string, header: string | null): boolean {
  const secret = APP_SECRET()
  if (!secret || !header) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  // timingSafeEqual THROWS on a length mismatch rather than returning false — check first.
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Meta's subscription handshake: echo `hub.challenge` iff the token matches. */
export function whatsappVerifyChallenge(params: URLSearchParams): string | null {
  const expected = VERIFY_TOKEN()
  if (!expected) return null
  if (params.get('hub.mode') !== 'subscribe') return null
  if (params.get('hub.verify_token') !== expected) return null
  return params.get('hub.challenge')
}

export type InboundWhatsAppMessage = {
  /** E.164 without '+', exactly as Meta sends it (e.g. "84772007921"). */
  from: string
  /** Meta's message id — the idempotency key; a webhook delivery is retried on any non-200. */
  wamid: string
  text: string
  /** Sender's WhatsApp profile name, when Meta includes it. */
  name?: string
}

/**
 * ⛔ THE PARSER IS PURE AND SEPARATE FROM THE ROUTE SO IT CAN BE TESTED. Meta's envelope is deeply
 * nested and carries several shapes through the same subscription: delivery STATUSES (`statuses`),
 * message types this bridge cannot represent (image/audio/location/interactive), and echoes. A
 * route that assumes `entry[0].changes[0].value.messages[0]` throws on the first status callback,
 * and a throw is a non-200, and a non-200 makes Meta redeliver — for ever.
 *
 * ⚠️ ONLY `type: 'text'` IS RETURNED. Anything else is deliberately dropped rather than turned into
 * a placeholder message: a support thread saying "[image]" that support cannot open is worse than
 * a gap, and the route reports the count so it is visible instead of silent.
 */
export function parseInboundWhatsApp(payload: unknown): { messages: InboundWhatsAppMessage[]; skipped: number; foreign: number } {
  const out: InboundWhatsAppMessage[] = []
  let skipped = 0
  let foreign = 0
  /**
   * ⛔ ONLY CALLBACKS FOR OUR OWN BUSINESS NUMBER. One Meta app can carry several phone numbers and
   * they all sign with the SAME app secret, so a valid signature proves the sender is Meta — never
   * that the message was addressed to us. Without this, a second number on the same app (or a
   * future one) would have its customers' messages routed into this site's support threads.
   * `metadata.phone_number_id` is the destination; `WHATSAPP_PHONE_ID` is the number we own.
   */
  const ours = PHONE_ID()
  const entries = (payload as { entry?: unknown[] })?.entry
  if (!Array.isArray(entries)) return { messages: out, skipped, foreign }
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value
      if (!value) continue
      const dest = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id
      // ⚠️ A callback with no metadata is not trusted into a support thread either.
      if (!ours || dest !== ours) {
        if (Array.isArray(value.messages) && value.messages.length) foreign += value.messages.length
        continue
      }
      const contacts = Array.isArray(value.contacts) ? (value.contacts as Record<string, unknown>[]) : []
      const nameByWaId = new Map<string, string>()
      for (const c of contacts) {
        // ⚠️ A null entry in the array is a shape this must survive: parsing runs OUTSIDE the
        // route's delivery try/catch, so a throw here is a 500 and a redelivery loop.
        if (!c || typeof c !== 'object') continue
        const waId = typeof c.wa_id === 'string' ? c.wa_id : null
        const nm = (c.profile as { name?: string } | undefined)?.name
        if (waId && nm) nameByWaId.set(waId, nm)
      }
      const messages = Array.isArray(value.messages) ? (value.messages as Record<string, unknown>[]) : []
      for (const m of messages) {
        if (!m || typeof m !== 'object') { skipped++; continue }
        const from = typeof m.from === 'string' ? m.from : ''
        const wamid = typeof m.id === 'string' ? m.id : ''
        const rawBody = (m.text as { body?: unknown } | undefined)?.body
        // ⚠️ TYPE-CHECKED, not truthiness-checked: a numeric body passed the old test and then threw
        // on `.slice()` deep inside the bridge, where the failure reads as a database problem.
        const body = typeof rawBody === 'string' ? rawBody : ''
        if (m.type !== 'text' || !from || !wamid || !body) { skipped++; continue }
        out.push({ from, wamid, text: body, name: nameByWaId.get(from) })
      }
    }
  }
  return { messages: out, skipped, foreign }
}

export type SendResult = { ok: true; wamid?: string } | { ok: false; error: string; outsideWindow?: boolean }

/**
 * Send a free-form text back to a person who messaged us.
 *
 * ⛔ THE 24-HOUR CUSTOMER SERVICE WINDOW IS A META RULE, NOT A DETAIL WE CAN RETRY PAST. A business
 * may send free-form text only within 24h of that person's last inbound message; outside it Meta
 * rejects with code 131047 and only an approved TEMPLATE may reopen the conversation. This is
 * surfaced as `outsideWindow` rather than swallowed, because the honest thing for the admin UI to
 * say is "this reply was saved but WhatsApp would not deliver it", not a silent success.
 */
export async function sendWhatsAppText(toE164NoPlus: string, body: string): Promise<SendResult> {
  const token = TOKEN(), phoneId = PHONE_ID()
  if (!token || !phoneId) return { ok: false, error: 'not_configured' }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toE164NoPlus,
        type: 'text',
        // ⚠️ Link previews OFF: a preview renders our own listing URLs as cards inside a support
        // reply, which reads as marketing in the middle of a support conversation.
        text: { preview_url: false, body: body.slice(0, 4096) },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[]
      error?: { code?: number; message?: string }
    }
    if (res.ok) return { ok: true, wamid: json.messages?.[0]?.id }
    const code = json.error?.code
    return { ok: false, error: `wa_${code ?? res.status}`, outsideWindow: code === 131047 }
  } catch (e) {
    return { ok: false, error: (e as Error).name }
  }
}
