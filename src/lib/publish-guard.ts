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
// Expanded 2026-07-06 to match the published /prohibited policy (Weapons Law
// 42/2024 support tools, Resolution 173/2024 vapes, P2P medicine ban, CITES,
// PDPL data-trading ban, SIM/invoice/lending). Every term is multi-word or
// unambiguous after folding — collision-checked ("bang gia" would hit "bảng
// giá" price lists, "lam bang" hits "làm bằng gỗ", "ruou vang" hits "tủ rượu
// vang" wine fridges — all deliberately EXCLUDED; those rely on reports).
const BANNED_WORDS = [
  // drugs
  'ma tuy', 'can sa', 'heroin', 'cocaine', 'thuoc lac', 'ketamine', 'meth', 'thuoc phien', 'bong cuoi',
  // weapons, explosives, fireworks, support tools
  'vu khi', 'sung dan', 'chat no', 'thuoc no', 'luu dan', 'phao no', 'phao hoa',
  'roi dien', 'sung dien', 'binh xit hoi cay', 'con nhi khuc', 'kiem nhat',
  // prostitution / porn
  'mai dam', 'mua dam', 'ban dam', 'khieu dam', 'porn', 'escort', 'gai goi',
  // fraud, documents, money, lending
  'rua tien', 'the cao lau', 'bang lai gia', 'giay to gia', 'tien gia',
  'hoa don do', 'hoa don vat', 'dao han ngan hang', 'cho vay nong', 'doi no thue', 'vang mieng',
  // medicines (no lawful P2P route exists)
  'thuoc ke don', 'thuoc khang sinh', 'thuoc giam can', 'thuoc kich duc', 'thuoc me', 'thuoc ngu',
  // tobacco & vapes (banned goods since 1 Jan 2025)
  'thuoc la dien tu', 'vape', 'pod chill', 'tinh dau pod', 'shisha', 'thuoc la nung nong',
  // wildlife (CITES)
  'nga voi', 'sung te giac', 'cao ho', 'mat gau', 'vay te te', 'dong vat hoang da',
  // SIMs & personal data
  'sim kich hoat san', 'sim rac', 'danh sach khach hang', 'data khach hang',
  // covert surveillance
  'camera nguy trang', 'camera quay len', 'thiet bi nghe len',
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
// Obfuscated email — "name at gmail dot com", "shop (at) yahoo [dot] com", "gmail chấm
// com" (folded → cham). A real TLD must follow so coincidental "… at … dot …" prose
// can't trip it. Every quantifier is BOUNDED (local/domain ≤64, whitespace ≤4) so the
// match is O(n): unbounded `{2,}` + `\s*` made this super-linear and a 5k-char field
// cost ~350ms, amplified 200× by bulk import (ReDoS/DoS lever, verified 2026-07-06).
const EMAIL_OBF = /[a-z0-9._%+-]{2,64}[ \t]{0,4}[([]?[ \t]{0,4}(?:@|\bat\b)[ \t]{0,4}[)\]]?[ \t]{0,4}[a-z0-9-]{2,64}[ \t]{0,4}[([]?[ \t]{0,4}(?:\.|\bdot\b|\bcham\b)[ \t]{0,4}[)\]]?[ \t]{0,4}(?:com|net|org|vn|io|co|info|mail|edu|gov)\b/i
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|io|me|co|info|shop|store|link|xyz)\b/i
const HANDLE = /(?:^|\s)@[a-z0-9._]{3,}/
const SOCIAL = /\b(?:zalo|whatsapp|telegram|wechat|viber|messenger|facebook|instagram|tiktok)\b\s*[:@#]\s*[\w.+-]{2,}/i
const HOUSE = /\bsố\s*nhà\s*\d{1,4}\b/iu

/** True if the text embeds off-platform contact info (incl. obfuscated email) or a house number. */
export function containsContactInfo(text: string | null | undefined): boolean {
  if (!text) return false
  const f = fold(text)
  return EMAIL.test(text) || EMAIL_OBF.test(f) || LINK.test(text) || HANDLE.test(text) || SOCIAL.test(text) || HOUSE.test(text)
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
  assertCleanTexts(input.texts)
}

/** The content screens alone (phone / contact / banned words) — shared by CREATE
 *  (assertPublishable) and EDIT (updateListingCore), so clean-publish-then-edit
 *  can never become a bypass (2026-07-06 compliance verification finding). */
export function assertCleanTexts(texts: (string | null | undefined)[]) {
  for (const t of texts) {
    if (!t) continue
    if (containsPhoneNumber(t)) throw new PublishBlockedError('contact_in_text', 'phone')
    if (containsContactInfo(t)) throw new PublishBlockedError('contact_in_text', 'contact')
    const banned = findBannedWord(t)
    if (banned) throw new PublishBlockedError('banned_words', banned)
  }
}
