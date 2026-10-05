import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * ⛔ TWO WAYS A WORD SKIPS THE TRANSLATION LAYER THAT NOTHING ELSE CATCHES (2026-10-04 audit).
 *
 * eslint's react/jsx-no-literals guards JSX TEXT only (`ignoreProps: true`), and the nine machine-
 * translated languages (zh-Hans ko ja ru km ms th fr hi) only ever see what passes through tr() /
 * <Tr> / <Bilingual>. The audit found both of these shipping English to all nine:
 *
 *  1. A person-facing ATTRIBUTE written as a literal — aria-label, alt, title, placeholder… — read
 *     aloud or shown in English whatever the reader chose ("Breadcrumb", "Zoom in", "QR code to book
 *     on …").
 *  2. Copy chosen with `lang === 'vi' ? vi : en` in a CLIENT component — correct for Vietnamese, and
 *     the English branch, untranslated, for the other nine. `tr(en, vi)` returns exactly the same two
 *     strings for en and vi and machine-translates the English for everyone else.
 *
 * A legitimate exception (a sample value, a code, a deliberately fixed-language page) is marked with
 * an `i18n-invariant: <why>` comment on the line or the line above — the reason is the review.
 * Fixed-language pages exempt from the eslint i18n gate (eslint.config.mjs) are exempt here too.
 */

const ROOTS = ['src/components', 'src/app']
// Not reader-facing: tests, stubs, generated files, the EN-only admin chrome, API routes, developer docs and
// the dev-only harnesses under dashboard/dev (unlinked, never in front of a buyer or seller).
const SKIP = /\.(test|spec)\.|\.stub\.|\/generated\/|^src\/app\/(\[lang\]\/)?(admin|developers)\/|^src\/app\/\[lang\]\/dashboard\/dev\/|^src\/components\/admin\/|^src\/app\/api\//
// The fixed-language pages: exactly the i18n gate's eslint ignore list (its block, up to `rules:`).
const LONGFORM = new Set(
  [...(readFileSync('eslint.config.mjs', 'utf8').split('// ── i18n gate')[1]?.split('rules:')[0] ?? '').matchAll(/"(src\/[^"*]+\.tsx)"/g)].map((m) => m[1].replace(/\\\\/g, '')),
)
// Every aria-* attribute that carries words (…label, …description, …roledescription, valuetext, placeholder —
// aria-braillelabel included), plus alt, title and placeholder.
const visibleAttr = (name: string) => /^aria-(\w*label|\w*description|valuetext|placeholder)$/.test(name) || name === 'alt' || name === 'title' || name === 'placeholder'

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p.split('\\').join('/'))
  }
  return out
}

/** Prose a person reads — not a token, a sample e-mail, a URL, a bare code or an ALL-CAPS sample name. */
function isProse(s: string): boolean {
  const v = s.trim()
  if (!/[A-Za-z]{2,}/.test(v)) return false
  if (/^(https?:|mailto:|tel:|\/|#)/.test(v) || /@/.test(v)) return false
  if (/^[A-Z0-9 ]+$/.test(v)) return false // NGUYEN VAN A, DELETE, VND
  if (!/\s/.test(v) && !/^[A-Z][a-z]/.test(v)) return false // a token: snake_case, kebab, camelCase, lowercase key
  return true
}

const marked = (lines: string[], line: number) => /i18n-invariant/.test(lines[line - 1] ?? '') || /i18n-invariant/.test(lines[line - 2] ?? '')

type Hit = { file: string; line: number; text: string }
function scan(): { attrs: Hit[]; branches: Hit[] } {
  const attrs: Hit[] = []
  const branches: Hit[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (SKIP.test(file) || LONGFORM.has(file)) continue
      const src = readFileSync(file, 'utf8')
      const lines = src.split('\n')
      // Comments and blank lines may come before the directive (landmine files open with a comment block).
      const client = /^\s*((\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*['"]use client['"]/.test(src)
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
      const literal = (e: ts.Expression | undefined): string | null =>
        !e ? null : ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : null
      const visit = (n: ts.Node) => {
        if (ts.isJsxAttribute(n) && visibleAttr(n.name.getText(sf))) {
          const tag = (n.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(sf)
          const init = n.initializer
          const value = init && ts.isStringLiteral(init) ? init.text : init && ts.isJsxExpression(init) ? literal(init.expression) : null
          // DOM elements, and components too for the accessible-name attributes (they forward them to the DOM).
          // A component's `title` prop is its own business: <ContentSection title="…" titleVi="…"> is a heading
          // the component translates, not the DOM's tooltip.
          const name = n.name.getText(sf)
          const dom = /^[a-z]/.test(tag)
          // An accessible name or a tooltip is prose even as one lowercase word ("search"). English built
          // into an expression counts too: a template around its ${…} (`Photo ${n}`), a ternary or a `+`
          // with a prose literal on either side (`open ? 'Close menu' : 'Open menu'`, `'Zoom ' + dir`).
          const words = value != null && (isProse(value) || /^[a-z]{3,}$/.test(value.trim()))
          const ex = init && ts.isJsxExpression(init) ? init.expression : undefined
          const proseLit = (e: ts.Expression) => { const t = literal(e); return t != null && /[A-Za-z]{3,}/.test(t) && !/^(https?:|mailto:|tel:|\/|#)/.test(t.trim()) }
          const built = !!ex && (
            (ts.isTemplateExpression(ex) && /[A-Za-z]{3,}/.test([ex.head.text, ...ex.templateSpans.map((x) => x.literal.text)].join(' ')))
            || (ts.isConditionalExpression(ex) && (proseLit(ex.whenTrue) || proseLit(ex.whenFalse)))
            || (ts.isBinaryExpression(ex) && ex.operatorToken.kind === ts.SyntaxKind.PlusToken && (proseLit(ex.left) || proseLit(ex.right))))
          if ((dom || name !== 'title') && (words || built) && !marked(lines, at(n))) attrs.push({ file, line: at(n), text: `<${tag} ${name}=${built ? init!.getText(sf) : `"${value}"`}>` })
        }
        if (client && ts.isConditionalExpression(n)) {
          const cond = n.condition.getText(sf)
          const isLangTest = /\b(lang|locale|uiLang|language|code)\s*[!=]==?\s*['"]vi['"]|['"]vi['"]\s*[!=]==?\s*[\w.]*\b(lang|locale|uiLang|language|code)\b|^\s*!?\s*(vi|isVi|isVietnamese)\s*$|\bisVietnamese\(/.test(cond)
          const copyish = (e: ts.Expression) => {
            const t = literal(e)
            if (t != null) return isProse(t) && !/^[a-z]{2}(-[A-Z]{2})?$/.test(t)
            return ts.isPropertyAccessExpression(e) && /^(vi|en|labelVi|label|nameVi|name|titleVi|title)$/.test(e.name.text)
          }
          // Bare variables too: `lang === 'vi' ? vi : en`, `? labelVi : label` — and the negated test with the
          // branches swapped (`lang !== 'vi' ? en : vi`).
          const isVi = (e: ts.Expression) => ts.isIdentifier(e) && /^(vi|\w+Vi)$/.test(e.text)
          const isEn = (e: ts.Expression) => ts.isIdentifier(e) && /^(en|\w+En|label|name|title|text|body|copy)$/.test(e.text)
          const identPair = (isVi(n.whenTrue) && isEn(n.whenFalse)) || (isEn(n.whenTrue) && isVi(n.whenFalse))
          if (isLangTest && (identPair || (copyish(n.whenTrue) && copyish(n.whenFalse))) && !marked(lines, at(n))) {
            branches.push({ file, line: at(n), text: n.getText(sf).replace(/\s+/g, ' ').slice(0, 120) })
          }
        }
        ts.forEachChild(n, visit)
      }
      visit(sf)
    }
  }
  return { attrs, branches }
}

describe('i18n leaks (the nine machine-translated languages)', () => {
  const { attrs, branches } = scan()

  it('reads the fixed-language exemptions out of eslint.config.mjs (fails closed if that block moves)', () => {
    expect(LONGFORM.size).toBeGreaterThan(20)
  })

  it('no person-facing DOM attribute is a hardcoded literal', () => {
    expect(attrs.map((h) => `${h.file}:${h.line}  ${h.text}`), 'wrap it: aria-label={tr(en, vi)} — or mark `// i18n-invariant: why`').toEqual([])
  })

  it('no client component picks copy with `lang === \'vi\' ? vi : en`', () => {
    expect(branches.map((h) => `${h.file}:${h.line}  ${h.text}`), 'use tr(en, vi): same output for en/vi, machine translation for the nine others — or mark `// i18n-invariant: why` (a place name, a code)').toEqual([])
  })
})
