import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { REPORT_SENTENCE } from '@/app/[lang]/c/[category]/category-copy'
import { RETIRED_TRUST_CLAIMS as RETIRED } from '@/lib/copy-rules'

/**
 * ⛔ THE RETIRED TRUST CLAIMS STAY RETIRED (owner decision 2026-10-04).
 *
 * "Every seller has a public trust score and bad listings get reported." (and its Vietnamese, "… và tin
 * xấu sẽ bị báo cáo") was untrue wherever an official partner (partner badge instead of a score) or an
 * ownerless storefront (no score at all — src/lib/linked-seller.ts) holds the shelf, and "tin xấu" reads
 * as "bad news". The owner's replacement is REPORT_SENTENCE, verbatim. The older outcome claims — "fewer
 * fakes, fewer bait prices", "so fakes and bait prices get caught fast / do not last" — measure nothing,
 * and the unused t() keys carried "Your Trusted Vietnam Network" and "Guaranteed real prices".
 *
 * Every copy of them sat in a different file (category ledes, the SEO landing strip, /about, a guide, a
 * product feed, a dictionary nothing called), which is how batch 3 fixed the descriptions and left the
 * page beside them saying the old thing. So this reads every fixed string in the shipped TypeScript —
 * source plus the generated catalogues the browser downloads — and the text assets in public/ and data/
 * (served or imported as-is), not a list of files.
 * ⚠️ IT MATCHES ONE STRING AT A TIME. A claim assembled from pieces at runtime (adjacent JSX nodes, a
 * literal around a `${}`) can slip past it; the built-artifact check (Googlebot fetch of the rendered
 * pages) is what covers composed output, and this is the cheap net under it.
 *
 * The brand tagline "Vietnam's trusted marketplace for the international community" / "chợ uy tín cho
 * cộng đồng quốc tế" (footer.tsx, emails/layout.ts), /about's "The trusted marketplace for Vietnam." /
 * "Chợ mua bán uy tín tại Việt Nam.", /guide's "the trusted marketplace for Vietnam’s international
 * community" and /trust's "instead of stars and badges" followed in the second pass the same day: each
 * now says what the site title says (src/lib/site-title.ts), and they are pinned below with the rest.
 *
 * ⚠️ PARSED, NOT GREPPED: comments quote the retired wording to say why it went, and they must keep
 * doing so. Template-literal parts count (`On ${SITE_NAME} every seller carries…` was one).
 * ⚠️ NOT EVERY "trust score" IS RETIRED. A seller's score is real and documented (/trust, the Terms,
 * the ranking disclosure); what is pinned here is the specific unbacked wording that was removed.
 *
 * The list itself is src/lib/copy-rules.ts (moved there unchanged, 2026-10-27), so the voice
 * concierge's spoken-sentence guard reads the same one.
 */

/** Shipped = what a build compiles or serves: tests and test support are not. */
const isShipped = (rel: string) =>
  /\.(ts|tsx)$/.test(rel) &&
  !/\.(test|spec)\.tsx?$/.test(rel) &&
  !rel.startsWith('src/test/') &&
  !/\/__(fixtures|tests|mocks)__\//.test(rel)

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Every fixed string — literals, template parts, JSX text — one source file holds. Never comments. */
function fixedStrings(text: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text)
    else if (ts.isJsxText(node)) out.push(node.text.replace(/\s+/g, ' '))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** public/ and data/ text — minus the vendored blobs (OpenCV, Tesseract, Lottie emoji), which hold no copy. */
const TEXT_ASSET = /\.(json|txt|md|html|webmanifest|xml|csv|js|mjs)$/
const VENDORED = /^public\/(opencv|tesseract|emoji)\//

describe('retired trust claims (owner 2026-10-04)', () => {
  it('no shipped string — source or generated catalogue — carries one', () => {
    const hits: string[] = []
    for (const full of walk('src')) {
      const rel = relative('.', full).split(sep).join('/')
      if (!isShipped(rel)) continue
      for (const s of fixedStrings(readFileSync(full, 'utf8'), rel)) {
        const re = RETIRED.find((r) => r.test(s))
        if (re) hits.push(`${rel}: ${re} — "${s.slice(0, 120)}"`)
      }
    }
    expect(hits).toEqual([])
  }, 60_000)

  it('no text asset in public/ or data/ carries one', () => {
    const hits: string[] = []
    for (const root of ['public', 'data']) {
      for (const full of walk(root)) {
        const rel = relative('.', full).split(sep).join('/')
        if (!TEXT_ASSET.test(rel) || VENDORED.test(rel)) continue
        const text = readFileSync(full, 'utf8')
        const re = RETIRED.find((r) => r.test(text))
        if (re) hits.push(`${rel}: ${re}`)
      }
    }
    expect(hits).toEqual([])
  }, 60_000) // ~2.6 MB of text; the explicit budget is for a loaded full-suite run, as above

  it('the detector reads strings, template parts and JSX text, and skips comments', () => {
    const src = [
      '// "Every seller has a public trust score and bad listings get reported." was retired',
      'const a = `On ${x} every seller carries a public trust score, buyers can report`',
      "export const B = () => <p>so fakes and bait prices get caught fast</p>",
    ].join('\n')
    const got = fixedStrings(src, 'x.tsx')
    expect(got.some((s) => RETIRED.some((r) => r.test(s)))).toBe(true)
    expect(got.join(' ')).not.toMatch(/bad listings get reported/)
    expect(got.join(' ')).toMatch(/fakes and bait prices/)
  })

  it('the approved replacement is not itself caught', () => {
    for (const s of Object.values(REPORT_SENTENCE)) expect(RETIRED.some((r) => r.test(s))).toBe(false)
  })
})
