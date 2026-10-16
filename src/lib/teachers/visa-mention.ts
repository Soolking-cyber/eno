import { fold } from '@/lib/fold'

/**
 * A visa MENTION in a person's own words. ⚠️ NOT job-listing's `hasVisaWord`, which is a fail-closed
 * SUBSTRING test built for scraped ads — on a teacher's profile it blocked real people: "Western
 * Visayas", "Visayas State University", the name "Visakha" (Opus, commit gate 09-30). Here "visa" must
 * stand as its own word (visa, visas, e-visa, #visa). "thị thực" is also the tail of "siêu thị thực
 * phẩm" (a food supermarket), so that one reading is excluded; CJK/Cyrillic words match as before.
 *
 * A pure module (2026-10-15) so the CV import (src/lib/teachers/import-map.ts) drops the same words the publish core
 * refuses (publish.ts screenTeacherTexts, which re-exports this) — an imported bio must never be refused at Publish.
 */
export function teacherVisaMention(raw: string): boolean {
  const folded = fold(raw)
  // Only SPELLED-OUT letters are collapsed (v.i.s.a → visa). Stripping every joiner was a bypass:
  // "visa-sponsored" became "visasponsored" and no longer stood as a word (Opus, commit gate 09-30).
  const spelled = folded.replace(/(?<![a-z])(?:[a-z][._*-]){2,}[a-z](?![a-z])/g, (m) => m.replace(/[._*-]/g, ''))
  return /(^|[^a-z])(e-?)?visas?([^a-z]|$)/.test(spelled) || /(?<!sieu\s)thi[\s._*-]*thuc/.test(folded) || /비자|签证|簽證|ビザ|виза/i.test(raw)
}
