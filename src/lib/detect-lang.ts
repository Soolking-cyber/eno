/**
 * Best-effort content-language detection, used ONLY to add a `lang` attribute when
 * user content is rendered in a language different from the page (WCAG 3.1.2 Language
 * of Parts — so a screen reader voices a Vietnamese title with the Vietnamese voice on
 * an English page). It returns a BCP-47 code only for unambiguous scripts or
 * Vietnamese-exclusive letters, and `null` for plain Latin text — so it can ADD a
 * correct tag but never MISLABEL (mislabeling would itself be a WCAG failure).
 */

// Letters essentially exclusive to Vietnamese: horn (ơ/ư), breve (ă), đ, and the
// dot-below toned vowels. Deliberately excludes â/ê/ô/à/é/è/ç etc. shared with
// French/Spanish/Portuguese, so Latin text in those languages never reads as VI.
const VI_EXCLUSIVE =
  /[ăĂđĐơƠưƯạẠặẶậẬẹẸệỆịỊọỌộỘợỢụỤựỰ]/

export function detectContentLang(text: string | null | undefined): string | null {
  if (!text) return null
  if (/[가-힣]/.test(text)) return 'ko' // Hangul
  if (/[぀-ヿ]/.test(text)) return 'ja' // Hiragana / Katakana
  if (/[一-鿿]/.test(text)) return 'zh' // Han (checked after kana)
  if (/[Ѐ-ӿ]/.test(text)) return 'ru' // Cyrillic
  if (/[฀-๿]/.test(text)) return 'th' // Thai
  if (/[؀-ۿ]/.test(text)) return 'ar' // Arabic
  if (VI_EXCLUSIVE.test(text)) return 'vi'
  return null
}

// Any Vietnamese diacritic, not just the language-exclusive ones. Used ONLY to judge whether
// a WORD looks Vietnamese-shaped, so that a long undiacriticked passage can be spotted.
// ⚠️ ISOMORPHIC ON PURPOSE (moved here from src/lib/translate.ts, 2026-09-29): the server's
// "already in the target language" skip and the client's looksVietnamese() gate must draw the line
// in the same place, so they share one table and one cut-off rather than two copies that drift.
export const VI_DIACRITIC =
  /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/

/** Longest run of consecutive words carrying NO Vietnamese diacritic. */
export function longestUndiacritickedRun(text: string): number {
  let run = 0
  let max = 0
  for (const word of text.split(/\s+/)) {
    if (!/\p{L}/u.test(word)) continue // pure digits/punctuation break nothing
    if (VI_DIACRITIC.test(word)) run = 0
    else if (++run > max) max = run
  }
  return max
}

// The Vietnamese letters that are NOT Latin-1 — ă đ ĩ ũ ơ ư and the stacked tones of U+1EA0–U+1EF9
// (ả ầ ế ồ ộ ừ ỹ …). Latin-1's à á â ã è é ê ì í ò ó ô õ ù ú ý are French, Spanish and Portuguese
// letters too, so on their own they say nothing about the language.
const VI_SPECIFIC = /[ĂăĐđĨĩŨũƠơƯưẠ-ỹ]/

/**
 * Is this string, as a whole, already Vietnamese? The CLIENT-ONLY gate in front of a vi-target
 * machine-translation request (src/lib/i18n/mt-client.ts), and the Vietnamese half of a link
 * preview's og:locale (site-identity.ts ogLocaleFor).
 *
 * ⚠️ DELIBERATELY BROADER THAN detectContentLang: "Hồ Chí Minh" and "Hà Nội" carry no letter on its
 * Vietnamese-EXCLUSIVE list (ồ and ộ are not on it), so that detector returns null for them — and a
 * vi home view sent "Hồ Chí Minh" to /api/translate 54 times to get it back unchanged (measured on
 * prod, 2026-09-29).
 * ⚠️ BUT NOT "ANY DIACRITIC" — ONE LETTER FROM VI_SPECIFIC IS THE ENTRY CONDITION. Any mark at all let
 * "Pokémon cards" and "Café for rent" through (é, and a run of 1-2 unmarked words), so a Vietnamese
 * reader was shown them in English with no request made (review, 2026-09-29). The cost runs the
 * other way and is only a request: a Vietnamese string written wholly in Latin-1 letters ("Cho thuê",
 * "Tân Bình") is sent, and the server's own alreadyInTarget/cache answers it as it did before.
 * ⚠️ THE SAME ≤3 CUT-OFF AS THE SERVER'S alreadyInTarget (translate.ts), for the same reason: real
 * Vietnamese is densely marked (its longest unmarked run is 1-2 words: a model name, "pin"), while
 * "Office / shopfront · 65 m² for rent — Tây Thạnh Ward" runs 5.
 */
export function looksVietnamese(text: string): boolean {
  // NFC first: the tables hold PRECOMPOSED letters, and a column stored NFD would read as plain Latin.
  const t = text.normalize('NFC')
  return VI_SPECIFIC.test(t) && longestUndiacritickedRun(t) <= 3
}

/** Share of the words that carry letters which also carry a Vietnamese diacritic (0 when none do). */
export function vietnameseWordShare(text: string): number {
  let words = 0
  let marked = 0
  for (const word of text.split(/\s+/)) {
    if (!/\p{L}/u.test(word)) continue
    words++
    if (VI_DIACRITIC.test(word)) marked++
  }
  return words ? marked / words : 0
}

/**
 * The share of diacritic-bearing words at which a text that has Vietnamese letters counts as
 * Vietnamese. Measured on the 77,990 live descriptions a PDP shows (audit export 2026-10-02): nearly all
 * Vietnamese texts sit at 0.40–0.95, and the few below 0.2 are spec sheets made mostly of English model
 * words. ⚠️ English import templates dense with place names reach 0.35 ("Location: District 2 (An Khánh
 * Ward, new)"), so this line is only drawn where no separate Vietnamese column exists. Every rental
 * carries one, and it always comes first (listing-content.tsx localizedPlan).
 */
const VI_WORD_SHARE = 0.2

/**
 * Is a DESCRIPTION already Vietnamese, so a Vietnamese reader is shown it as it is?
 *
 * ⚠️ NOT detectContentLang, WHICH NAMES A TEXT VIETNAMESE FROM ONE LETTER. "…green Robusta from Đắk Lắk"
 * counted as Vietnamese, so a Vietnamese reader got the English text and never the `vi` row cached
 * for it. That hit 81 live descriptions, all 16 eno Trading ones among them (audit, 2026-10-02).
 * ⚠️ AND NOT looksVietnamese ON ITS OWN. Its ≤3-word cut-off fails real Vietnamese product copy
 * with a run of English model words ("Sạc nhanh Apple iPhone 15 Pro Max USB-C 20W chính hãng"). Used
 * alone it would have sent 10,230 Vietnamese descriptions that a feed copied into both columns to
 * Vietnamese→Vietnamese machine translation.
 * So a text passes either test: looksVietnamese's shape, or a Vietnamese-specific letter with at least
 * a fifth of its words diacritic-marked. Measured on the same export: English shown to a Vietnamese
 * reader as Vietnamese went from 81 to 3; Vietnamese sent to paid vi→vi translation went from 156 to 98.
 * ⚠️ THE KNOWN COST, MEASURED: a terse spec line with one Vietnamese word in five ("iPhone 15 Pro Max
 * 256GB, pin 100%, fullbox, bảo hành") is under the line, so it now takes the translation path where
 * one exclusive letter used to show it as it is. That moved 51 live descriptions: 20 BỀN COMPUTER spec
 * sheets, each already with a cached `vi` row, 28 Tiki book blurbs that are mostly English, and 3 others.
 * A second, lower line for texts with an exclusive letter (0.1) kept 47 of them but put 39 English
 * descriptions back in front of Vietnamese readers, so it was not taken.
 */
export function readsAsVietnamese(text: string): boolean {
  const t = text.normalize('NFC')
  return looksVietnamese(t) || (VI_SPECIFIC.test(t) && vietnameseWordShare(t) >= VI_WORD_SHARE)
}

/**
 * Should an ENGLISH reader get this description in translation? The broad test: any Vietnamese-specific
 * letter, or Latin-1 diacritics on at least a fifth of the words.
 *
 * ⚠️ BROADER THAN detectContentLang ON PURPOSE. "Apple iPhone 14 Pro Max 128GB cũ 99%" and
 * "…chính hãng, giá rẻ" have no Vietnamese-EXCLUSIVE letter, so English readers got them raw and no
 * translation was ever requested (211 live descriptions). A false hit only costs a request:
 * English→English comes back unchanged. The English-slot rule (listing-content.tsx localizedPlan)
 * keeps that cost off English imports that name a ward.
 */
export function mayBeVietnamese(text: string): boolean {
  const t = text.normalize('NFC')
  return VI_SPECIFIC.test(t) || (VI_DIACRITIC.test(t) && vietnameseWordShare(t) >= VI_WORD_SHARE)
}

/**
 * The label an importer puts in front of an untranslated Vietnamese passage it embeds in an English
 * description: "Owner’s description (Vietnamese):" (Mioto) and "Features (Vietnamese):" (BonbonCar).
 * See src/lib/vehicle-rental-listing.ts. A description that carries it is not wholly English, so it
 * keeps the translate path for an English reader even beside a Vietnamese column.
 */
export const VI_PASSAGE_LABEL = '(Vietnamese):'
