// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { localizedHref, VI_PREFIX_PATHS } from '@/lib/lang-pinned'
import { TeacherProfileLink, TeachingJobsLink } from './teaching-links'

// category-data.ts reads the database; the count's predicate is what is asserted, so the reads are captured.
const h = vi.hoisted(() => ({ countArgs: [] as unknown[], scopeArgs: [] as unknown[][] }))
vi.mock('@/lib/db', () => ({ db: { listing: { count: async (args: unknown) => { h.countArgs.push(args); return 25 } } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (...args: unknown[]) => { h.scopeArgs.push(args); return args[0] } }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

const { TEACHING_JOBS, loadTeachingJobsCount } = await import('./category-data')

/**
 * ⛔ THE TWO TEACHING SURFACES POINT AT EACH OTHER (nav audit N8, 2026-10-05). /c/teachers holds teacher
 * PROFILES for schools to hire from; the jobs are under Jobs › Teaching. A teacher looking for work tapped
 * "Teachers" and found one profile — now /c/teachers says where the jobs are, with their live count, and /c/jobs
 * offers the profile form to a teacher who would rather be found.
 */
beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
})

const html = (lang: 'en' | 'vi', node: React.ReactNode) =>
  renderToString(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      {node}
    </LanguageProvider>,
  )
const text = (lang: 'en' | 'vi', node: React.ReactNode) => {
  const el = document.createElement('div')
  el.innerHTML = html(lang, node)
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}
const anchor = (lang: 'en' | 'vi', node: React.ReactNode) => {
  const el = document.createElement('div')
  el.innerHTML = html(lang, node)
  return el.querySelector('a')
}

// What the page passes: the explorer's Jobs › Teaching view, through localizedHref with the marketplace's
// pilot lists (vitest runs as the services edition, where the pilot is off).
const pilot = { live: VI_PREFIX_PATHS, retired: [] }
const jobsHref = (variant: 'en' | 'vi') => localizedHref(`/?${new URLSearchParams(TEACHING_JOBS).toString()}`, variant, pilot)

describe('<TeachingJobsLink> — on /c/teachers', () => {
  it('says where the teaching jobs are, with the live count, in each language', () => {
    expect(text('en', <TeachingJobsLink count={25} href={jobsHref('en')} />)).toBe('Looking for a teaching job? Jobs › Teaching (25)')
    expect(text('vi', <TeachingJobsLink count={25} href={jobsHref('vi')} />)).toBe('Tìm việc dạy học? Việc làm › Giảng dạy (25)')
  })

  it('groups the count the reader’s way', () => {
    expect(text('en', <TeachingJobsLink count={1234} href={jobsHref('en')} />)).toContain('(1,234)')
    expect(text('vi', <TeachingJobsLink count={1234} href={jobsHref('vi')} />)).toContain('(1.234)')
  })

  it('opens Jobs › Teaching in the explorer — the `/vi` twin for a Vietnamese reader — nofollow, no prefetch', () => {
    expect(jobsHref('vi')).toBe('/vi?category=jobs&subcategory=teaching')
    expect(jobsHref('en')).toBe('/?category=jobs&subcategory=teaching')
    const a = anchor('vi', <TeachingJobsLink count={25} href={jobsHref('vi')} />)
    expect(a?.getAttribute('href')).toBe('/vi?category=jobs&subcategory=teaching')
    expect(a?.getAttribute('rel')).toBe('nofollow')
  })

  it('says nothing while Jobs › Teaching is empty — never a link to an empty aisle', () => {
    expect(html('en', <TeachingJobsLink count={0} href={jobsHref('en')} />)).toBe('')
  })
})

describe('<TeacherProfileLink> — on /c/jobs', () => {
  it('offers the teacher profile form, in each language', () => {
    expect(text('en', <TeacherProfileLink href="/teachers/join" />)).toBe('Want schools to find you? Create a teacher profile')
    expect(text('vi', <TeacherProfileLink href="/teachers/join" />)).toBe('Muốn trường học tìm đến bạn? Tạo hồ sơ giáo viên')
    expect(anchor('vi', <TeacherProfileLink href="/teachers/join" />)?.getAttribute('href')).toBe('/teachers/join')
  })
})

describe('loadTeachingJobsCount — the "(N)" is what the link opens', () => {
  it('counts live jobs in Jobs › Teaching with the explorer feed’s predicate, the default teacher scope kept', async () => {
    expect(await loadTeachingJobsCount()).toBe(25)
    expect(h.countArgs).toEqual([{ where: { verified: true, status: 'active', category: { slug: 'jobs' }, subcategorySlug: 'teaching' } }])
    // No `{ teachers: true }`: the feed applies the default exclusion to `?category=jobs` too.
    expect(h.scopeArgs).toEqual([[{ verified: true, status: 'active', category: { slug: 'jobs' }, subcategorySlug: 'teaching' }]])
  })
})

describe('/c/[category] wires both links through localizedHref, each on its own page', () => {
  // Read as source: an async server page over a live database (scope-parity-contract.test.ts does the same).
  const page = readFileSync(join(process.cwd(), 'src/app/[lang]/c/[category]/(index)/page.tsx'), 'utf8')

  it('the hrefs are localized in the page language', () => {
    expect(page).toMatch(/teachingJobsHref = localizedHref\(`\/\?\$\{new URLSearchParams\(TEACHING_JOBS\)\.toString\(\)\}`, pageLang\(lang\)\)/)
    expect(page).toMatch(/teacherJoinHref = localizedHref\('\/teachers\/join', pageLang\(lang\)\)/)
  })

  it('the jobs line is on /c/teachers, the profile line on /c/jobs', () => {
    expect(page).toMatch(/\{isTeachers && <TeachingJobsLink count=\{teachingJobs\} href=\{teachingJobsHref\} \/>\}/)
    expect(page).toMatch(/\{cat\.slug === TEACHING_JOBS\.category && <TeacherProfileLink href=\{teacherJoinHref\} \/>\}/)
  })
})
