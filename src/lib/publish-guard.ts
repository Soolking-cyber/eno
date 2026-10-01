import { containsPhoneNumber } from './phone'
import { fold } from './fold'
import { countDistinctAngles } from './image-hash-url'
// Client-safe (its only import is the edition flag) — publish-guard is also bundled into the wizard.
import { canPublish, type VerificationStatus } from './compliance/account-state'

// Every listing must show the item from at least this many DIFFERENT angles (distinct photos,
// not the same shot repeated). Buyers can't inspect condition from one photo; it's also a cheap
// low-effort/scam filter. Enforced server-side via the perceptual hash baked into each image URL.
import { hasRealCoords } from '@/lib/geo'

export const MIN_IMAGE_ANGLES = 3

// Categories that sell WORK, not an object — one photo is enough (owner, 2026-07-21).
// The 3-angle rule exists so a buyer can inspect a physical item's condition before
// paying. A visa service, a language lesson or a cleaner has no object to photograph
// from three sides, so the rule can only be satisfied by padding: the same shot three
// times, or unrelated stock images. That is strictly worse than one honest photo, and
// it was blocking real service listings. Extra photos stay welcome, just not required.
const SINGLE_PHOTO_CATEGORIES = new Set(['services'])

/** Minimum DISTINCT photos required to publish in this category. */
export function minPhotosFor(categorySlug: string | null | undefined): number {
  return categorySlug && SINGLE_PHOTO_CATEGORIES.has(categorySlug) ? 1 : MIN_IMAGE_ANGLES
}

// The single publish gate. Listings go LIVE instantly — there is NO held-for-review queue.
// Instead a post is REJECTED up-front so the seller can fix it (or, for a Restricted
// account, wait for their trust to recover). Used by the session post route, /api/v1, MCP,
// and bulk import so every path enforces the same rules. Returned codes map to clear
// messages in the post wizard.

// `contact_in_name` is deliberately SEPARATE from `contact_in_text`. Both mean "off-platform
// contact info would go public", but they are fixed in completely different places: one by
// editing the listing, the other in account Settings. Folding them together produced a real
// dead end — a seller whose account display name was their raw email got "remove the phone
// number/email from your LISTING" on a listing whose title and description were clean, with
// no hint that the offending text was their own name and no way to change it from that screen.
// ⚠️ `identity_unverified` / `identity_expired` are LEGAL blocks, not quality blocks, and they are
// listed first because they are checked first (see assertPublishable). Verification is required to
// publish under NĐ 248/2026 — see docs/compliance-2026.md §1 and src/lib/compliance/account-state.ts.
export type PublishBlockCode = 'identity_unverified' | 'identity_pending' | 'identity_expired' | 'identity_suspended' | 'identity_sign_in_required' | 'account_restricted' | 'released_charge_listing_cap' | 'photo_required' | 'photos_min' | 'banned_words' | 'contact_in_text' | 'contact_in_name' | 'duplicate_listing' | 'location_required' | 'category_not_postable'

// ⚠️ `identity_sign_in_required` IS THE GUEST'S CODE, AND IT IS DISTINCT FROM `identity_unverified` ON
// PURPOSE. Both mean "verify before you sell", but a guest has no account to verify: sending them to
// /dashboard/account/verify bounces them through sign-in with no explanation of why. The wizard turns
// this one into "sign in, then verify", which is the only sequence that can actually succeed.
// Emitted only by the seller publish gate (src/lib/compliance/seller-publish-gate.ts) while
// IDENTITY_GATE_ENFORCED is on — never while it is off.

/** The identity (legal) subset of the publish codes — the ones that answer 403 + publishBlockedBody. */
export type IdentityBlockCode = Extract<PublishBlockCode, `identity_${string}`>

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
  // ⚠️ The same offence worded for an eSIM, which the Services › eSIM aisle (2026-09-25) invites:
  // reselling an already-registered profile is trading a pre-activated SIM (ND 163/2024). Measured
  // before adding: 0 listings in prod match, and neither does the imported carrier copy.
  // ⛔ NOT 'sim/esim đã kích hoạt' ("already activated"): that also describes a DEVICE's state —
  // "Apple Watch LTE, eSIM đã kích hoạt" — and a hard block on an honest used-watch post is the
  // false positive the launch-leniency policy forbids (a reviewer's catch). Only "kích hoạt sẵn"
  // (pre-activated) is unambiguous; other phrasings are the AI moderation `data_sim` class's job.
  'esim kich hoat san',
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
  // pre-activated SIMs (the Vietnamese terms are above)
  'pre-activated sim', 'preactivated sim', 'pre-activated esim', 'preactivated esim',
  // ── ADVERTISING-BANNED GOODS that /prohibited already lists (2026-10-01) ─────────────────────
  // Advertising Law 16/2012 Art 7 + Resolution 173/2024. ONLY names that mean the regulated product
  // and nothing else — every term below matched 0 live listings when added, except the genuine
  // veterinary rows: 'bravecto' 2, 'bravecto24' 1 and 'nexgard' 7 (the 2026-10-01 read-only dry run),
  // which src/lib/ad-banned.ts also bans.
  // ⛔ DELIBERATELY NOT HERE: alcohol, infant formula, feeding bottles, teats/pacifiers. Each needs
  // context a word list does not have — "ly Hennessy" (a glass), "tủ rượu" (a cabinet), "máy hâm
  // bình sữa" (a bottle warmer), "hộp đựng núm ti giả" (a pacifier case), "Sữa cho bé 2-6 tuổi"
  // (allowed), and bare "ti gia" is also "tỉ giá" (exchange rate). Those are classified with strength,
  // age and head-noun parsing in src/lib/ad-banned.ts, which screens every IMPORT; user posts in
  // those categories rely on reports and the AI moderation pass, per the launch-lenience policy.
  // vapes, heated tobacco, nicotine products ('vape', 'iqos', 'juul' … are above)
  'vapes', 'e-cig', 'e-cigs', 'e-liquid', 'eliquid', 'e-juice', 'tinh dau vape', 'pod vape', 'vape pod',
  'salt nic', 'saltnic', 'heated tobacco', 'thuoc la the he moi', 'terea', 'relx', 'vaporesso', 'voopoo',
  'geekvape', 'elfbar', 'nicotine pouch', 'nicotine pouches',
  // veterinary prescription parasiticides ("Medicines of every kind" on /prohibited)
  'bravecto', 'bravecto24', 'nexgard', 'simparica', 'credelio',
  // prescription medicines by name ('xanax', 'tramadol', 'codeine' … are above)
  'amoxicillin', 'amoxicilin', 'augmentin', 'azithromycin', 'cephalexin', 'ciprofloxacin', 'doxycycline',
  'sildenafil', 'tadalafil', 'viagra', 'cialis', 'isotretinoin', 'accutane', 'ozempic', 'semaglutide',
  'wegovy', 'mounjaro', 'tirzepatide', 'saxenda', 'misoprostol', 'mifepristone', 'clenbuterol',
].map((w) => fold(w))
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const BANNED_RE = new RegExp(`\\b(${BANNED_WORDS.map(escapeRe).join('|')})\\b`)

/** First banned (illegal-content) word found, as its folded form, or null. */
export function findBannedWord(text: string | null | undefined): string | null {
  if (!text) return null
  const m = fold(text).match(BANNED_RE)
  return m ? m[1] : null
}

/**
 * ── THE ACCENTED SPELLING OF EVERY VIETNAMESE TERM ABOVE (the import screen's accent-aware match) ──
 *
 * The folded list cannot tell "bán dâm" (prostitution) from "xanh cô ban đậm" (dark cobalt blue),
 * "vũ khí" (weapon) from "vi vu khi" (wandering about when…), "thuốc phiện" (opium) from "thuộc phiên
 * bản" (belongs to the version), "ma túy" from "mật mã tùy thích" (a padlock). Measured 2026-10-01 over
 * the live imported catalogue, folding collisions like these refused hundreds of merchant rows. A
 * seller's own post keeps the folded match (findBannedWord — a seller who types without accents must
 * not slip through); IMPORTED rows, whose merchant copy is written with accents, are read with
 * findBannedWordAccentAware below.
 * ⚠️ A TERM MISSING HERE FALLS BACK TO THE FOLDED MATCH — the safe direction: a missing entry can only
 * keep a false positive, never let a banned word through. Keep it in step with BANNED_WORDS
 * (publish-guard.test.ts checks every key is a banned word and every spelling folds to its key).
 */
export const BANNED_ACCENTED: Readonly<Record<string, readonly string[]>> = {
  'ma tuy': ['ma túy'], 'can sa': ['cần sa'], 'thuoc lac': ['thuốc lắc'], 'thuoc phien': ['thuốc phiện'], 'bong cuoi': ['bóng cười'],
  'vu khi': ['vũ khí'], 'sung dan': ['súng đạn'], 'chat no': ['chất nổ'], 'thuoc no': ['thuốc nổ'], 'luu dan': ['lựu đạn'],
  'phao no': ['pháo nổ'], 'phao hoa': ['pháo hoa'], 'roi dien': ['roi điện'], 'sung dien': ['súng điện'],
  'binh xit hoi cay': ['bình xịt hơi cay'], 'con nhi khuc': ['côn nhị khúc'], 'kiem nhat': ['kiếm nhật'],
  'mai dam': ['mại dâm'], 'mua dam': ['mua dâm'], 'ban dam': ['bán dâm'], 'khieu dam': ['khiêu dâm'], 'gai goi': ['gái gọi'],
  'rua tien': ['rửa tiền'], 'the cao lau': ['thẻ cào lậu'], 'bang lai gia': ['bằng lái giả'], 'giay to gia': ['giấy tờ giả'],
  'tien gia': ['tiền giả'], 'hoa don do': ['hóa đơn đỏ'], 'hoa don vat': ['hóa đơn vat'], 'dao han ngan hang': ['đáo hạn ngân hàng'],
  'cho vay nong': ['cho vay nóng'], 'doi no thue': ['đòi nợ thuê'], 'vang mieng': ['vàng miếng'],
  'thuoc ke don': ['thuốc kê đơn'], 'thuoc khang sinh': ['thuốc kháng sinh'], 'thuoc giam can': ['thuốc giảm cân'],
  'thuoc kich duc': ['thuốc kích dục'], 'thuoc me': ['thuốc mê'], 'thuoc ngu': ['thuốc ngủ'],
  'thuoc la dien tu': ['thuốc lá điện tử'], 'tinh dau pod': ['tinh dầu pod'], 'thuoc la nung nong': ['thuốc lá nung nóng'],
  'nga voi': ['ngà voi'], 'sung te giac': ['sừng tê giác'], 'cao ho': ['cao hổ'], 'mat gau': ['mật gấu'], 'vay te te': ['vảy tê tê'],
  'dong vat hoang da': ['động vật hoang dã'],
  'sim kich hoat san': ['sim kích hoạt sẵn'], 'sim rac': ['sim rác'], 'danh sach khach hang': ['danh sách khách hàng'],
  'data khach hang': ['data khách hàng'], 'esim kich hoat san': ['esim kích hoạt sẵn'],
  'camera nguy trang': ['camera ngụy trang'], 'camera quay len': ['camera quay lén'], 'thiet bi nghe len': ['thiết bị nghe lén'],
  'thiet bi pha song': ['thiết bị phá sóng'], 'pha song gps': ['phá sóng gps'],
  'ban hang da cap': ['bán hàng đa cấp'], 'quan phuc cong an': ['quân phục công an'], 'quan phuc quan doi': ['quân phục quân đội'],
  'may danh bac': ['máy đánh bạc'], 'sung ban ca': ['súng bắn cá'],
  'tinh dau vape': ['tinh dầu vape'], 'thuoc la the he moi': ['thuốc lá thế hệ mới'],
}

const COMBINING = /[̀-ͯ]/g
/** The five Vietnamese tone marks (huyền, sắc, ngã, hỏi, nặng) — a real syllable carries at most ONE. */
const VI_TONES = new Set(['\u0300', '\u0301', '\u0303', '\u0309', '\u0323'])
/** The vowel marks Vietnamese writes besides a tone: circumflex (â ê ô), breve (ă), horn (ơ ư). */
const VI_VOWEL_MARKS = new Set(['\u0302', '\u0306', '\u031b'])
/**
 * One syllable's identity WITH its accents but independent of where the tone mark sits — old-style
 * "hoá"/"tuý" and new-style "hóa"/"túy" are the same word: the base letters, the SET of marks, and đ.
 * ⛔ A SET, NOT A LIST (2026-10-01, review): "tú́y" (ú + a second combining acute, which NFC cannot
 * compose) is "túy" with a doubled mark, not another word.
 * ⛔ NULL = NOT A VIETNAMESE SPELLING AT ALL — two different tone marks ("tụ́y"), a mark Vietnamese never
 * writes ("tüy"), or a mark with no letter under it. No real word is spelled that way, so its accents
 * cannot prove it is a DIFFERENT word from the banned one: the caller reads it on its folded letters,
 * exactly like a word typed without accents (the safe direction — the row goes to review, never live).
 */
function syllableSig(w: string): string | null {
  const d = w.normalize('NFD').toLowerCase()
  if (/^\p{M}/u.test(d)) return null
  const marks = [...new Set(d.match(COMBINING) ?? [])].sort()
  if (marks.some((m) => !VI_TONES.has(m) && !VI_VOWEL_MARKS.has(m))) return null
  if (marks.filter((m) => VI_TONES.has(m)).length > 1) return null
  return `${d.replace(COMBINING, '').replace(/đ/g, 'd')}|${marks.join('')}|${d.includes('đ') ? 'đ' : ''}`
}
/** Does this text carry Vietnamese accents at all? One that does was typed WITH them. */
const isAccented = (raw: string) => /[\u0300-\u036f]/.test(raw.normalize('NFD')) || /[đĐ]/.test(raw) // not COMBINING: a /g regex's .test() is stateful
/**
 * ⛔ \p{M} IS PART OF A WORD (2026-10-01, review). Splitting on everything that is not a letter or a
 * digit cut "tú́y" — ú plus a combining acute NFC has no precomposed form for — into "tú" + "y", so the
 * folded hit 'ma tuy' matched no run of words and the screen answered null while findBannedWord said
 * 'ma tuy'. A combining mark belongs to the letter before it.
 */
const tokensOf = (raw: string) => raw.normalize('NFC').split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)

/**
 * findBannedWord, read with the accents — FOR IMPORTED ROWS ONLY (src/lib/import-screen.ts). A seller's
 * own post never comes through here: assertCleanTexts / findBannedWord keep the folded match.
 *
 * A folded hit on a Vietnamese term is judged WORD BY WORD over the words that produced it:
 *   · a word typed WITH accents must carry that term's accents ("vũ khí", "bán dâm"; tone-mark
 *     placement ignored) — "vì vụ khi", "thuộc phiên", "mật mã tùy", "cô ban đậm" do not;
 *   · a word typed WITHOUT accents matches on its folded letters alone — it carries no accent that
 *     could tell it apart, so the term counts.
 * ⛔ PER WORD, NOT PER TEXT (2026-10-01, review). The first version asked "does the TEXT carry accents
 * at all?" and, if it did, required every word of the term to carry the term's accents — so "Cần bán
 * sung dan" (an unaccented banned term inside an otherwise accented title) passed. A title that mixes
 * the two is exactly what an evasion looks like, so an unaccented word is now always read folded.
 * ⚠️ THE PRICE: an unaccented phrase that honestly folds onto a term is refused again — "vi vu khi"
 * ("wandering about when", no accents in correct Vietnamese) reads as "vũ khí". That is the safe
 * direction: the row goes to the review file, never live.
 * English terms and any term without an entry in BANNED_ACCENTED match exactly as findBannedWord does.
 */
export function findBannedWordAccentAware(text: string | null | undefined): string | null {
  if (!text) return null
  const folded = fold(text)
  const hits = [...folded.matchAll(new RegExp(BANNED_RE.source, 'g'))].map((m) => m[1])
  if (!hits.length) return null
  if (!isAccented(text)) return hits[0]
  const raw = tokensOf(text)
  const foldedTokens = raw.map((t) => fold(t))
  for (const term of hits) {
    const spellings = BANNED_ACCENTED[term]
    if (!spellings) return term
    const want = term.split(' ')
    const sigs = spellings.map((s) => s.split(' ').map(syllableSig))
    let located = false
    for (let i = 0; i + want.length <= raw.length; i++) {
      if (!want.every((w, j) => foldedTokens[i + j] === w)) continue
      located = true
      const span = raw.slice(i, i + want.length)
      // An unaccented word already matched on its folded letters (the line above), and so does one whose
      // accents are no Vietnamese spelling (syllableSig → null); a properly accented one must carry the
      // term's own accents.
      const spanSigs = span.map((w) => (isAccented(w) ? syllableSig(w) : null))
      if (sigs.some((sig) => sig.every((s, j) => spanSigs[j] === null || s === spanSigs[j]))) return term
    }
    // ⛔ FAIL CLOSED: the folded text holds this term, yet no run of words reproduces it — the two readings
    // of the text disagree, so nothing here can show the accents clear it. It counts, as findBannedWord says.
    if (!located) return term
  }
  return null
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

/**
 * The seller's public contact NAME, screened with the same rules as listing text and
 * reported under its own code so the message can point at Settings rather than the listing.
 * Called before the listing-text screens so the more specific diagnosis wins.
 */
export function assertCleanContactName(name: string | null | undefined) {
  if (!name) return
  if (containsPhoneNumber(name)) throw new PublishBlockedError('contact_in_name', 'phone')
  if (containsContactInfo(name)) throw new PublishBlockedError('contact_in_name', 'contact')
  const banned = findBannedWord(name)
  if (banned) throw new PublishBlockedError('banned_words', banned)
}

/**
 * A public-safe rendering of an account name. When the stored name IS contact info — an
 * email typed into the display-name field, which /api/profile used to accept because it
 * only screened for PHONE numbers — fall back to the masked handle that ensureProfile()
 * would have created ("le***"). This is what keeps a legacy row from being unpublishable:
 * the seller does not have to repair their account before they can post, and their email
 * still never reaches a public listing.
 */
export function publicSafeName(name: string | null | undefined): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return ''
  if (!containsContactInfo(trimmed) && !containsPhoneNumber(trimmed)) return trimmed
  const local = trimmed.split('@')[0]?.trim()
  return local && local.length >= 2 ? `${local.slice(0, 2)}***` : ''
}

/** True if the text embeds off-platform contact info (incl. obfuscated email) or a house number. */
export function containsContactInfo(text: string | null | undefined): boolean {
  if (!text) return false
  const f = fold(text)
  return EMAIL.test(text) || EMAIL_OBF_AT_SIGN.test(f) || EMAIL_OBF_AT_WORD.test(f) || LINK.test(text) || HANDLE.test(text) || SOCIAL.test(text) || HOUSE.test(text)
}

/**
 * Throw a PublishBlockedError on the FIRST problem, in priority order:
 *  0. Identity not verified → LEGAL block (NĐ 248/2026); everything else is moot until it clears
 *  1. Restricted account (low trust) → can't post until score recovers (not fixable now) — unless
 *     every standing scam charge was RELEASED by an admin, and then 1b. at most
 *     ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS active listings while a released charge stands
 *  2. No photo, 3. banned words, 4. phone/contact/address in text → fixable while posting.
 * `trustTier` optional so a pre-seller-resolution caller can run the content checks early.
 *
 * ⚠️ THE IDENTITY CHECK LIVES HERE, NOT IN ROUTE MIDDLEWARE, AND THAT IS THE WHOLE POINT.
 * There is no single "create listing" endpoint to intercept: the web wizard posts to
 * /api/listings, there is a bulk path, and the partner API syncs listings under /api/v1 with
 * per-key auth and NO user session at all. A middleware bolted to one of those gates one door in a
 * three-door building — and the fourth door is the one somebody adds next quarter. Every publish
 * path already funnels through this function (src/lib/core/listings.ts:607), so putting the gate
 * here is what makes it exhaustive rather than merely present.
 *
 * ⚠️ `verificationStatus` IS OPTIONAL FOR A REASON, AND THE DEFAULT IS TO ALLOW.
 * Callers that run content checks early (the wizard, previewing) legitimately have no profile
 * loaded. Making an absent status BLOCK would break those call sites; making it block *silently*
 * would be worse. The authoritative check happens on the server path that does have the profile —
 * so `undefined` here means "not this caller's job", never "unverified".
 */
export function assertPublishable(input: {
  trustTier?: string
  verificationStatus?: string
  /**
   * The released-scam-charge regime (src/lib/released-charge-gate.ts), resolved by the server caller;
   * absent/null = not in it. `waivesRestricted` lifts step 1 for a seller whose only standing scam
   * charges an admin RELEASED; `remaining` ≤ 0 refuses with `released_charge_listing_cap` — both
   * account-level refusals, so they come before the content screens, like step 1.
   */
  releasedCharge?: { waivesRestricted: boolean; remaining: number } | null
  images: unknown[]
  texts: (string | null | undefined)[]
  categorySlug?: string | null
  lat?: number | null
  lng?: number | null
  district?: string | null
}) {
  assertIdentityVerified(input.verificationStatus)
  if (input.trustTier === 'restricted' && !input.releasedCharge?.waivesRestricted) throw new PublishBlockedError('account_restricted')
  if (input.releasedCharge && input.releasedCharge.remaining <= 0) throw new PublishBlockedError('released_charge_listing_cap')
  assertEnoughAngles(input.images, input.categorySlug)
  assertCleanTexts(input.texts)
  assertHasLocation({ district: input.district, lat: input.lat, lng: input.lng })
}

/**
 * Identity gate (NĐ 248/2026). Each state throws a DISTINCT code because each needs different
 * words and a different call to action — "we couldn't read your photo, try again" and "your
 * account is suspended" must never reach the same user.
 */
export function assertIdentityVerified(status: string | undefined | null) {
  if (status == null) return // caller has no profile loaded — see the note above
  const code = identityBlockCodeFor(status)
  if (code) throw new PublishBlockedError(code)
}

/**
 * The refusal a verification status maps to, or null when it may publish.
 *
 * ⛔ "MAY IT PUBLISH" IS canPublish()'S ANSWER, NOT THIS SWITCH'S. account-state.ts calls canPublish
 * "THE ONLY FUNCTION THAT DECIDES PUBLISHING", and until the seller gate landed it had no callers —
 * this switch carried its own `case 'verified': return`, i.e. a second copy of the predicate. The
 * switch below now only chooses WHICH words a refusal gets; whether there is a refusal at all is
 * delegated, so the two can never disagree.
 */
export function identityBlockCodeFor(status: string): IdentityBlockCode | null {
  // The cast is safe in the direction that matters: canPublish is `status === 'verified'`, so an
  // unrecognised string is simply not publishable and falls through to the fail-closed default.
  if (canPublish(status as VerificationStatus)) return null
  switch (status) {
    case 'pending': return 'identity_pending'
    case 'expired': return 'identity_expired'
    case 'revoked': return 'identity_suspended'
    // 'unverified' | 'rejected' | anything unrecognised. ⚠️ FAIL CLOSED on an unknown value: a
    // typo or a future status must not silently become permission to publish.
    default: return 'identity_unverified'
  }
}

/** A listing must say WHERE it is (owner, 2026-07-22: "users shouldnt be able to post
 *  without location").
 *
 *  ⚠️ "Location" means the PLACE THE SELLER PICKED — the ward/district from the area
 *  picker — NOT coordinates. lat/lng are an OPTIONAL precise pin that only exists when
 *  someone taps "use my current location", so gating on them rejected every ordinary
 *  listing and broke posting outright the moment it shipped. Coordinates satisfy the gate
 *  when present, but they are never required.
 *
 *  `city` is NOT accepted as proof: the create path defaults it to 'Ho Chi Minh City', so
 *  a gate that took it would pass for a seller who chose nothing at all.
 *
 *  hasRealCoords, not `!= null`, on the coordinate branch: writers that default a missing
 *  coordinate to 0 store (0,0) — open ocean off West Africa — and a gate that accepts 0 is
 *  not a gate. That is how eight live listings came to plot "south of Africa".
 */
export function assertHasLocation(input: { district?: string | null; lat?: number | null; lng?: number | null }) {
  if (input.district && String(input.district).trim()) return
  if (hasRealCoords(input.lat, input.lng)) return
  throw new PublishBlockedError('location_required')
}

/** ≥1 photo (photo_required) AND ≥minPhotosFor(category) DISTINCT angles (photos_min) — the
 *  same photo uploaded N times still counts as one angle. Shared by CREATE and EDIT so an edit
 *  can't drop a live listing below the bar. Images are the listing's stored URLs (their dHash is
 *  in the URL); older/unhashed images fail open (counted as distinct).
 *  `categorySlug` relaxes the bar to a single photo for service categories — pass it on every
 *  path, or a service listing gets held to the physical-goods rule. */
export function assertEnoughAngles(images: unknown[], categorySlug?: string | null) {
  if (images.length < 1) throw new PublishBlockedError('photo_required')
  // One required photo means the distinct-angle check is vacuous — a single image is
  // always one distinct angle — so this collapses to the photo_required check above.
  if (countDistinctAngles(images as string[]) < minPhotosFor(categorySlug)) throw new PublishBlockedError('photos_min')
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
