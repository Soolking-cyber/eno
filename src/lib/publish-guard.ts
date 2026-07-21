import { containsPhoneNumber } from './phone'
import { fold } from './fold'
import { countDistinctAngles } from './image-hash-url'

// Every listing must show the item from at least this many DIFFERENT angles (distinct photos,
// not the same shot repeated). Buyers can't inspect condition from one photo; it's also a cheap
// low-effort/scam filter. Enforced server-side via the perceptual hash baked into each image URL.
export const MIN_IMAGE_ANGLES = 3

// The single publish gate. Listings go LIVE instantly — there is NO held-for-review queue.
// Instead a post is REJECTED up-front so the seller can fix it (or, for a Restricted
// account, wait for their trust to recover). Used by the session post route, /api/v1, MCP,
// and bulk import so every path enforces the same rules. Returned codes map to clear
// messages in the post wizard.

export type PublishBlockCode = 'account_restricted' | 'photo_required' | 'photos_min' | 'banned_words' | 'contact_in_text' | 'duplicate_listing'

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
  // covert surveillance / signal jammers
  'camera nguy trang', 'camera quay len', 'thiet bi nghe len', 'thiet bi pha song', 'pha song gps',
  // MLM, uniforms, gambling (low-collision terms added 2026-07-06 to match /prohibited)
  'ban hang da cap', 'quan phuc cong an', 'quan phuc quan doi', 'may danh bac', 'sung ban ca',
  // ── ENGLISH terms ──────────────────────────────────────────────────────────────
  // The audience is English-first, so the VI-only list above let "selling weed / a
  // Glock / Juul pods" publish instantly (2026-07-06 launch audit). Collision-checked
  // against real listings: NO bare 'gun' (glue/nail/spray/heat gun), 'weed' (weed
  // killer), 'pistol'/'rifle' (pistol-grip drill, rifle scope, airsoft), 'silencer'
  // (motorbike exhaust = "silencer" in BrE), or 'ivory' (a fashion colour) — those
  // rely on reports. Everything below is a brand, chemical, or multi-word phrase.
  // drugs
  'cannabis', 'marijuana', 'hashish', 'mdma', 'ecstasy pill', 'crystal meth', 'methamphetamine',
  'magic mushroom', 'lsd', 'xanax', 'valium', 'adderall', 'fentanyl', 'oxycontin', 'oxycodone',
  'tramadol', 'diazepam', 'codeine',
  // weapons
  'firearm', 'handgun', 'revolver', 'shotgun', 'glock', 'taser', 'stun gun', 'grenade',
  'brass knuckle', 'switchblade', 'butterfly knife',
  // vapes & tobacco
  'e-cigarette', 'ecig', 'vaping', 'juul', 'elf bar', 'iqos', 'heets', 'hookah', 'nicotine pod',
  // wildlife (CITES)
  'rhino horn', 'tiger bone', 'pangolin', 'bear bile', 'shark fin', 'elephant tusk',
  // fraud, documents, money
  'fake passport', 'fake id', 'counterfeit money', 'counterfeit currency', 'forged document',
  'stolen credit card', 'money laundering',
  // prostitution
  'prostitute', 'prostitution', 'sex service',
  // covert surveillance / jammers
  'spy camera', 'gps jammer', 'signal jammer',
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
//
// Split by separator to stop the ENGLISH PREPOSITION "at" from reading as "@" in
// ordinary prose (user report: e-visa/service listings — "submit your application at
// evisa.gov.vn", "processed at immigration.gov" were blocked as hidden emails):
//   • literal "@" → accepts a literal OR spelled dot (real/typed addresses).
//   • spelled "at" → REQUIRES a spelled "dot"/"cham" (genuine obfuscation spells both).
// A literal-dot domain after "at" is prose, and stays consistent with a bare
// "evisa.gov.vn" mention, which is already allowed. Real .com/.net/… domains after
// "at" are still caught by LINK; real "@" emails by EMAIL.
const EMAIL_OBF_AT_SIGN = /[a-z0-9._%+-]{2,64}[ \t]{0,4}[([]?[ \t]{0,4}@[ \t]{0,4}[)\]]?[ \t]{0,4}[a-z0-9-]{2,64}[ \t]{0,4}[([]?[ \t]{0,4}(?:\.|\bdot\b|\bcham\b)[ \t]{0,4}[)\]]?[ \t]{0,4}(?:com|net|org|vn|io|co|info|mail|edu|gov)\b/i
const EMAIL_OBF_AT_WORD = /[a-z0-9._%+-]{2,64}[ \t]{0,4}[([]?[ \t]{0,4}\bat\b[ \t]{0,4}[)\]]?[ \t]{0,4}[a-z0-9-]{2,64}[ \t]{0,4}[([]?[ \t]{0,4}(?:\bdot\b|\bcham\b)[ \t]{0,4}[)\]]?[ \t]{0,4}(?:com|net|org|vn|io|co|info|mail|edu|gov)\b/i
// Bare-domain TLDs exclude `co`/`me`: both are everyday Vietnamese syllables, and
// no-diacritic typing with a missing space after a period ("May dep.Co the xem" =
// "Máy đẹp. Có thể xem") reads as a .co domain — it blocked HONEST posts at the
// publish moment (user report 2026-07-14). Full URLs (www./http) still catch them.
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(?:com|net|org|io|info|shop|store|xyz)\b/i
const HANDLE = /(?:^|\s)@[a-z0-9._]{3,}/
const SOCIAL = /\b(?:zalo|whatsapp|telegram|wechat|viber|messenger|facebook|instagram|tiktok)\b\s*[:@#]\s*[\w.+-]{2,}/i
const HOUSE = /\bsố\s*nhà\s*\d{1,4}\b/iu

/** True if the text embeds off-platform contact info (incl. obfuscated email) or a house number. */
export function containsContactInfo(text: string | null | undefined): boolean {
  if (!text) return false
  const f = fold(text)
  return EMAIL.test(text) || EMAIL_OBF_AT_SIGN.test(f) || EMAIL_OBF_AT_WORD.test(f) || LINK.test(text) || HANDLE.test(text) || SOCIAL.test(text) || HOUSE.test(text)
}

/**
 * Throw a PublishBlockedError on the FIRST problem, in priority order:
 *  1. Restricted account (low trust) → can't post until score recovers (not fixable now)
 *  2. No photo, 3. banned words, 4. phone/contact/address in text → fixable while posting.
 * `trustTier` optional so a pre-seller-resolution caller can run the content checks early.
 */
export function assertPublishable(input: { trustTier?: string; images: unknown[]; texts: (string | null | undefined)[] }) {
  if (input.trustTier === 'restricted') throw new PublishBlockedError('account_restricted')
  assertEnoughAngles(input.images)
  assertCleanTexts(input.texts)
}

/** ≥1 photo (photo_required) AND ≥MIN_IMAGE_ANGLES DISTINCT angles (photos_min) — the same
 *  photo uploaded N times still counts as one angle. Shared by CREATE and EDIT so an edit can't
 *  drop a live listing below the bar. Images are the listing's stored URLs (their dHash is in
 *  the URL); older/unhashed images fail open (counted as distinct). */
export function assertEnoughAngles(images: unknown[]) {
  if (images.length < 1) throw new PublishBlockedError('photo_required')
  if (countDistinctAngles(images as string[]) < MIN_IMAGE_ANGLES) throw new PublishBlockedError('photos_min')
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
