import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TEACH_BASE, TEACH_GUIDES, guideEntry, teachPath } from './registry'
import { teachGuideLinks, teachHubLink, teachLinks } from './site-links'

/**
 * Links INTO the teacher library from the rest of the site (teacher visibility plan, 2026-10-18): built from the registry,
 * so nothing links an unreleased guide or a 404 — and nothing links a typo, which would otherwise drop out silently.
 */
// The day every registered guide is live (its latest wave or re-approval day): a guide is released only once its review
// day has come (registry.ts isReleased), so a fixed date broke on the next re-approval (wave 1b, 2026-10-19).
const LIVE = new Date(`${TEACH_GUIDES.flatMap((e) => [e.published, e.reviewed ?? e.published]).sort().at(-1)}T05:00:00Z`)
const BEFORE = new Date('2026-10-01T05:00:00Z')

describe('teachHubLink', () => {
  it('is the hub once a guide is released, and nothing before — when the hub itself is a 404', () => {
    expect(teachHubLink(BEFORE)).toBeNull()
    expect(teachHubLink(LIVE)).toEqual({ href: TEACH_BASE, label: 'Teach English in Vietnam', blurb: expect.any(String) })
  })

  it('carries no entry/stay vocabulary — it renders on the licensed marketplace (registry.ts header)', () => {
    const { label, blurb } = teachHubLink(LIVE)!
    expect(`${label} ${blurb}`).not.toMatch(/visa|itinerar|paypal|residen|immigra|tạm trú/i)
  })
})

/**
 * ⛔ CLIENT CODE LINKS THE HUB UNCONDITIONALLY — the footer, the home teacher shelf, the /c teaching line and /schools take
 * TEACH_HUB_PATH from hub-path.ts, because the release check lives in the registry and the registry cannot ship to the
 * client. So the hub must stay live: if every guide were withdrawn or future-dated, it would 404 (teach-in-vietnam/page.tsx)
 * and those links with it. This fails first — remove those links in the same change.
 */
it('the hub is live today, which the unconditional client links rely on', () => {
  expect(teachHubLink(new Date())).not.toBeNull()
})

describe('teachGuideLinks', () => {
  it('keeps the order asked for, with each guide’s own label and blurb', () => {
    const links = teachGuideLinks(['english-teacher-salary-in-vietnam', 'finding-a-teaching-job-in-vietnam'], LIVE)
    expect(links.map((l) => l.href)).toEqual([teachPath('english-teacher-salary-in-vietnam'), teachPath('finding-a-teaching-job-in-vietnam')])
    for (const l of links) {
      const e = guideEntry(l.href.slice(TEACH_BASE.length + 1))!
      expect([l.label, l.blurb]).toEqual([e.label, e.blurb])
    }
  })

  it('drops an unknown slug and an unreleased guide rather than linking a 404', () => {
    expect(teachGuideLinks(['no-such-guide', 'finding-a-teaching-job-in-vietnam'], LIVE).map((l) => l.href)).toEqual([teachPath('finding-a-teaching-job-in-vietnam')])
    expect(teachGuideLinks(['finding-a-teaching-job-in-vietnam'], BEFORE)).toEqual([])
  })

  it('teachLinks puts the hub first', () => {
    expect(teachLinks(['finding-a-teaching-job-in-vietnam'], LIVE).map((l) => l.href)).toEqual([TEACH_BASE, teachPath('finding-a-teaching-job-in-vietnam')])
    expect(teachLinks(['finding-a-teaching-job-in-vietnam'], BEFORE)).toEqual([])
  })
})

/**
 * ⛔ THE REGISTRY NEVER REACHES THE CLIENT. registry.ts imports all 41 guides' content (1.4 MB of JSON), and site-links.ts
 * and category-guides.ts import the registry — so a 'use client' module importing any of them as a VALUE ships all of it
 * with the page. A type-only import is erased. Client code takes the hub path from the import-free hub-path.ts.
 */
describe('no client module imports the teach registry as a value', () => {
  const HEAVY = /(^|\/)(category-guides|teach-guides\/(registry|site-links|content|content\.generated))$/
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return e.name === 'generated' ? [] : files(p)
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
    })
  const client = files(join(process.cwd(), 'src')).filter((p) => /^\s*['"]use client['"]/.test(readFileSync(p, 'utf8')))

  it('scans real client modules (a wrong root would pass vacuously)', () => {
    expect(client.length).toBeGreaterThan(100)
  })

  it('every import or re-export of the registry, site-links or category-guides from a client module is type-only', () => {
    const offenders: string[] = []
    for (const p of client) {
      for (const m of readFileSync(p, 'utf8').matchAll(/^\s*(import|export)\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
        if (!HEAVY.test(m[3])) continue
        const clause = m[2].trim()
        const specifiers = clause.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
        const typeOnly = /^type\b/.test(clause) || (clause.startsWith('{') && specifiers.every((s) => /^type\b/.test(s)))
        if (!typeOnly) offenders.push(`${p.slice(process.cwd().length + 1)}: ${m[0].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * ⚠️ A SOURCE SCAN, LIKE seo-landing-related.test.ts: the pages import the database client and cannot be imported here.
 * A mistyped slug would just drop one link forever, so every slug each page asks for must be a registered guide.
 */
describe('every page that links the library asks for real guides', () => {
  const PAGES: Record<string, { pattern: RegExp; count: number }> = {
    'src/app/[lang]/jobs-vietnam-expats/page.tsx': { pattern: /const TEACH_RELATED = \[([^\]]*)\]/, count: 5 },
    'src/app/[lang]/housing-vietnam-expats/page.tsx': { pattern: /const TEACH_RELATED = \[([^\]]*)\]/, count: 2 },
    'src/app/[lang]/hcmc-rent-index/page.tsx': { pattern: /teachGuideLinks\(\[([^\]]*)\]\)/, count: 2 },
  }

  for (const [file, { pattern, count }] of Object.entries(PAGES)) {
    it(`${file}`, () => {
      const m = readFileSync(join(process.cwd(), file), 'utf8').match(pattern)
      expect(m, `${file}: the slug list is not where this test looks`).toBeTruthy()
      const slugs = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
      expect(slugs).toHaveLength(count)
      for (const slug of slugs) expect(guideEntry(slug), `${file}: "${slug}" is not a registered guide`).toBeDefined()
    })
  }
})
