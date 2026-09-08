import { NextRequest, NextResponse } from 'next/server'
import { logError } from '@/lib/log'
import { IS_SERVICES } from '@/lib/edition'
import { parseInboundWhatsApp, verifyWhatsAppSignature, whatsappBridgeConfigured, whatsappVerifyChallenge } from '@/lib/whatsapp'
import { deliverInboundWhatsApp } from '@/lib/whatsapp-bridge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * META'S WEBHOOK FOR THE BUSINESS NUMBER — inbound WhatsApp becomes a message in /messages.
 *
 * ⛔ THIS IS A PUBLIC, UNAUTHENTICATED URL BY NECESSITY — Meta must be able to reach it — so the
 * SIGNATURE IS THE ONLY THING STANDING BETWEEN IT AND ANYONE AUTHORING SUPPORT MESSAGES AS ANY
 * PHONE NUMBER IN THE WORLD. It is checked over the RAW request bytes, in constant time, and the
 * route refuses when the secret is absent rather than falling open: an unconfigured bridge that
 * accepts everything is strictly worse than one that accepts nothing.
 *
 * ⚠️ NOT WRAPPED IN route(). Its auth modes are cookie/cron shaped and none of them is "HMAC over
 * the raw body", and the reply contract here is Meta's, not ours: `hub.challenge` must come back as
 * PLAIN TEXT on the GET, and every POST must answer 200 even when nothing could be processed.
 */

/** Meta's subscription handshake. Answers the challenge as plain text, or 403. */
export async function GET(req: NextRequest) {
  // ⛔ THE SAME EDITION GUARD AS POST. Without it eno.vn completes Meta's subscription handshake
  // happily and every subsequent delivery 404s — a webhook that verifies and then silently drops
  // every customer message, which is the hardest kind of misconfiguration to notice.
  if (!IS_SERVICES) return new NextResponse('wrong_edition', { status: 404 })
  const challenge = whatsappVerifyChallenge(req.nextUrl.searchParams)
  if (!challenge) return new NextResponse('forbidden', { status: 403 })
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export async function POST(req: NextRequest) {
  /**
   * ⛔ THE BRIDGE BELONGS TO THE EDITION THAT OWNS THE SUPPORT DESK IT WRITES INTO. The owner asked
   * for messages to reach *support@eno.forum*, and `SUPPORT_SELLER_ID` is edition-scoped — so on a
   * marketplace build the same code would open threads against eno.vn's desk, which eno.forum's
   * admins cannot answer. One codebase, two containers, one WhatsApp number: the number belongs to
   * the services edition and the marketplace build must decline rather than quietly fork the inbox.
   */
  if (!IS_SERVICES) return new NextResponse('wrong_edition', { status: 404 })
  /**
   * ⛔ READ THE BODY ONCE, AS TEXT, AND VERIFY THOSE EXACT BYTES. Parsing first and re-serialising
   * to check the signature is the classic way to break this: the round trip normalises unicode
   * escapes and whitespace, legitimate payloads start failing, and the usual "fix" is to stop
   * verifying. The same string is parsed after the check passes.
   */
  const raw = await req.text()
  if (!whatsappBridgeConfigured()) {
    // ⚠️ 403, NOT 200. A 200 tells Meta the delivery succeeded and it is never retried — so a
    // missing secret would silently discard real customer messages. A non-200 makes Meta redeliver,
    // which is what should happen while the bridge is being configured.
    return new NextResponse('not_configured', { status: 403 })
  }
  if (!verifyWhatsAppSignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('bad_signature', { status: 403 })
  }

  let payload: unknown
  try { payload = JSON.parse(raw) } catch {
    // ⚠️ 200: unparseable is not retryable, and a redelivery loop over a bad body is worse than
    // dropping it. It cannot be a real message — the signature proved Meta sent it.
    return NextResponse.json({ ok: true, ignored: 'unparseable' })
  }

  const { messages, skipped, foreign } = parseInboundWhatsApp(payload)
  // Delivery STATUSES and non-text messages arrive on this same subscription and are not errors.
  if (!messages.length) return NextResponse.json({ ok: true, delivered: 0, skipped, foreign })

  try {
    const result = await deliverInboundWhatsApp(messages)
    /**
     * ⛔ A FAILED MESSAGE MUST ANSWER NON-200, BECAUSE META NEVER RETRIES A 200. This returned 200
     * unconditionally "so a partial batch is not redelivered" — which meant a database blip, a
     * Supabase 5xx, or simply deploying before scripts/whatsapp-inbound-ddl.mjs had run would drop
     * a real customer's message for ever, with `{ok: true}` on the wire and one line in a log. All
     * four reviewers called it, and the trade it was avoiding does not exist: the claim row makes a
     * redelivery of the SUCCEEDED messages a no-op duplicate, and the failed one released its claim
     * on the way out, so a retry is exactly what should happen.
     */
    if (result.failed > 0) {
      return NextResponse.json({ ok: false, ...result, skipped, foreign }, { status: 503 })
    }
    return NextResponse.json({ ok: true, ...result, skipped, foreign })
  } catch (e) {
    logError(e, { op: 'whatsapp.webhook' })
    // An unexpected throw IS worth a redelivery — nothing was recorded, so nothing duplicates.
    return new NextResponse('error', { status: 500 })
  }
}
