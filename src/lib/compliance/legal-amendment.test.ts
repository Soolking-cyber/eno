import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AMENDED, LEGAL_AMENDMENT, MIN_NOTICE_DAYS, PROHIBITED_AMENDED, PROHIBITED_AMENDMENT, REGULATIONS_AMENDED, REGULATIONS_AMENDMENT, amendmentDatesProblem, dateEn, dateVi, daysBetween } from './legal-amendment'

const ROOT = join(__dirname, '..', '..', '..')

describe('legal-amendment', () => {
  it('the amendments typed in the module pass their own rule', () => {
    expect(amendmentDatesProblem(LEGAL_AMENDMENT)).toBeNull()
    expect(amendmentDatesProblem(REGULATIONS_AMENDMENT)).toBeNull()
    expect(amendmentDatesProblem(PROHIBITED_AMENDMENT)).toBeNull()
  })

  // Civil Code 2015 Art 147–148: the publication day is not counted, so "at least 5 days" needs the
  // in-force date to be at least publication + 6 calendar days — THE DEFAULT for every amendment.
  it('by default leaves at least the promised notice, with the publication day not counted', () => {
    expect(MIN_NOTICE_DAYS).toBe(5)
    expect(amendmentDatesProblem({ published: '2026-10-01', inForce: '2026-10-07' })).toBeNull()
    expect(amendmentDatesProblem({ published: '2026-10-01', inForce: '2026-10-06' })).toMatch(/only 5 day\(s\)/)
    // Across a month and a year boundary — calendar days, not string arithmetic.
    expect(amendmentDatesProblem({ published: '2026-12-29', inForce: '2027-01-04' })).toBeNull()
    expect(amendmentDatesProblem({ published: '2026-12-29', inForce: '2027-01-03' })).not.toBeNull()
  })

  it('allows EQUAL dates only for an owner-decided immediate amendment', () => {
    expect(amendmentDatesProblem({ published: '2026-10-01', inForce: '2026-10-01' })).toMatch(/only 0 day\(s\)/)
    expect(amendmentDatesProblem({ published: '2026-10-01', inForce: '2026-10-01', immediate: true })).toBeNull()
    // immediate means "in force the day it is published" — never a later date, and never an earlier one.
    expect(amendmentDatesProblem({ published: '2026-10-01', inForce: '2026-10-07', immediate: true })).toMatch(/must equal published/)
    expect(amendmentDatesProblem({ published: '2026-10-01', inForce: '2026-09-30', immediate: true })).toMatch(/must equal published/)
  })

  // ⛔ Owner, 2026-10-07 (AskUserQuestion: "When should that Terms change take effect?"): "Immediately
  // (Recommended)". The Terms' version 3 (App Store Guideline 1.2 — D8) re-uses the record as an IMMEDIATE
  // amendment — in force on its publication day, no window, no announcement: the 2026-10-01 precedent. It was
  // written with the default window (in force 13/10/2026); the window tests elsewhere run on fixtures.
  it('the Terms’ version 3 is immediate: published and in force 07/10/2026', () => {
    expect(LEGAL_AMENDMENT).toEqual({ published: '2026-10-07', inForce: '2026-10-07', immediate: true })
    expect(AMENDED).toEqual({ publishedVi: '07/10/2026', publishedEn: '7 October 2026', inForceVi: '07/10/2026', inForceEn: '7 October 2026' })
  })

  // ⛔ Owner, 2026-10-01: "just change now we dont have users so its safe to implement just new terms no
  // need for announcement". The October 2026 amendment was in force from its publication day — its dates
  // now literals in legal-archive.ts, where every text it dated and version 3 did not change reads them.
  it('the October 2026 amendment keeps its dates, as literals: published and in force 01/10/2026', async () => {
    const { V1_SUPERSEDED, V1_SUPERSEDED_BY } = await import('./legal-archive')
    expect(V1_SUPERSEDED_BY).toEqual({ version: '2', published: '2026-10-01', inForce: '2026-10-01' })
    expect(V1_SUPERSEDED.inForceVi).toBe('01/10/2026')
    expect(V1_SUPERSEDED.inForceEn).toBe('1 October 2026')
  })

  // ⛔ A Terms-only amendment re-dates the Terms and /privacy only. Every other text the October amendment dated
  // reads its literals now (legal-archive.ts V1_SUPERSEDED): a page still importing LEGAL_AMENDMENT or AMENDED
  // would print 7 or 13 October for an October-1 change (/returns, /regulations, the archives). /prohibited reads
  // its own record since 2026-10-14 (PROHIBITED_AMENDMENT, below).
  // So the readers are a closed list — a new one is a decision about which amendment dates it.
  it('is read by exactly the texts and machinery the Terms’ newest amendment dates', () => {
    const readers: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`
        if (statSync(join(ROOT, rel)).isDirectory()) { if (name !== 'generated') walk(rel); continue }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue
        for (const m of readFileSync(join(ROOT, rel), 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'(?:@\/lib\/compliance|\.)\/legal-amendment'/g)) {
          if (/\b(LEGAL_AMENDMENT|AMENDED)\b/.test(m[1])) readers.push(rel)
        }
      }
    }
    walk('src')
    expect(readers.sort()).toEqual([
      'src/app/[lang]/privacy/page.tsx', // "Last updated" — version 3 changed /privacy
      'src/app/[lang]/terms/page.tsx',
      'src/app/md/terms/route.ts',
      'src/components/marketplace/tos-change-notice.tsx', // the strip
      'src/lib/compliance/legal-amendment-notice.ts', // the bell notice
      'src/lib/compliance/legal-archive.ts', // TERMS_V2_SUPERSEDED_BY — /terms/v2's banner
      'src/lib/site-legal.ts', // the runtime switch
    ])
  })

  // The strip is the announcement; an immediate amendment has none, a windowed one must have it. A source
  // check, because the mount is one line in providers.tsx that nothing else would notice missing. Two records
  // can have a window now — the Terms' and /prohibited's (2026-10-14) — so the strip is mounted while either does.
  it('mounts the site-wide strip exactly when some amendment has a notice window', () => {
    // Comments out first (the providers.tsx note names the component), then ANY JSX use counts as a
    // mount: `<TosChangeNotice/>`, with props, or conditional (`{x && <TosChangeNotice />}`).
    const providers = readFileSync(join(ROOT, 'src/app/[lang]/providers.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const mounted = /<TosChangeNotice\b/.test(providers)
    const windowed = !LEGAL_AMENDMENT.immediate || !PROHIBITED_AMENDMENT.immediate
    expect(mounted, windowed
      ? 'an amendment with a notice window must be announced: mount <TosChangeNotice /> in providers.tsx'
      : 'immediate amendments announce nothing: remove <TosChangeNotice /> from providers.tsx').toBe(windowed)
  })

  it('formats both languages from the one ISO date', () => {
    expect(dateVi('2026-10-07')).toBe('07/10/2026')
    expect(dateEn('2026-10-07')).toBe('7 October 2026')
    expect(AMENDED.inForceVi).toBe(dateVi(LEGAL_AMENDMENT.inForce))
    expect(AMENDED.publishedEn).toBe(dateEn(LEGAL_AMENDMENT.published))
    expect(REGULATIONS_AMENDED.inForceVi).toBe(dateVi(REGULATIONS_AMENDMENT.inForce))
    expect(REGULATIONS_AMENDED.publishedEn).toBe(dateEn(REGULATIONS_AMENDMENT.published))
    expect(PROHIBITED_AMENDED.inForceVi).toBe(dateVi(PROHIBITED_AMENDMENT.inForce))
    expect(PROHIBITED_AMENDED.publishedEn).toBe(dateEn(PROHIBITED_AMENDMENT.published))
    expect(() => dateVi('07/10/2026')).toThrow()
  })

  // ⛔ Owner, 2026-10-05: "apply best recommended" — the Quy chế's version 3 (Article 14) follows the
  // 2026-10-01 precedent: in force the day it is published, no window, no announcement. A Quy chế-only
  // amendment: the Terms' record keeps October's dates.
  describe('the Quy chế-only amendment (version 3, REGULATIONS_AMENDMENT)', () => {
    it('is immediate: published and in force on one day, after October’s amendment', async () => {
      const { V1_SUPERSEDED_BY } = await import('./legal-archive')
      expect(REGULATIONS_AMENDMENT.immediate).toBe(true)
      expect(REGULATIONS_AMENDMENT.inForce).toBe(REGULATIONS_AMENDMENT.published)
      expect(REGULATIONS_AMENDMENT.published > V1_SUPERSEDED_BY.published).toBe(true)
      // The placeholder the deployer replaces with the real deploy day (the gate holds it there).
      expect(REGULATIONS_AMENDMENT.published).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    // It left the Terms' record on October's dates; the Terms then moved on alone (version 3, 2026-10-07) —
    // two amendments, two records, and neither carries the other's dates.
    it('is not the Terms’ record, and the Terms’ version 3 did not move it', () => {
      expect(REGULATIONS_AMENDMENT).toEqual({ published: '2026-10-05', inForce: '2026-10-05', immediate: true })
      expect(REGULATIONS_AMENDMENT.published < LEGAL_AMENDMENT.published).toBe(true)
    })

    // ⚠️ The strip (tos-change-notice.tsx) and the bell notice (legal-amendment-notice.ts) read LEGAL_AMENDMENT
    // only. A Quy chế-only amendment WITH a window would therefore be announced by nothing — the very notice
    // Article 15 promises. Until they learn this record, it is immediate or it IS October's amendment.
    it('is never a windowed amendment the announcement machinery cannot see', () => {
      const sameAsTerms = REGULATIONS_AMENDMENT.published === LEGAL_AMENDMENT.published &&
        REGULATIONS_AMENDMENT.inForce === LEGAL_AMENDMENT.inForce &&
        REGULATIONS_AMENDMENT.immediate === LEGAL_AMENDMENT.immediate
      expect(REGULATIONS_AMENDMENT.immediate === true || sameAsTerms,
        'a windowed Quy chế-only amendment needs its own strip + bell notice first (tos-change-notice.tsx, legal-amendment-notice.ts)').toBe(true)
    })
  })

  // ⛔ Owner, 2026-10-14: "eno.vn's /prohibited gets the same visa rules (dated amendment, 5-day notice)". /prohibited's
  // OWN record — windowed, announced by the strip (eno.vn) and the bell — moving neither the Terms' switch nor the
  // Quy chế's record.
  describe('the /prohibited amendment (PROHIBITED_AMENDMENT)', () => {
    it('has its notice window: at least 5 clear days, publication day not counted', () => {
      expect(PROHIBITED_AMENDMENT.immediate).toBeUndefined()
      expect(PROHIBITED_AMENDMENT.published).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(PROHIBITED_AMENDMENT.inForce).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(daysBetween(PROHIBITED_AMENDMENT.published, PROHIBITED_AMENDMENT.inForce)).toBeGreaterThanOrEqual(MIN_NOTICE_DAYS + 1)
      // The decision is of 2026-10-14; its publication cannot be earlier.
      expect(PROHIBITED_AMENDMENT.published >= '2026-10-14').toBe(true)
    })

    it('moves neither the Terms’ runtime switch nor the Quy chế’s record', () => {
      expect(LEGAL_AMENDMENT).toEqual({ published: '2026-10-07', inForce: '2026-10-07', immediate: true })
      expect(REGULATIONS_AMENDMENT).toEqual({ published: '2026-10-05', inForce: '2026-10-05', immediate: true })
    })

    // A closed list, like LEGAL_AMENDMENT's: a new reader is a decision about which amendment dates it.
    it('is read by exactly /prohibited, eno.vn’s Article 17 entry, the strip and the bell', () => {
      const readers: string[] = []
      const walk = (dir: string) => {
        for (const name of readdirSync(join(ROOT, dir))) {
          const rel = `${dir}/${name}`
          if (statSync(join(ROOT, rel)).isDirectory()) { if (name !== 'generated') walk(rel); continue }
          if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue
          for (const m of readFileSync(join(ROOT, rel), 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'(?:@\/lib\/compliance|\.)\/legal-amendment'/g)) {
            if (/\b(PROHIBITED_AMENDMENT|PROHIBITED_AMENDED)\b/.test(m[1])) readers.push(rel)
          }
        }
      }
      walk('src')
      expect(readers.sort()).toEqual([
        'src/app/[lang]/prohibited/page.tsx',
        'src/app/[lang]/regulations/page.tsx', // Article 17's entry for it (eno.vn)
        'src/components/marketplace/tos-change-notice.tsx',
        'src/lib/compliance/legal-amendment-notice.ts',
      ])
    })

    it('the strip announces it on eno.vn only, in the window the bell is sent in, linking the e-Visa section', () => {
      const strip = readFileSync(join(ROOT, 'src/components/marketplace/tos-change-notice.tsx'), 'utf8')
      expect(strip).toContain('IS_MARKETPLACE && noticeSendable(new Date(), PROHIBITED_AMENDMENT).ok')
      expect(strip).toContain('href={PROHIBITED_NOTICE_PATH}')
      expect(readFileSync(join(ROOT, 'src/app/[lang]/prohibited/page.tsx'), 'utf8')).toContain('<ContentSection id="visa-services"')
    })
  })
})
