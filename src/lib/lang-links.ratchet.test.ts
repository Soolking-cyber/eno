import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ NO NEW LINK INTO AN ENGLISH-PINNED PLAIN URL (A1-LANG, field-01 / disc-01 / auth-01).
 *
 * `/` and `/c/furniture-appliances` are the live `/vi` pilot paths (lang-pinned.ts VI_PREFIX_PATHS): their
 * PLAIN URL renders English for everyone (decision V-a), and their `/vi` twin renders Vietnamese. So a
 * link written as a literal `/?q=…` or `/c/furniture-appliances` switches a Vietnamese reader to English
 * — production showed the header's `<form action="/">` doing exactly that from every /c page and PDP.
 * The fix is `localizedHref(href, variant)` (or a LocalizedLink / HereLink, which call it), and this
 * guard stops the literal coming back.
 *
 * What it catches: a sink — `href=`, `action=`, `push(`, `replace(`, `assign(`, `openUrl(`, `applyUrl(` —
 * followed DIRECTLY by a string literal starting `/?` or `/c/furniture-appliances`, and `action="/"`.
 * A literal handed to `localizedHref(…)`, `<LocalizedLink href>` or `<HereLink href>` is localized at
 * render, so it is not a finding. A literal built into a variable first is out of reach of a text scan;
 * the e2e spec (e2e/guest/lang-vi-links.spec.ts) covers the routes that matter end to end.
 *
 * ⚠️ A RATCHET, NOT A BAN: `ALLOWED` is the set of offenders left after A1, per file, and a file's count
 * may only go DOWN. Other packages own some of them (the PDP brand badge — A3; the card's `/?focus=` —
 * A4); when one is fixed, lower or delete its entry here. A file not listed may not gain one.
 * The API and the canonical/metadata builders are out of scope (`src/app/api/**`, sitemap, feeds): they
 * address crawlers and machines, for whom the plain URL is the right one.
 */
const ROOTS = ['src/app', 'src/components', 'src/lib', 'src/hooks', 'src/context']
const SKIP = [
  /\.test\.tsx?$/,
  /^src\/app\/api\//,
  /^src\/generated\//,
  /^src\/lib\/lang-pinned\.ts$/,
  /sitemap/,
  /^src\/app\/.*\/(opengraph-image|twitter-image)\.tsx$/,
]

/** Today's offenders after A1, by file → count. May only shrink. */
const ALLOWED: Record<string, number> = {
  // (A3's PDP brand badge and A4's card "show on map" were fixed when those packages landed — entries removed.)
  // `applyUrl` reads only the query string and applies it in place on the mounted explorer — the path
  // is never navigated to, so `/vi` is kept (plan A1 item 9: nothing to wrap).
  'src/components/marketplace/listings-explorer.tsx': 2,
}

const SINK = /(?:href=\{?|action=\{?|\bpush\(|\breplace\(|\bassign\(|\bopenUrl\(|\bapplyUrl\()\s*[`'"]\/(?:\?|c\/furniture-appliances(?=[`'"?#/]))|action="\/"/g
const LOCALIZED_TAG = /<(?:LocalizedLink|HereLink)\b[^<>]*$/

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.tsx?$/.test(name)) yield p
  }
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1')

/** Every sink-literal in `src`, skipping the ones inside a LocalizedLink / HereLink opening tag. */
function findPinnedLinks(src: string): string[] {
  const out: string[] = []
  const code = stripComments(src)
  for (const m of code.matchAll(SINK)) {
    const before = code.slice(Math.max(0, m.index - 400), m.index)
    if (LOCALIZED_TAG.test(before)) continue
    const lineEnd = code.indexOf('\n', m.index)
    out.push(code.slice(m.index, lineEnd === -1 ? undefined : lineEnd).trim())
  }
  return out
}

const scanned = ROOTS.flatMap((root) => [...files(root)])
  .map((f) => relative(process.cwd(), f))
  .filter((f) => !SKIP.some((re) => re.test(f)))
const found = new Map<string, string[]>()
for (const file of scanned) {
  const hits = findPinnedLinks(readFileSync(file, 'utf8'))
  if (hits.length) found.set(file, hits)
}

describe('lang links ratchet — no literal link into an English-pinned plain URL', () => {
  it('the matcher sees each sink shape and skips localized ones', () => {
    expect(findPinnedLinks('<form action="/" method="get">')).toHaveLength(1)
    expect(findPinnedLinks('<Link href={`/?q=${q}`}>')).toHaveLength(1)
    expect(findPinnedLinks(`router.push('/?view=map')`)).toHaveLength(1)
    expect(findPinnedLinks('openUrl(`/?brand=${b}`)')).toHaveLength(1)
    expect(findPinnedLinks('<Link href="/c/furniture-appliances" className="x">')).toHaveLength(1)
    // Not findings: localized, a different category, a different path.
    expect(findPinnedLinks(`openUrl(localizedHref(\`/?brand=\${b}\`, variant))`)).toHaveLength(0)
    expect(findPinnedLinks('<HereLink href="/c/furniture-appliances">x</HereLink>')).toHaveLength(0)
    expect(findPinnedLinks('<LocalizedLink href="/?category=x" rel="nofollow" prefetch={false} className="y">')).toHaveLength(0)
    expect(findPinnedLinks('<Link href="/c/furniture-appliances-x">')).toHaveLength(0)
    expect(findPinnedLinks('<Link href="/listings/x">')).toHaveLength(0)
    expect(findPinnedLinks('// router.push(`/?q=x`) in a comment')).toHaveLength(0)
  })

  it('scans the app (the scan is not vacuous)', () => {
    expect(scanned.length).toBeGreaterThan(500)
    expect(scanned).toContain('src/components/marketplace/header.tsx')
  })

  it('no file gains a literal pinned link, and no unlisted file has one', () => {
    const over = [...found].filter(([file, hits]) => hits.length > (ALLOWED[file] ?? 0))
    expect(over.map(([file, hits]) => `${file}: ${hits.length} > ${ALLOWED[file] ?? 0}\n  ${hits.join('\n  ')}`)).toEqual([])
  })
})
