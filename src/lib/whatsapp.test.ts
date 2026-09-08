import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { parseInboundWhatsApp, verifyWhatsAppSignature, whatsappVerifyChallenge } from './whatsapp'

const SECRET = 'test-app-secret'
const sign = (body: string, secret = SECRET) =>
  'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')

const env = { ...process.env }
beforeEach(() => {
  process.env.WHATSAPP_APP_SECRET = SECRET
  process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me'
  process.env.WHATSAPP_PHONE_ID = '1260803707106432'
})
afterEach(() => { process.env = { ...env } })

/**
 * ⛔ THE WEBHOOK URL IS PUBLIC AND UNAUTHENTICATED BY NECESSITY — Meta has to reach it — SO THIS
 * SIGNATURE IS THE ONLY THING STOPPING ANYONE FROM AUTHORING SUPPORT MESSAGES AS ANY PHONE NUMBER
 * IN THE WORLD. Every case here is a way that check has been got wrong in the wild.
 */
describe('verifyWhatsAppSignature', () => {
  it('accepts a signature computed over the exact bytes', () => {
    const body = '{"entry":[]}'
    expect(verifyWhatsAppSignature(body, sign(body))).toBe(true)
  })

  it('⛔ REJECTS A SIGNATURE FROM A DIFFERENT SECRET', () => {
    const body = '{"entry":[]}'
    expect(verifyWhatsAppSignature(body, sign(body, 'someone-elses-secret'))).toBe(false)
  })

  /**
   * ⛔ THE BODY IS SIGNED, NOT ITS MEANING. A payload that parses to the same object but differs by
   * one byte must fail — this is what makes "parse, re-serialise, then verify" a broken design:
   * the round trip changes the bytes, legitimate deliveries start failing, and the usual fix is to
   * stop verifying at all.
   */
  it('⛔ REJECTS WHEN A SINGLE BYTE OF THE BODY CHANGED', () => {
    const body = '{"entry":[{"id":"1"}]}'
    const sig = sign(body)
    expect(verifyWhatsAppSignature(body.replace('"1"', '"2"'), sig)).toBe(false)
    expect(verifyWhatsAppSignature(' ' + body, sig)).toBe(false)
  })

  /**
   * ⛔ AND IT MUST NOT THROW ON A LENGTH MISMATCH. `timingSafeEqual` raises when the buffers differ
   * in length, so an attacker sending a short header would turn the check into a 500 — which is a
   * non-200, which makes Meta redeliver, forever.
   */
  it('⛔ REFUSES A MALFORMED OR ABSENT HEADER WITHOUT THROWING', () => {
    const body = '{}'
    expect(verifyWhatsAppSignature(body, null)).toBe(false)
    expect(verifyWhatsAppSignature(body, '')).toBe(false)
    expect(verifyWhatsAppSignature(body, 'sha256=short')).toBe(false)
    expect(verifyWhatsAppSignature(body, 'garbage')).toBe(false)
  })

  /** ⛔ NO SECRET MEANS NO TRUST — never fall open. */
  it('⛔ REJECTS EVERYTHING WHEN THE SECRET IS NOT CONFIGURED', () => {
    delete process.env.WHATSAPP_APP_SECRET
    const body = '{}'
    expect(verifyWhatsAppSignature(body, sign(body))).toBe(false)
  })
})

describe('whatsappVerifyChallenge', () => {
  it('echoes the challenge only for the right mode and token', () => {
    const ok = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' })
    expect(whatsappVerifyChallenge(ok)).toBe('12345')
  })
  it('⛔ REFUSES A WRONG TOKEN, A WRONG MODE, OR AN UNSET TOKEN', () => {
    const p = (o: Record<string, string>) => new URLSearchParams(o)
    expect(whatsappVerifyChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'x' }))).toBeNull()
    expect(whatsappVerifyChallenge(p({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'x' }))).toBeNull()
    delete process.env.WHATSAPP_VERIFY_TOKEN
    expect(whatsappVerifyChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'x' }))).toBeNull()
  })
})

/**
 * ⛔ ONE SUBSCRIPTION CARRIES SEVERAL SHAPES, AND A PARSER THAT ASSUMES ONE OF THEM THROWS. Delivery
 * statuses outnumber messages in normal operation; a throw is a non-200; a non-200 makes Meta
 * redeliver — so an optimistic `entry[0].changes[0].value.messages[0]` becomes an infinite loop the
 * first time someone reads a message.
 */
describe('parseInboundWhatsApp', () => {
  /** Every real callback carries `metadata.phone_number_id` — the number it was addressed TO. */
  const envelope = (value: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'W', changes: [{ value: { metadata: { phone_number_id: '1260803707106432' }, ...value }, field: 'messages' }] }],
  })

  it('reads a text message and the sender name', () => {
    const { messages, skipped } = parseInboundWhatsApp(envelope({
      messaging_product: 'whatsapp',
      contacts: [{ profile: { name: 'Minh' }, wa_id: '84901234567' }],
      messages: [{ from: '84901234567', id: 'wamid.ABC', timestamp: '1', type: 'text', text: { body: 'do you deliver to Hue?' } }],
    }))
    expect(skipped).toBe(0)
    expect(messages).toEqual([{ from: '84901234567', wamid: 'wamid.ABC', text: 'do you deliver to Hue?', name: 'Minh' }])
  })

  it('⛔ RETURNS NOTHING, AND DOES NOT THROW, ON A DELIVERY-STATUS CALLBACK', () => {
    const { messages } = parseInboundWhatsApp(envelope({
      messaging_product: 'whatsapp',
      statuses: [{ id: 'wamid.OUT', status: 'delivered', recipient_id: '84901234567' }],
    }))
    expect(messages).toEqual([])
  })

  /**
   * ⚠️ A NON-TEXT MESSAGE IS COUNTED, NOT INVENTED. Turning an image into "[image]" would put a
   * message in a support thread that support cannot open; the route reports `skipped` instead.
   */
  it('⚠️ SKIPS AND COUNTS MESSAGE TYPES IT CANNOT REPRESENT', () => {
    const { messages, skipped } = parseInboundWhatsApp(envelope({
      messages: [
        { from: '8490', id: 'wamid.IMG', type: 'image', image: { id: 'x' } },
        { from: '8490', id: 'wamid.LOC', type: 'location', location: { latitude: 1, longitude: 2 } },
        { from: '8490', id: 'wamid.TXT', type: 'text', text: { body: 'hello' } },
      ],
    }))
    expect(skipped).toBe(2)
    expect(messages.map((m) => m.wamid)).toEqual(['wamid.TXT'])
  })

  /**
   * ⛔ A VALID SIGNATURE PROVES META SENT IT, NEVER THAT IT WAS ADDRESSED TO US. One Meta app can
   * carry several business numbers and they all sign with the SAME app secret, so without this a
   * sibling number's customers would have their messages routed into this site's support threads.
   */
  it('⛔ IGNORES A CALLBACK FOR A DIFFERENT BUSINESS NUMBER ON THE SAME APP', () => {
    const other = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '999999999999999' },
        messages: [{ from: '8490', id: 'wamid.OTHER', type: 'text', text: { body: 'not for us' } }],
      } }] }],
    }
    const r = parseInboundWhatsApp(other)
    expect(r.messages).toEqual([])
    expect(r.foreign).toBe(1)
  })

  it('⛔ IGNORES A CALLBACK CARRYING NO DESTINATION METADATA', () => {
    const r = parseInboundWhatsApp({ entry: [{ changes: [{ value: {
      messages: [{ from: '8490', id: 'wamid.NOMETA', type: 'text', text: { body: 'x' } }],
    } }] }] })
    expect(r.messages).toEqual([])
  })

  /**
   * ⛔ PARSING RUNS OUTSIDE THE ROUTE'S DELIVERY try/catch, SO A THROW HERE IS A 500 — AND A 500 IS
   * A REDELIVERY, FOR EVER. Null entries inside `contacts`/`messages` and a non-string body are the
   * shapes that got past the first cut's truthiness checks and threw further in, where the failure
   * reads as a database problem rather than a parse one.
   */
  it('⛔ SURVIVES EVERY MALFORMED ENVELOPE SHAPE', () => {
    const junks: unknown[] = [
      null, undefined, {}, { entry: null }, { entry: [{}] }, { entry: [{ changes: [{}] }] }, 'nope', 42,
      envelope({ contacts: [null], messages: [{ from: '84', id: 'w', type: 'text', text: { body: 'hi' } }] }),
      envelope({ messages: [null] }),
      envelope({ messages: [{ from: '84', id: 'w', type: 'text', text: { body: 12345 } }] }),
    ]
    for (const junk of junks) expect(() => parseInboundWhatsApp(junk), JSON.stringify(junk)).not.toThrow()
    // …and the two that carry a usable message still yield exactly the good one.
    expect(parseInboundWhatsApp(junks[8]).messages).toHaveLength(1)
    expect(parseInboundWhatsApp(junks[10]).messages).toEqual([])
  })

  it('reads several messages across several entries', () => {
    const meta = { phone_number_id: '1260803707106432' }
    const { messages } = parseInboundWhatsApp({
      entry: [
        { changes: [{ value: { metadata: meta, messages: [{ from: '1', id: 'a', type: 'text', text: { body: 'one' } }] } }] },
        { changes: [{ value: { metadata: meta, messages: [{ from: '2', id: 'b', type: 'text', text: { body: 'two' } }] } }] },
      ],
    })
    expect(messages.map((m) => m.text)).toEqual(['one', 'two'])
  })
})
