import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The marketplace-edition stubs must export everything the chat page imports.
 *
 * ⚠️ THIS TEST IS THE ONLY THING STANDING BETWEEN THE STUBS AND A RUNTIME CRASH, and that is not an
 * overstatement. `next.config.ts` aliases visa-cards / trip-cards to their stubs on a marketplace
 * build, but an alias is a BUNDLER resolution — `tsc` type-checks the chat page against the REAL
 * modules and never sees the stubs at all. So adding an export to visa-cards.tsx, importing it in
 * the chat page, and shipping is a green typecheck, a green build, and a white screen on eno.vn's
 * most-used surface the moment that import is evaluated.
 *
 * Checked by TEXT rather than by importing the modules: visa-cards.tsx is a 'use client' component
 * with a large dependency graph, and importing it in a node test environment is a slow, brittle way
 * to ask a question about names.
 */

const read = (p: string) => readFileSync(p, 'utf8')

/** Every identifier the chat page pulls out of a module. */
function importedNames(source: string, module: string): string[] {
  // Both the braced multi-line form and the single-line form appear in this file.
  // ⚠️ `[^{}]*`, NOT `[\s\S]*?`. The lazy any-character form anchored on the file's FIRST `import {`
  // and ran all the way to this module's `from`, swallowing every import in between — so the test
  // demanded the stub export React's `Fragment` and `useEffect`. Disallowing braces confines the
  // match to one brace group that is immediately followed by the right specifier.
  const re = new RegExp(String.raw`import\s*\{([^{}]*?)\}\s*from\s*'${module}'`)
  const m = source.match(re)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^type\s+/, ''))       // `type Foo` → Foo
    .map((s) => s.split(/\s+as\s+/)[0].trim())   // `Foo as Bar` → Foo
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
}

/** Every name a module exports (const / function / type / class). */
function exportedNames(source: string): Set<string> {
  const out = new Set<string>()
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:const|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)) {
    out.add(m[1])
  }
  return out
}

const PAGE = read('src/app/messages/[id]/page.tsx')

describe.each([
  ['visa-cards', '@/components/marketplace/visa-cards', 'src/components/marketplace/visa-cards.stub.tsx'],
  ['trip-cards', '@/components/marketplace/trip-cards', 'src/components/marketplace/trip-cards.stub.tsx'],
])('%s stub', (_label, moduleSpecifier, stubPath) => {
  const needed = importedNames(PAGE, moduleSpecifier)
  const provided = exportedNames(read(stubPath))

  it('the chat page actually imports from this module (so the test is not vacuous)', () => {
    // Without this, renaming the import path would make every assertion below trivially pass while
    // covering nothing — the same failure mode the SEO landing guard protects against.
    expect(needed.length).toBeGreaterThan(0)
  })

  it.each([[undefined]])('stub exports every symbol the chat page imports', () => {
    const missing = needed.filter((n) => !provided.has(n))
    expect(missing, `add these to ${stubPath} — a marketplace build would crash on them`).toEqual([])
  })
})

describe('the stubs stay inert', () => {
  it('contain no visa or payment vocabulary — the whole reason they exist', () => {
    // The point of aliasing is that these strings never reach a marketplace client chunk. A stub
    // that helpfully explained "e-Visa unavailable" would put the word back in the bundle.
    for (const p of ['src/components/marketplace/visa-cards.stub.tsx', 'src/components/marketplace/trip-cards.stub.tsx']) {
      const body = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(body, `${p} leaks vocabulary outside its comments`).not.toMatch(/PayPal|hộ chiếu|passport/i)
    }
  })
})
