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
