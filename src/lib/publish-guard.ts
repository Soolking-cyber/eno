import { containsPhoneNumber } from './phone'
import { fold } from './fold'

// The single publish gate. Listings go LIVE instantly — there is NO held-for-review queue.
// Instead a post is REJECTED up-front so the seller can fix it (or, for a Restricted
// account, wait for their trust to recover). Used by the session post route, /api/v1, MCP,
// and bulk import so every path enforces the same rules. Returned codes map to clear
// messages in the post wizard.

export type PublishBlockCode = 'account_restricted' | 'photo_required' | 'banned_words' | 'contact_in_text'

export class PublishBlockedError extends Error {
  code: PublishBlockCode
  detail?: string
  constructor(code: PublishBlockCode, detail?: string) {
    super(code)
    this.name = 'PublishBlockedError'
    this.code = code
    this.detail = detail
  }
}

// ── Banned content ──────────────────────────────────────────────────────────────────
// ILLEGAL goods/services only — NOT quality/trust words. ("scam"/"lừa đảo"/"fake" are
// deliberately excluded: a legit listing says "hàng thật, không lừa đảo" / "no fake" — those
// are handled by REPORTS, not a word filter.) Matched on the accent-folded text with WORD
// BOUNDARIES so "súng"(sung)→gun never trips "Samsung", and multi-word terms ("súng đạn")
// avoid single-word collisions. Easy to extend.
const BANNED_WORDS = [
  'ma tuy', 'can sa', 'heroin', 'cocaine', 'thuoc lac', 'ketamine', 'meth', 'thuoc phien',
  'vu khi', 'sung dan', 'chat no', 'thuoc no', 'luu dan',
  'mai dam', 'mua dam', 'ban dam', 'khieu dam', 'porn', 'escort', 'gai goi',
  'rua tien', 'the cao lau', 'bang lai gia', 'giay to gia',
].map((w) => fold(w))
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BANNED_RE = new RegExp(`\\b(${BANNED_WORDS.map(escapeRe).join('|')})\\b`)

/** First banned (illegal-content) word found, as its folded form, or null. */
export function findBannedWord(text: string | null | undefined): string | null {
  if (!text) return null
  const m = fold(text).match(BANNED_RE)
  return m ? m[1] : null
}

// ── Off-platform contact / address bypass ───────────────────────────────────────────
// Sellers must not embed a way to reach them off-platform (buyers message in-app). Catch
// emails, links, @handles, and social/messaging app + handle. Matched on RAW text (NOT
// folded) so Vietnamese diacritics disambiguate — "phố"(street) ≠ "phở"(food). Street
// addresses are HARD to detect without false positives ("đường" also means sugar; "số 42"
// is a shoe size), so we only flag the UNAMBIGUOUS "số nhà <n>" (house number). General
// area/district mentions — which a rental/property listing needs — are intentionally allowed.
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|io|me|co|info|shop|store|link|xyz)\b/i
const HANDLE = /(?:^|\s)@[a-z0-9._]{3,}/
const SOCIAL = /\b(?:zalo|whatsapp|telegram|wechat|viber|messenger|facebook|instagram|tiktok)\b\s*[:@#]\s*[\w.+-]{2,}/i
const HOUSE = /\bsố\s*nhà\s*\d{1,4}\b/iu

/** True if the text embeds off-platform contact info or an explicit house number. */
export function containsContactInfo(text: string | null | undefined): boolean {
  if (!text) return false
  return EMAIL.test(text) || LINK.test(text) || HANDLE.test(text) || SOCIAL.test(text) || HOUSE.test(text)
}

/**
 * Throw a PublishBlockedError on the FIRST problem, in priority order:
 *  1. Restricted account (low trust) → can't post until score recovers (not fixable now)
 *  2. No photo, 3. banned words, 4. phone/contact/address in text → fixable while posting.
 * `trustTier` optional so a pre-seller-resolution caller can run the content checks early.
 */
export function assertPublishable(input: { trustTier?: string; images: unknown[]; texts: (string | null | undefined)[] }) {
  if (input.trustTier === 'restricted') throw new PublishBlockedError('account_restricted')
  if (input.images.length < 1) throw new PublishBlockedError('photo_required')
  for (const t of input.texts) {
    if (!t) continue
    if (containsPhoneNumber(t)) throw new PublishBlockedError('contact_in_text', 'phone')
    if (containsContactInfo(t)) throw new PublishBlockedError('contact_in_text', 'contact')
    const banned = findBannedWord(t)
    if (banned) throw new PublishBlockedError('banned_words', banned)
  }
}
