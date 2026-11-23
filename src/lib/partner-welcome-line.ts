import { containsPhoneNumber, normalizePhone } from './phone'

/**
 * THE PARTNER WELCOME LINE (owner, 2026-11-18: "when someone texts partner stores have an auto message that admins will assist
 * them asap and ask for their phone number so we can reach faster. also have 1 click send for them if they already registered
 * their number if not ask them to add with 1 click in chat").
 *
 * One fixed bilingual line, the service-deal line's class (src/lib/service-deal.ts): stored "VI · EN" so an older build, the
 * iOS app, an agent reading the thread and an admin reading a report all see readable words; the thread page shows each viewer
 * their own half (localizePartnerWelcome) and never machine-translates it. CLIENT-SAFE — no db here; the sender is
 * src/lib/partner-welcome.ts, and insertMessage refuses the kind unless the body is exactly this line.
 */
export const PARTNER_WELCOME_MARK = '👋'
export const PARTNER_WELCOME_PARTS = {
  vi: 'Cảm ơn bạn đã nhắn tin! Đội ngũ của chúng tôi sẽ hỗ trợ bạn sớm nhất có thể. Hãy để lại số điện thoại để chúng tôi liên hệ với bạn nhanh hơn.',
  en: 'Thanks for your message! Our team will help you as soon as possible. Share your phone number so we can reach you faster.',
} as const
export const PARTNER_WELCOME_LINE = `${PARTNER_WELCOME_MARK} ${PARTNER_WELCOME_PARTS.vi} · ${PARTNER_WELCOME_PARTS.en}`

/**
 * THE BUY-NOW WELCOME (owner, 2026-11-23: "when a customer wants a product from accesstrade affiliated products and texts tell
 * them if they want to purchase right away they can do so in our official storefront otherwise we are happy to assist them with
 * any question regarding the product and it will be faster if they leave a number"). The welcome's other line, sent INSTEAD of
 * it on a listing with a buy link (src/lib/partner-buy.ts — an eno-run partner's staff purchase link); the thread page puts the
 * "Buy now" button under it, then the phone chip. Same kind ('partner_welcome'), same rules.
 */
export const PARTNER_BUY_WELCOME_PARTS = {
  vi: 'Cảm ơn bạn đã nhắn tin! Muốn mua ngay, hãy bấm Mua ngay để đặt hàng tại cửa hàng chính hãng. Cần hỏi thêm về sản phẩm? Chúng tôi luôn sẵn lòng hỗ trợ — để lại số điện thoại để được liên hệ nhanh hơn.',
  en: 'Thanks for your message! To buy right away, tap Buy now to order from the official store. Have a question about this product? We’re happy to help — leave your phone number and we’ll reach you faster.',
} as const
export const PARTNER_BUY_WELCOME_LINE = `${PARTNER_WELCOME_MARK} ${PARTNER_BUY_WELCOME_PARTS.vi} · ${PARTNER_BUY_WELCOME_PARTS.en}`

/** The two welcome bodies insertMessage accepts for kind 'partner_welcome'. */
export const PARTNER_WELCOME_LINES: readonly string[] = [PARTNER_WELCOME_LINE, PARTNER_BUY_WELCOME_LINE]

/**
 * THE "BUY NOW" LINE (owner, 2026-11-23: "the admin can resurface buy now button which will take into affiliate link"): what the
 * shop's side posts from the thread's staff row (POST /api/conversations/[id]/buy-now, kind 'partner_buy'); the thread page puts
 * the button under it. The URL is NEVER in the body — the button reads it from the thread payload (`buyUrl`).
 */
export const PARTNER_BUY_MARK = '🛒'
export const PARTNER_BUY_PARTS = {
  vi: 'Sẵn sàng mua? Bấm Mua ngay để đặt hàng tại cửa hàng chính hãng.',
  en: 'Ready to buy? Tap Buy now to order from the official store.',
} as const
export const PARTNER_BUY_LINE = `${PARTNER_BUY_MARK} ${PARTNER_BUY_PARTS.vi} · ${PARTNER_BUY_PARTS.en}`

/** A message the "Buy now" button sits under: the buy-now welcome or the shop's "Buy now" line, by kind AND exact body. */
export function isPartnerBuyMessage(m: { kind?: string | null; body: string }): boolean {
  return (m.kind === 'partner_welcome' && m.body === PARTNER_BUY_WELCOME_LINE) || (m.kind === 'partner_buy' && m.body === PARTNER_BUY_LINE)
}

/** The viewer's half of a stored welcome or "Buy now" line; any other text is returned unchanged. */
export function localizePartnerWelcome(text: string, lang: string): string {
  const vi = lang === 'vi'
  if (text === PARTNER_WELCOME_LINE) return `${PARTNER_WELCOME_MARK} ${vi ? PARTNER_WELCOME_PARTS.vi : PARTNER_WELCOME_PARTS.en}`
  if (text === PARTNER_BUY_WELCOME_LINE) return `${PARTNER_WELCOME_MARK} ${vi ? PARTNER_BUY_WELCOME_PARTS.vi : PARTNER_BUY_WELCOME_PARTS.en}`
  if (text === PARTNER_BUY_LINE) return `${PARTNER_BUY_MARK} ${vi ? PARTNER_BUY_PARTS.vi : PARTNER_BUY_PARTS.en}`
  return text
}

/**
 * A number the customer typed into the chat chip, in the app's canonical form (+84…), or null when it is not a phone number.
 * The same detector the rest of the app uses (src/lib/phone.ts), plus the E.164 length bound.
 */
export function typedPhone(raw: string): string | null {
  const n = normalizePhone(raw)
  const digits = n.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 15 || !containsPhoneNumber(n)) return null
  return n
}

/** What the chip sends: an ordinary chat message, language-neutral, the number in the form the reader's chips recognise. */
export const phoneShareText = (phone: string) => `📞 ${phone}`
