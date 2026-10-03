import { describe, expect, it } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { STORED_VALUE_KEYS, literalsOf, usedEnglishStrings } from '../../../scripts/vi-overrides-used.mjs'

/**
 * ⛔ THE VIETNAMESE DICTIONARY CARRIES NO ENTRY THE CODE CAN NO LONGER ASK FOR.
 *
 * src/generated/vi-overrides.ts is ONE chunk that every Vietnamese page view downloads whole. It is
 * edited by hand far more often than it is regenerated, so reworded copy kept its old entry: on
 * 2026-10-04 254 of 2,152 entries were dead, retired claims among them ("No fakes, no bait prices, no
 * wasted trips", "This listing has been physically verified by an eno.vn agent…") — never rendered,
 * still published at a public chunk URL. The fix is `node scripts/gen-vi-overrides.mjs --prune`; this
 * is the guard that makes the next stale entry a red CI run instead of another month of shipping it.
 *
 * What "used" means — and why it is wider than ui-strings.ts — is in scripts/vi-overrides-used.mjs.
 * Narrowing that rule back to the harvested catalogue fails the first test below on its own: the file
 * holds live keys only a literal accounts for (/about's "At a glance" heading). Widening it to
 * comments is what the detector tests pin, on inline sources rather than on today's copy.
 */

// Parsing every shipped source file takes seconds, not milliseconds — the timeout says so explicitly
// rather than leaning on the CLI's.
const PARSE_TIMEOUT = 60_000

describe('vi-overrides holds no entry for copy the code no longer has', () => {
  it('every key is still a fixed string in shipped source (else: node scripts/gen-vi-overrides.mjs --prune)', () => {
    const used: Set<string> = usedEnglishStrings()
    expect(Object.keys(VI_OVERRIDES).filter((k) => !used.has(k))).toEqual([])
  }, PARSE_TIMEOUT)

  it('every kept stored-value key is still in the dictionary (else drop it from STORED_VALUE_KEYS)', () => {
    expect(STORED_VALUE_KEYS.filter((k: string) => VI_OVERRIDES[k] == null)).toEqual([])
  })
})

describe('the used-string detector', () => {
  it('sees copy that reaches <Tr> through a prop, which the harvested catalogue cannot', () => {
    // content-page.tsx renders `title` as <Tr text={title}> — /about's "At a glance" is exactly this.
    const src = `export const S = () => <ContentSection id="glance" title="At a glance"><p>x</p></ContentSection>`
    expect(literalsOf(src, 'about.tsx')).toContain('At a glance')
  })

  it('does not count a comment as a use — the comment that records a removal quotes the removed copy', () => {
    const src = [
      `// ⚠️ "Active account" WAS REMOVED (owner, 2026-08-11) — do not restore it.`,
      `/* the row used to read "ENO protects you" */`,
      `export const A = () => <div>{/* "Screened listings" */}</div>`,
    ].join('\n')
    const got = literalsOf(src, 'x.tsx')
    expect(got).not.toContain('Active account')
    expect(got).not.toContain('ENO protects you')
    expect(got).not.toContain('Screened listings')
  })

  it('reads a `//` inside a string as part of the string, not as a comment', () => {
    expect(literalsOf(`const s = 'Keep it // still a string'`, 'x.ts')).toContain('Keep it // still a string')
  })

  it('reads escapes and JSX text the way React renders them', () => {
    expect(literalsOf(`const s = 'Don\\'t pay a deposit'`, 'x.ts')).toContain("Don't pay a deposit")
    expect(literalsOf('const s = `No substitution`', 'x.ts')).toContain('No substitution')
    expect(literalsOf('export const P = () => <Tr>\n  Two\n  lines\n</Tr>', 'x.tsx')).toContain('Two lines')
    // The parser keeps `&amp;` as written; React renders `&`, and that is the key <Tr> looks up.
    const jsx = 'export const S = () => <Section title="Price, area &amp; photos">Don&apos;t pay &#8212; ever</Section>'
    expect(literalsOf(jsx, 'x.tsx')).toEqual(expect.arrayContaining(['Price, area & photos', "Don't pay \u2014 ever"]))
  })
})
