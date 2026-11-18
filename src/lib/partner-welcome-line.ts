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

/** The viewer's half of the stored line; any other text is returned unchanged. */
export function localizePartnerWelcome(text: string, lang: string): string {
  if (text !== PARTNER_WELCOME_LINE) return text
  return `${PARTNER_WELCOME_MARK} ${lang === 'vi' ? PARTNER_WELCOME_PARTS.vi : PARTNER_WELCOME_PARTS.en}`
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
