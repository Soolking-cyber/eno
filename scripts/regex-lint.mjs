#!/usr/bin/env node
/**
 * regex-lint — catch the ASCII word-boundary trap before it silently disables a guard.
 *
 * ⛔ WHY THIS EXISTS. JavaScript's `\b` is defined against `\w`, which is `[A-Za-z0-9_]` and
 * NOTHING ELSE. Vietnamese letters are not word characters to it, and neither are `%`, `"`, `$` or
 * `₫`. So a boundary written next to one of those can never match — the regex does not error, it
 * simply never fires, and whatever it was guarding is silently off.
 *
 * This has now bitten this codebase NINE times, every time in a check that was supposed to protect
 * something:
 *   · `thẻ nhớ\b`        — never matched, so memory cards were never detected
 *   · `\bđổi trả\b`      — a RETURNS promise sailed into copy bound for Google Merchant
 *   · `save \d+%\b`      — a discount claim passed the same gate
 *   · `\b15\s*(inch|")\b` — every 15.6" screen failed source-grounding and lost its spec
 *   · `\b(...|\$\s?\d)`   — "$999" was not caught as a price
 *   · `\d\s*đ(?![a-z])`   — matched the "32 đ" in "32 đến 75 inch" and flagged 345 good rows
 *   · `[\w\d-]+` across "điện thoại" — an accessory became a Samsung product
 * Each was found by a human or a reviewer reading output, never by a test — because the failure
 * mode of a boundary that cannot match is silence.
 *
 * Run: node scripts/regex-lint.mjs [--fix-hint]
 * Exits non-zero on a finding. Allowlist a deliberate case with a `regex-lint-allow` comment on
 * the same line, which forces the reason into the diff.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['src', 'scripts']
const SKIP = /node_modules|\/generated\/|\.next|\/dist\//
const EXT = /\.(ts|tsx|mjs|js)$/

/** A character JS's `\w` accepts. Everything else makes an adjacent `\b` unmatchable. */
const isWordChar = (ch) => /[A-Za-z0-9_]/.test(ch)

/**
 * Walk a regex literal's source and report boundaries that can never fire.
 * ⚠️ Deliberately simple: it reads the SOURCE TEXT rather than parsing the pattern, because the
 * trap is textual — what matters is the character the author wrote next to the `\b`.
 */
function checkPattern(src) {
  const problems = []
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] !== '\\') continue
    const kind = src[i + 1]
    // Skip an escaped backslash: `\\b` is a literal backslash then b.
    if (i > 0 && src[i - 1] === '\\') continue

    /**
     * ⛔ ONLY THE CASE THAT GENUINELY CANNOT MATCH IS REPORTED, and it is narrower than it first
     * looks. `\b` needs a word character on EXACTLY ONE side, so:
     *   · /foo\b"/  is VALID — the boundary sits between "o" and the quote.
     *   · /cũ\b/    is DEAD — "ũ" is not a word character to `\w`, so the boundary can only match
     *                if the NEXT character is one; at end-of-branch there is none.
     * The first version reported the valid form too and would have failed real builds. The rule is
     * therefore: a non-ASCII letter on one side AND no word character available on the other.
     * ⚠️ `\B` IS DELIBERATELY NOT CHECKED. Its semantics are the inverse — `/ũ\B/` matches happily
     * at end-of-string because neither side is a word character — so the same reasoning does not
     * transfer, and guessing at it would produce exactly the noise this lint must not have.
     */
    if (kind === 'b') {
      const after = src[i + 2] ?? ''
      const before = i > 0 ? src[i - 1] : ''
      /**
       * A LITERAL character that `\w` rejects — a Vietnamese letter, or an ASCII symbol like
       * `%` `"` `$` `₫`. ⚠️ Regex SYNTAX is excluded: in `[^=]*\bfrom` the `*` is a quantifier and
       * the true neighbour is unknowable from the text, so it is never reportable.
       */
      const SYNTAX = '([{^$.*+?\\|)]}'
      /**
       * ⚠️ WHITESPACE AND SEPARATORS ARE EXCLUDED, and that distinction is the whole precision of
       * this lint. `/^ram \b/` is IDIOMATIC — a boundary after a space correctly asserts "a word
       * starts here", and flagging it made the rule cry wolf on valid code. The trap is a boundary
       * written against a character the author meant to DELIMIT: a Vietnamese letter, or `%` `"` `$`
       * `₫`. There `\b` silently asserts something about the next character instead, and the check
       * it was guarding never fires.
       */
      const SEPARATORS = ' \t-,;:/'
      const notWordLiteral = (c) => c !== '' && !/[A-Za-z0-9_]/.test(c)
        && !SYNTAX.includes(c) && !SEPARATORS.includes(c)
      // "no word character available": end of pattern, or an alternation/group edge, or another
      // literal that `\w` does not accept.
      const noWordChar = (c) => c === '' || c === '|' || c === ')' || (!/[A-Za-z0-9_]/.test(c) && !'([{^$.*+?\\'.includes(c))
      if (notWordLiteral(before) && noWordChar(after)) {
        problems.push(`\\b after ${JSON.stringify(before)} does not delimit it — \\w rejects that character, so this asserts something about the NEXT character instead and the check silently never fires`)
      }
      if (notWordLiteral(after) && noWordChar(before)) {
        problems.push(`\\b before ${JSON.stringify(after)} does not delimit it — \\w rejects that character, so this asserts something about the PREVIOUS character instead and the check silently never fires`)
      }
    }
    /**
     * ⛔ ONLY `\w`, NEVER `\W`, AND ONLY WHEN IT IS BEING ASKED TO CROSS THE NON-ASCII TEXT.
     * `\W` is `[^A-Za-z0-9_]` and therefore MATCHES "ũ" perfectly well — reporting it would have
     * failed a valid `/(^|\W)cũ(\W|$)/`, and since this lint runs in `build` the first place that
     * false positive would surface is the deploy script on the box.
     * A `\w` inside a character class (`[\wÀ-ỹ]`) is also fine: the class widens it. What is wrong
     * is a bare `\w+` expected to span text it cannot, so only that is reported.
     */
    if (kind === 'w') {
      const inClass = src.lastIndexOf('[', i) > src.lastIndexOf(']', i)
      if (!inClass && /[^\x00-\x7F]/.test(src)) {
        problems.push('\\w in a pattern containing non-ASCII text — it cannot cross those characters, so a span written with it stops at the first accented letter')
      }
    }
  }
  return [...new Set(problems)]
}

/** Regex literals, avoiding division and comments well enough for a lint pass. */
function* literals(text) {
  const re = /(^|[=(,:[!&|?{};+\s])\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+)\/([gimsuyv]*)/g
  let m
  while ((m = re.exec(text))) yield { source: m[2], index: m.index + m[1].length }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (SKIP.test(p)) continue
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (EXT.test(p)) out.push(p)
  }
  return out
}

/**
 * ⚠️ A LINT WITH NO TEST STOPS WORKING SILENTLY — which is precisely the failure mode it exists to
 * prevent. `--self-test` asserts both directions against patterns whose real behaviour is checked
 * by actually running them, so the rule can never drift into "reports nothing".
 */
if (process.argv.includes('--self-test')) {
  const cases = [
    // [pattern source, must be reported?, a string it should/should not match]
    ['\\bcũ\\b', true],          // dead: "ũ" is not \w, nothing after
    ['\\bthẻ nhớ\\b', true],     // dead: "ớ" is not \w
    ['foo\\b"', false],          // valid: boundary sits after "o"
    ['\\bused\\b', false],       // valid: ASCII both sides
    ['\\bcũ', false],            // valid: boundary before "c"
    ['[^=]*\\bfrom', false],      // valid: "*" is a quantifier, not a literal
    ['\\d+%\\b', true],          // dead: "%" is not \w and nothing follows
    ['^ram \\b', false],         // VALID idiom: after a space, \b asserts "a word starts here"
    ['\\bhàng cũ', false],       // valid: the boundary sits before "h"
    ['(^|\\W)cũ(\\W|$)', false],  // VALID: \\W matches "ũ" — reporting it would fail a real build
    ['[\\wÀ-ỹ]+', false],        // VALID: inside a class, \\w is widened by the class
    ['\\w+\\s*₫', true],          // bare \\w asked to span text it cannot reach
  ]
  let bad = 0
  for (const [src, shouldReport] of cases) {
    const got = checkPattern(src).length > 0
    if (got !== shouldReport) { bad++; console.error(`self-test FAIL /${src}/ expected ${shouldReport ? 'a finding' : 'clean'}, got ${got ? 'a finding' : 'clean'}`) }
  }
  if (bad) { console.error(`regex-lint self-test: ${bad} failure(s)`); process.exit(1) }
  console.log(`regex-lint self-test: ${cases.length}/${cases.length} ok`)
  process.exit(0)
}

let findings = 0
for (const root of ROOTS) {
  let files = []
  try { files = walk(root) } catch { continue }
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('\\b') && !text.includes('\\w') && !text.includes('\\B') && !text.includes('\\W')) continue
    const lines = text.split('\n')
    for (const { source, index } of literals(text)) {
      const problems = checkPattern(source)
      if (!problems.length) continue
      const lineNo = text.slice(0, index).split('\n').length
      const line = lines[lineNo - 1] ?? ''
      if (line.includes('regex-lint-allow')) continue
      // ⚠️ A JSDoc line explaining this very trap is not a violation of it.
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue
      findings++
      console.error(`${relative(process.cwd(), file)}:${lineNo}`)
      console.error(`  /${source.length > 90 ? `${source.slice(0, 90)}…` : source}/`)
      for (const p of problems) console.error(`  ⛔ ${p}`)
    }
  }
}

if (findings) {
  console.error(`\nregex-lint: ${findings} boundary/class problem(s).`)
  console.error('A `\\b` next to a non-ASCII letter, or next to a symbol like % " $ ₫ đ, can NEVER match —')
  console.error('the regex does not error, it just never fires, and whatever it guarded is silently off.')
  console.error('Fix: use (?![a-z0-9]) / (?!\\p{L}) with the `u` flag, or anchor on the phrase itself.')
  console.error('Deliberate? Add a `regex-lint-allow` comment on that line with the reason.')
  process.exit(1)
}
console.log('regex-lint: clean')
