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
