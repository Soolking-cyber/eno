import { formatMoneyFull, type MoneyLocale } from '@/lib/vnd'

/**
 * THE PERSISTED OFFER LINES — written once, in both languages, into Message.body, the bell and the push (messages.ts:
 * deliverFirstMessage's "Trả giá · Offered …" and actOnOffer's accept / decline line), and READ back by their opening
 * (thread-deal's agreed price, the bell's headline). One module, so the writer and its readers cannot drift.
 * Client-safe: no server imports.
 */
export const OFFER_ACCEPTED_LINE = '✅ Đã chấp nhận · Offer accepted'
export const OFFER_DECLINED_LINE = '❌ Đã từ chối · Offer declined'
export const OFFER_MADE_LINE = 'Trả giá · Offered'

/** Which offer line a stored text is, by its full bilingual opening — never by its emoji, which a note could start with. */
export function offerLineKind(text: string | null | undefined): 'accepted' | 'declined' | 'offered' | null {
  if (!text) return null
  if (text.startsWith(OFFER_ACCEPTED_LINE)) return 'accepted'
  if (text.startsWith(OFFER_DECLINED_LINE)) return 'declined'
  if (text.startsWith(OFFER_MADE_LINE)) return 'offered'
  return null
}

// The amount the writer formats with English grouping ("3,000,000 đ"), right after the line's opening.
const AMOUNT_RE = new RegExp(`^(${[OFFER_ACCEPTED_LINE, OFFER_DECLINED_LINE].map(esc).join('|')}) — (\\d{1,3}(?:,\\d{3})*) đ|^(${esc(OFFER_MADE_LINE)}) (\\d{1,3}(?:,\\d{3})*) đ`)
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * An offer line with its amount grouped for the reader: "3.000.000 đ" for Vietnamese, as every other price on the page
 * (sweep 2026-10-22: the card said 3.000.000 đ and the line under it 3,000,000 đ). Any other text is returned as is,
 * and so is an offer's own note after the amount.
 */
export function localizeOfferLine(text: string, locale: MoneyLocale): string {
  const m = AMOUNT_RE.exec(text)
  if (!m) return text
  const amount = (m[2] ?? m[4]).replace(/,/g, '')
  const head = m[1] ? `${m[1]} — ` : `${m[3]} `
  return `${head}${formatMoneyFull(Number(amount), '₫', locale)}${text.slice(m[0].length)}`
}
