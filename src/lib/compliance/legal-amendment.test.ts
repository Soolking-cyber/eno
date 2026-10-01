import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AMENDED, LEGAL_AMENDMENT, MIN_NOTICE_DAYS, amendmentDatesProblem, dateEn, dateVi } from './legal-amendment'

const ROOT = join(__dirname, '..', '..', '..')

describe('legal-amendment', () => {
  it('the amendment typed in the module passes its own rule', () => {
    expect(amendmentDatesProblem(LEGAL_AMENDMENT)).toBeNull()
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

  // ⛔ Owner, 2026-10-01: "just change now we dont have users so its safe to implement just new terms no
  // need for announcement". The October 2026 amendment is in force from its publication day.
  it('the October 2026 amendment is immediate: published and in force 01/10/2026', () => {
    expect(LEGAL_AMENDMENT).toEqual({ published: '2026-10-01', inForce: '2026-10-01', immediate: true })
    expect(AMENDED.inForceVi).toBe('01/10/2026')
    expect(AMENDED.inForceEn).toBe('1 October 2026')
  })

  // The strip is the announcement; an immediate amendment has none, a windowed one must have it. A source
  // check, because the mount is one line in providers.tsx that nothing else would notice missing.
  it('mounts the site-wide strip exactly when the amendment has a notice window', () => {
    // Comments out first (the providers.tsx note names the component), then ANY JSX use counts as a
    // mount: `<TosChangeNotice/>`, with props, or conditional (`{x && <TosChangeNotice />}`).
    const providers = readFileSync(join(ROOT, 'src/app/[lang]/providers.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const mounted = /<TosChangeNotice\b/.test(providers)
    expect(mounted, LEGAL_AMENDMENT.immediate
      ? 'an immediate amendment announces nothing: remove <TosChangeNotice /> from providers.tsx'
      : 'an amendment with a notice window must be announced: mount <TosChangeNotice /> in providers.tsx').toBe(!LEGAL_AMENDMENT.immediate)
  })

  it('formats both languages from the one ISO date', () => {
    expect(dateVi('2026-10-07')).toBe('07/10/2026')
    expect(dateEn('2026-10-07')).toBe('7 October 2026')
    expect(AMENDED.inForceVi).toBe(dateVi(LEGAL_AMENDMENT.inForce))
    expect(AMENDED.publishedEn).toBe(dateEn(LEGAL_AMENDMENT.published))
    expect(() => dateVi('07/10/2026')).toThrow()
  })
})
