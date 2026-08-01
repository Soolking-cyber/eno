import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CROSS_SITE_REL, MARKETPLACE_HOME, MARKETPLACE_LINKS } from './cross-site-links'

/**
 * THE OUTBOUND LINKS FROM eno.forum TO eno.vn — checked against the filesystem, not against a list.
 *
 * ⚠️ AN href IS A STRING, AND NOTHING ELSE IN THE TOOLCHAIN LOOKS AT IT. tsc cannot tell
 * `/housing-vietnam-expats` from `/housing-vietnam-expat`; Next cannot warn about a route on
 * ANOTHER deployment; the two sites are built separately so no build ever resolves these together.
 * A rename on the marketplace side therefore turns a link into a 404 with every gate still green,
 * and the only place that can notice is a test that opens src/app.
 *
 * ⚠️ THE FAILURE THIS IS REALLY WATCHING FOR IS THE `.svc.` ONE. Services-only pages are named
 * `page.svc.tsx` and a MARKETPLACE build does not compile them — so `/vietnam-evisa` and
 * `/services-for-expats-vietnam` exist on eno.forum and 404 on eno.vn. They are the paths a future
 * editor is most likely to add here, because on eno.forum they are real pages that work when you
 * click them. Requiring a plain `page.tsx` is what makes that impossible rather than merely
 * discouraged.
 */

const ALL = [...(MARKETPLACE_HOME ? [MARKETPLACE_HOME] : []), ...MARKETPLACE_LINKS]

describe('cross-site links', () => {
  it('has a home link and at least three destinations (the check is not vacuous)', () => {
    // Guards the whole file: if the module is ever emptied — or, worse, if a test run somehow
    // resolves the marketplace STUB — every assertion below would pass over an empty array.
    expect(MARKETPLACE_HOME).not.toBeNull()
    expect(MARKETPLACE_LINKS.length).toBeGreaterThanOrEqual(3)
  })

  it.each(ALL.map((l) => [l.key, l.href]))('%s → %s is absolute, on the eno.vn apex', (_key, href) => {
    const u = new URL(href)
    expect(u.protocol).toBe('https:')
    // ⚠️ APEX, NOT www. next.config.ts 301s www.eno.vn → eno.vn on every path, so a `www.` here
    // would put a redirect hop in front of every visitor and every crawler for no reason.
    expect(u.host).toBe('eno.vn')
  })

  it.each(ALL.map((l) => [l.key, l.href]))('%s → %s resolves to a MARKETPLACE route', (_key, href) => {
    const path = new URL(href).pathname
    // `/` is the home page, which lives in the (home) route group. Everything else is a top-level
    // directory holding a plain page.tsx.
    const dir = path === '/' ? 'src/app/(home)' : `src/app${path.replace(/\/$/, '')}`
    expect(existsSync(`${dir}/page.tsx`), `${dir}/page.tsx does not exist — ${href} would 404`).toBe(true)
    expect(
      existsSync(`${dir}/page.svc.tsx`),
      `${dir} is a SERVICES-ONLY route (page.svc.tsx): a marketplace build never compiles it, so ${href} 404s on eno.vn`,
    ).toBe(false)
  })

  it.each(ALL.map((l) => [l.key, l]))('%s carries anchor text and a blurb in both languages', (_key, l) => {
    const link = l as (typeof ALL)[number]
    for (const [field, value] of Object.entries(link)) {
      expect(value, `${link.key}.${field} is empty`).toBeTruthy()
    }
    // Anchor text is the payload. A bare URL or "click here" passes no signal and reads as spam.
    expect(link.labelEn).not.toMatch(/^https?:|click here/i)
    expect(link.labelVi).not.toMatch(/^https?:|nhấn vào đây/i)
  })

  /**
   * ⚠️ THE ONE RULE MOST LIKELY TO BE "FIXED" BY A WELL-MEANING EDIT. Adding nofollow to an
   * outbound link feels like hygiene, and here it would delete the entire value of the surface:
   * these are editorial recommendations between two disclosed, affiliated sites, and eno.forum
   * ranks for queries eno.vn is legally barred from touching. The disclosure is made in WORDS
   * (AFFILIATION in site-legal.ts, rendered beside the links), not in a rel attribute.
   */
  it('is dofollow — rel is noopener and nothing else', () => {
    expect(CROSS_SITE_REL).toBe('noopener')
  })

  it.each([
    'src/lib/cross-site-links.ts',
    'src/lib/edition-services-copy.ts',
    'src/components/marketplace/cross-site-promo.tsx',
    'src/components/marketplace/footer.tsx',
  ])('%s never writes nofollow/sponsored/ugc', (file) => {
    // Source text rather than rendered output: the anchors are built in four places and a literal
    // `rel="nofollow"` typed into any of them would override the constant above without failing
    // anything else. Comments are stripped so the prose explaining the ban does not trip it.
    const body = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(body).not.toMatch(/\bnofollow\b|\bsponsored\b|\bugc\b/i)
  })
})

/**
 * ⚠️ THE ALIAS MATCHES A SPECIFIER STRING, SO A RELATIVE IMPORT SILENTLY BYPASSES IT.
 *
 * `next.config.ts` maps `@/lib/cross-site-links` and `@/components/marketplace/cross-site-promo` to
 * their stubs on a marketplace build, and a Turbopack `resolveAlias` key is matched against the
 * REQUEST as written. `import { CrossSitePromo } from './cross-site-promo'` from a sibling file in
 * src/components/marketplace/ is a different request, so it resolves to the REAL module — the copy
 * lands in eno.vn's chunks with the alias entry present, correct, and doing nothing.
 *
 * This has already nearly happened once: seo-article.tsx imported its two siblings relatively
 * (`./header`, `./footer`) and reached for the promo the same way, which was harmless only because
 * that component's sole consumer is a `page.svc.tsx`. Nothing about that is durable — the moment a
 * shared page renders a `SeoArticle`, the relative import is a leak. Nothing else in the toolchain
 * can see the difference: both specifiers typecheck, both resolve identically on a services build,
 * and both look right in review.
 */
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) tsFiles(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe('the aliased modules are only ever imported by their aliased specifier', () => {
  // Basename → the exact specifier next.config.ts aliases. Keep in sync with resolveAlias there.
  const ALIASED: Record<string, string> = {
    'cross-site-links': '@/lib/cross-site-links',
    'cross-site-promo': '@/components/marketplace/cross-site-promo',
  }

  // The modules and stubs themselves, plus this test — all name the basename legitimately.
  const SELF = /(?:cross-site-links|cross-site-promo)(?:\.stub)?\.tsx?$|cross-site-links\.test\.ts$/

  it.each(Object.entries(ALIASED))('%s is imported only as %s', (base, specifier) => {
    const offenders: string[] = []
    let sawTheGoodForm = false
    for (const file of tsFiles('src')) {
      if (SELF.test(file)) continue
      const src = readFileSync(file, 'utf8')
      // Any import/require whose specifier ENDS in this basename but is not the aliased form.
      for (const m of src.matchAll(new RegExp(String.raw`from\s*'([^']*${base})'`, 'g'))) {
        if (m[1] === specifier) sawTheGoodForm = true
        else offenders.push(`${file} → '${m[1]}'`)
      }
    }
    expect(sawTheGoodForm, `nothing imports ${specifier} — this check has gone vacuous`).toBe(true)
    expect(
      offenders,
      `these bypass next.config.ts's resolveAlias, so a marketplace build gets the REAL module: use '${specifier}'`,
    ).toEqual([])
  })
})
