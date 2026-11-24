/**
 * HOW WIDE A TITLE OR DESCRIPTION IS IN A SEARCH RESULT, in pixels, the way Seobility measures it (2026-11-24).
 * Fitted against Seobility's own numbers from crawl 3: its `pixel_length_calculated` is Arial at 20px for a <title>
 * (257 titles, mean error 4.7 px with this table) against a 580 px limit, and Arial at 14px for a meta description
 * (85 descriptions, mean error 11.7 px) against 1,000 px. A character count could not hold that line: "🛵 MOTORBIKE RENTAL IN
 * SAIGON – ONLY 100,000... — 100,000 đ" is 58 characters and 631 px, because capitals are a third wider than lower case.
 *
 * The table is Arial's advance width per character in 1/1000 em, for ASCII 32–126 (taken from a browser canvas at 1000px
 * Arial). Vietnamese letters measure as their base letter (their marks sit above or below it);
 * `đ`/`Đ` and the punctuation listed are their own. Anything else is a guess: CJK/Hangul 750 (measured on a Korean shop
 * name), emoji and pictographs 1000, the rest 556 (Arial's digit width).
 */
const ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const

const OTHER: Readonly<Record<string, number>> = {
  '—': 1000, '–': 556, '…': 1000, '·': 333, '₫': 513, 'đ': 556, 'Đ': 722, '’': 222, '‘': 222, '“': 333, '”': 333,
  '•': 350, '×': 584, '²': 333, '€': 556, '°': 400, '№': 1073, ' ': 278,
}

function units(ch: string): number {
  const k = ch.codePointAt(0)!
  if (k >= 32 && k < 127) return ASCII[k - 32]
  const own = OTHER[ch]
  if (own !== undefined) return own
  if (k >= 0x1f000 || (k >= 0x2600 && k < 0x2800)) return 1000
  if (k >= 0x2e80) return 750
  return 556
}

/**
 * Width in px of `text` set in Arial at `sizePx`. Character by character: a Latin letter with marks measures as its base
 * letter, anything else as itself. ⚠️ NOT `normalize('NFD')` OVER THE WHOLE STRING (gate review, 2026-11-24): that splits
 * every Hangul syllable into two or three jamo, each scored as a Latin letter — a Korean name measured about twice its width.
 */
export function serpWidth(text: string, sizePx: number): number {
  let u = 0
  for (const ch of text) {
    const base = ch.normalize('NFD')[0]
    u += units(base.codePointAt(0)! < 0x250 ? base : ch)
  }
  return (u * sizePx) / 1000
}

/** Seobility's limits less a margin for the table's error: a title under 570 px of its 580, a description under 980 of 1,000. */
export const TITLE_MAX_PX = 570
export const DESCRIPTION_MAX_PX = 980

export const titlePx = (s: string): number => serpWidth(s, 20)
export const descriptionPx = (s: string): number => serpWidth(s, 14)
