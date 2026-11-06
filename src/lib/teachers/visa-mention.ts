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
  // ⛔ NO LOOKBEHIND (2026-11-06): this module reaches client chunks, and a `(?<!…)` literal is a SyntaxError on Safari
  // 16.0–16.3 (browserslist: safari >= 16). The not-a-letter guard is CONSUMED (`pre`) and given back; fuzzed against
  // the lookbehind form.
  const spelled = folded.replace(/(^|[^a-z])((?:[a-z][._*-]){2,}[a-z])(?![a-z])/g, (_, pre: string, word: string) => pre + word.replace(/[._*-]/g, ''))
  return /(^|[^a-z])(e-?)?visas?([^a-z]|$)/.test(spelled) || thiThuc(folded) || /비자|签证|簽證|ビザ|виза/i.test(raw)
}

/** "thị thực" (visa), but not the tail of "siêu thị thực phẩm": any match whose five characters before are not "sieu ". */
function thiThuc(folded: string): boolean {
  const re = /thi[\s._*-]*thuc/g
  // Only those five characters (2026-11-06, opus gate r27): slice(0, m.index) made Safari's JavaScriptCore rescan the whole
  // prefix on every match, quadratic on a long "sieu thi thuc …" run (100k chars: 225 ms; bounded 1 ms). Same result.
  for (let m = re.exec(folded); m; m = re.exec(folded)) if (!/sieu\s$/.test(folded.slice(Math.max(0, m.index - 5), m.index))) return true
  return false
}
