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
    const dir = path === '/' ? 'src/app/[lang]/(home)' : `src/app/[lang]${path.replace(/\/$/, '')}`
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

  // ⚠️ /jobs-vietnam-expats is the English teaching jobs board since 2026-10-18 (teacher visibility plan B2): the link
  // names what it lists — not "jobs for internationals", not "mostly teaching".
  it('names the jobs landing for what it lists: English teaching jobs', () => {
    const jobs = MARKETPLACE_LINKS.find((l) => l.key === 'jobs')
    expect(jobs).toMatchObject({
      href: 'https://eno.vn/jobs-vietnam-expats',
      labelEn: 'English teaching jobs in Vietnam',
      labelVi: 'Việc làm giáo viên tiếng Anh tại Việt Nam',
    })
    expect(`${jobs?.blurbEn} ${jobs?.blurbVi}`).not.toMatch(/mostly|phần lớn|hospitality|internationals/i)
  })

  /**
   * ⚠️ …AND SO DOES EVERY SENTENCE THAT LINKS IT. The eno.forum guides link the landing inside their own prose
   * (`<VnLink href={marketplaceHref('jobs')}>`), which the entry above never reaches. Three still described a general
   * jobs page (review, 2026-10-18): first-month-in-vietnam's "work listings aimed at internationals … a decent barometer
   * of which industries are hiring", moving-to-vietnam's "roles in Vietnam that ask for English" a paragraph after
   * "teaching, hospitality, tech, design and marketing are where most international hires land", and the official e-visa
   * process page's "roles that ask for English". Read from the source, like source-site-wording.test.ts — the guides are
   * services-only pages — with comments stripped, since those quote the retired wording to say why it went. The scope is
   * the guide SECTION holding the link, so a framing sentence a paragraph up is caught too.
   */
  describe("every caller of marketplaceHref('jobs') names the teaching jobs it opens", () => {
    const uncomment = (src: string) => src.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    // Every non-test source, read ONCE for the four checks below (each used to walk src/ again; one timed out under load).
    const SOURCES = tsFiles('src')
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .map((file) => {
        const raw = readFileSync(file, 'utf8')
        return { file, raw, code: uncomment(raw) }
      })
    const callers = SOURCES
      .flatMap(({ file, code: src }) => {
        // Any quoting or spacing of the key, so a caller written another way is not skipped.
        return [...src.matchAll(/marketplaceHref\(\s*(['"`])jobs\1\s*\)(?:\}>([^<]*)<\/VnLink>)?/g)].map((m) => (
          { file, src, at: m.index ?? -1, anchor: m[2]?.replace(/\s+/g, ' ').trim() }
        ))
      })
    /** The guide section (`{ id: '…', title, body }`) the call sits in: from its `id:` to the next one, or the list's end. */
    const sectionOf = ({ src, at }: { src: string; at: number }) => {
      const start = src.lastIndexOf("\n      id: '", at)
      const ends = [src.indexOf("\n      id: '", at), src.indexOf('\n  ],', at)].filter((i) => i >= 0)
      return start < 0 || !ends.length ? null : src.slice(start, Math.min(...ends))
    }

    it('finds the guides that link it (the check is not vacuous)', () => {
      expect(new Set(callers.map((c) => c.file)).size).toBeGreaterThanOrEqual(3)
    })

    // A key held in a variable, cast or passed beside a second argument would hide a jobs link from the scan above, so
    // every call names its key as one plain literal — the helper's own definition (seo-article.tsx) aside.
    it('every marketplaceHref call names its key as one string literal, so none escapes the scan', () => {
      const calls = SOURCES
        .flatMap(({ file, code }) => [...code.matchAll(/marketplaceHref\(([^)]*)\)/g)].map((m) => `${file}: ${m[0]}`))
        .filter((call) => !call.endsWith('marketplaceHref(key: string)'))
      expect(calls.length).toBeGreaterThanOrEqual(3)
      for (const call of calls) expect(call).toMatch(/marketplaceHref\(\s*(['"`])[a-z-]+\1\s*\)$/)
    })

    // …and the ways around the helper: importing it under another name, or typing the landing's URL by hand (the
    // guides' own rule — every eno.vn href comes from marketplaceHref()). No source but this module (which owns the
    // entry) spells the absolute URL, and no services-only page (`.svc.`) spells even the path, which there would open
    // eno.forum's own copy of the page.
    it('the helper is never renamed on import, and the jobs landing’s URL is never typed where the helper belongs', () => {
      const renamed = SOURCES.filter(({ raw }) => /\bmarketplaceHref\s+as\b/.test(raw)).map(({ file }) => file)
      expect(renamed).toEqual([])
      const typed = SOURCES
        .filter(({ file }) => file !== join('src', 'lib', 'cross-site-links.ts'))
        .filter(({ file, code }) => /eno\.vn\/jobs-vietnam-expats/.test(code) || (/\.svc\.tsx?$/.test(file) && code.includes('/jobs-vietnam-expats')))
        .map(({ file }) => file)
      expect(typed).toEqual([])
    })

    it.each(callers.map((c) => [`${c.file} — "${c.anchor ?? 'no <VnLink> text'}"`, c] as const))('%s', (_where, c) => {
      expect(c.anchor, 'the link text').toMatch(/^English teaching jobs\b/)
      const section = sectionOf(c)
      expect(section, 'no guide section found around the call').not.toBeNull()
      expect(section).toMatch(/marketplaceHref\(\s*(['"`])jobs\1\s*\)/)
      // The words a reader sees: tags (and the paths in their attributes, "/housing-vietnam-expats") are not prose. Only
      // words that frame a general jobs page — not "foreigners" or "sector", which a work-permit sentence may need.
      const prose = section!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
      expect(prose).not.toMatch(
        /industr(y|ies)|hospitality|tourism|internationals|international hires|for expats|(?:expat|hotel) (?:jobs|roles|work)|ask(s)? for English|requires? English|jobs in Vietnam for|tech roles|tech, design|marketing|for English speakers|roles for/i,
      )
    })
  })

  /**
   * ⛔ THE PROMO MAY ONLY PROMISE WHAT eno.vn ACTUALLY HOLDS (measured 2026-09-27). It advertised
   * "housing, jobs and motorbikes … listed by the people who own the things", linked a motorbike
   * landing with 0 listings that noindexes itself, and called dealer-supplied used furniture
   * "moving sales from people leaving Vietnam". Most rentals, furniture and electronics are linked
   * from partner portals and shops. If motorbike stock appears and that landing is indexable again,
   * re-adding it is a deliberate edit to this test — not something a copy tweak should slip past.
   */
  it('makes no claim the live stock cannot back (no motorbikes, no owner-listed, no moving sales)', () => {
    const OVERCLAIM =
      /motorbike|scooter|xe máy|xe cộ|vehicles|moving sale|thanh lý chuyển nhà|people leaving|sắp rời|who own|chính chủ/i
    for (const l of ALL) {
      expect(new URL(l.href).pathname, `${l.key} links the empty motorbike landing`).not.toBe('/motorbikes-for-sale-vietnam')
      for (const field of ['labelEn', 'labelVi', 'blurbEn', 'blurbVi'] as const) {
        expect(l[field], `${l.key}.${field}`).not.toMatch(OVERCLAIM)
      }
    }
    // The promo's own heading and body are `tr()` literals, so read them from the source. Comments are
    // stripped: they quote the old wording to explain why it went.
    const promo = readFileSync('src/components/marketplace/cross-site-promo.tsx', 'utf8')
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    const literals = [...promo.matchAll(/tr\(\s*'([^']*)',\s*'([^']*)'/g)].flatMap((m) => [m[1], m[2]])
    // Two pairs today — the heading and the body. The "Also from eno" kicker was the third, deleted
    // with the other pure-label eyebrows (C-KICKERS, 2026-09-29).
    expect(literals.length, 'no tr() literals found — this check has gone vacuous').toBeGreaterThanOrEqual(4)
    for (const text of literals) expect(text).not.toMatch(OVERCLAIM)
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
