import { readFileSync } from 'node:fs'
import ts from 'typescript'

/**
 * ⛔ THE LICENSED MARKETPLACE'S VOCABULARY RULE FOR COPY THAT COMPILES INTO eno.vn (CLAUDE.md, the edition split): no
 * visa, itinerary or PayPal wording, and no permission-to-stay wording either — "work permit" is a labour document and
 * is allowed. ONE COPY FOR EVERY TEST THAT READS SUCH COPY, so the guards cannot drift apart: the teach guides
 * (teach-guides.test.ts, which also proves the reader below sees strings and never comments) and the HCMC Teacher Cost &
 * Pay Index (teacher-cost-index.test.ts and its page test). Moved here unchanged from teach-guides.test.ts (2026-10-21).
 * Multi-word terms match across any run of whitespace (a wrapped JSX line, a double or non-breaking space).
 */
export const EDITION_BANNED = /\bvisas?\b|\be-?visas?\b|evisa|thị\s+thực|itinerar|paypal|temporary\s+residence|residence\s+card|residence\s+permit|\bTRCs?\b|immigration|nhập\s+cảnh|tạm\s+trú|overstay|border\s+run|entry\s+permit|exit\s+permit|extend\s+your\s+stay|sponsorship\s+letter/i

/**
 * Every piece of text a reader could see in a TS/TSX file: string literals, template text and JSX text, read with
 * the TypeScript parser. Comments are never nodes, so nothing has to be stripped (a regex stripper both hid text
 * after `https://` and swallowed code after `://*`; the vocabulary in comments that explain the rule is not text).
 */
export function visibleCodeText(file: string): string {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  // JSX text keeps its entities raw (`&nbsp;`, `&#118;`): decode them, or `tạm&nbsp;trú` would pass.
  const decode = (t: string) =>
    t.replace(/&nbsp;/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text)
    else if (ts.isJsxText(n)) out.push(decode(n.text))
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((sp) => sp.literal.text))
    // Identifiers too: a `<PayPalButton />` or `ROUTES.itinerary` renders a forum surface without a single literal.
    else if (ts.isIdentifier(n)) out.push(n.text)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out.join('\n')
}
