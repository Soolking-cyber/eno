import { describe, expect, it } from 'vitest'
import { SCHOOL_KINDS } from './constants'
import { schoolOrgLd, schoolPageIndexable, schoolPageJobsOnly, schoolPageTitle, shownWebsite } from './page-seo'

/**
 * What a school page tells search engines (plan P1 item 17, 2026-10-20). The page's robots and pages.xml both call
 * schoolPageIndexable — index-rule.test.tsx proves they agree school by school; this pins the rule itself.
 */
describe('schoolPageIndexable — the one index rule (page robots AND pages.xml)', () => {
  it('indexes a page with a public review or an open job, and nothing else', () => {
    expect(schoolPageIndexable({ reviews: 1, jobs: 0 })).toBe(true)
    // ⛔ The case the two old rules disagreed on: 7 such pages on 2026-10-20 were indexable and never submitted.
    expect(schoolPageIndexable({ reviews: 0, jobs: 1 })).toBe(true)
    expect(schoolPageIndexable({ reviews: 3, jobs: 2 })).toBe(true)
    // A directory entry with neither stays a thin page: noindex, unsubmitted (plan review 2026-10-04).
    expect(schoolPageIndexable({ reviews: 0, jobs: 0 })).toBe(false)
  })

  it('a jobs-only page is one with jobs and no review — and so no pay', () => {
    expect(schoolPageJobsOnly({ reviews: 0, jobs: 1 })).toBe(true)
    expect(schoolPageJobsOnly({ reviews: 1, jobs: 1 })).toBe(false)
    expect(schoolPageJobsOnly({ reviews: 1, jobs: 0 })).toBe(false)
    expect(schoolPageJobsOnly({ reviews: 0, jobs: 0 })).toBe(false)
  })
})

describe('schoolPageTitle', () => {
  it('names a jobs-only page for its jobs, in the language the page renders', () => {
    expect(schoolPageTitle('ILA Vietnam', { reviews: 0, jobs: 1 }, 'en')).toBe('ILA Vietnam: open teaching jobs')
    expect(schoolPageTitle('ILA Vietnam', { reviews: 0, jobs: 3 }, 'vi')).toBe('ILA Vietnam: việc làm giáo viên đang tuyển')
    // The nine machine-translated languages are served the English variant (src/proxy.ts): never a third title.
    expect(schoolPageTitle('ILA Vietnam', { reviews: 0, jobs: 1 }, 'ko')).toBe('ILA Vietnam: open teaching jobs')
  })

  it('keeps every other page as it was — the reviews title, English on both variants', () => {
    for (const lang of ['en', 'vi']) {
      expect(schoolPageTitle('VUS', { reviews: 2, jobs: 0 }, lang)).toBe('VUS: teacher reviews, pay and jobs')
      expect(schoolPageTitle('VUS', { reviews: 2, jobs: 4 }, lang)).toBe('VUS: teacher reviews, pay and jobs')
      expect(schoolPageTitle('VUS', { reviews: 0, jobs: 0 }, lang)).toBe('VUS: teacher reviews, pay and jobs')
    }
  })
})

describe('shownWebsite — the one address both the About card and the structured data may name', () => {
  it('accepts an http(s) address and names it by host', () => {
    expect(shownWebsite('https://www.ila.edu.vn/en')).toEqual({ href: 'https://www.ila.edu.vn/en', host: 'ila.edu.vn' })
    expect(shownWebsite('http://vus.edu.vn')).toEqual({ href: 'http://vus.edu.vn', host: 'vus.edu.vn' })
  })

  it('refuses anything a page must not link', () => {
    for (const bad of [null, undefined, '', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x.vn', 'not a url', 'www.no-scheme.vn']) {
      expect(shownWebsite(bad), String(bad)).toBeNull()
    }
  })
})

describe('schoolOrgLd — the school as structured data, from what the page shows', () => {
  const pageUrl = 'https://eno.vn/schools/ila-vietnam'

  it('is an EducationalOrganization named as the H1, about this page, with the website the About card links', () => {
    expect(schoolOrgLd({ pageUrl, name: 'ILA Vietnam', kind: 'language_centre', website: shownWebsite('https://ila.edu.vn') })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'EducationalOrganization',
      '@id': `${pageUrl}#school`,
      name: 'ILA Vietnam',
      mainEntityOfPage: pageUrl,
      url: 'https://ila.edu.vn',
    })
  })

  it('names no website when the page shows none, and never makes eno’s page the school’s url', () => {
    const ld = schoolOrgLd({ pageUrl, name: 'ILA Vietnam', kind: 'language_centre', website: shownWebsite('javascript:alert(1)') })
    expect(ld).not.toHaveProperty('url')
    expect(JSON.stringify(ld)).not.toContain('javascript')
  })

  it('a teacher agency is an Organization — it recruits teachers, it does not teach', () => {
    for (const kind of SCHOOL_KINDS) {
      const type = schoolOrgLd({ pageUrl, name: 'X', kind, website: null })['@type']
      expect(type, kind).toBe(kind === 'agency' ? 'Organization' : 'EducationalOrganization')
    }
  })

  it('⛔ carries no rating, review, address or contact of any kind — the page shows none', () => {
    for (const kind of SCHOOL_KINDS) {
      const keys = Object.keys(schoolOrgLd({ pageUrl, name: 'X', kind, website: shownWebsite('https://x.vn') }))
      expect(keys.sort()).toEqual(['@context', '@id', '@type', 'mainEntityOfPage', 'name', 'url'])
    }
  })
})
