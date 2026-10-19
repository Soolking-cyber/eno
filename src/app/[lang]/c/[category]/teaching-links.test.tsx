// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { localizedHref, VI_PREFIX_PATHS } from '@/lib/lang-pinned'
import { POSTING_IS_FREE } from '@/lib/site-identity'
import { isPostableCategory, isTeacherSeekingPost, TEACHER_SEEKING_POST, typesFor } from '@/lib/taxonomy'
import { PostJobLink, TeacherProfileLink, TeachGuideLink, TeachingJobsLink } from './teaching-links'

// category-data.ts reads the database; the count's predicate is what is asserted, so the reads are captured.
// PostJobLink warms /post through the App Router on intent; the router is a spy here.
const h = vi.hoisted(() => ({ countArgs: [] as unknown[], scopeArgs: [] as unknown[][], prefetched: [] as string[] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch: (href: string) => { h.prefetched.push(href) } }) }))
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
  h.prefetched = []
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

  it('the guide line is on both teaching pages, and only on the marketplace', () => {
    expect(page).toMatch(/\{!IS_SERVICES && \(isTeachers \|\| cat\.slug === TEACHING_JOBS\.category\) && <TeachGuideLink \/>\}/)
  })

  // guidesForCategory itself is edition-blind (its tests run as eno.forum); the PAGE keeps the Guides block — the teach
  // library's links among them — off eno.forum, where the library is a 308 to eno.vn.
  it('the Guides block, teach links included, is computed only on the marketplace', () => {
    expect(page).toMatch(/const guides = total > 0 && !IS_SERVICES \? guidesForCategory\(/)
  })
})

/**
 * ⛔ THE TEACHER LIBRARY, ONE LINE UNDER /c/teachers' AND /c/jobs' LEDE (teacher visibility plan, 2026-10-18): neither page
 * linked the hub. The guides are English-only — the Vietnamese line says so, and the link declares the target's language.
 */
describe('<TeachGuideLink> — on /c/teachers and /c/jobs', () => {
  it('points at the hub, in each language', async () => {
    const { TEACH_BASE } = await import('@/lib/teach-guides/registry')
    expect(text('en', <TeachGuideLink />)).toBe('New to teaching in Vietnam? Start with the guide')
    expect(text('vi', <TeachGuideLink />)).toBe('Mới dạy học ở Việt Nam? Đọc cẩm nang (tiếng Anh)')
    for (const lang of ['en', 'vi'] as const) {
      const a = anchor(lang, <TeachGuideLink />)
      expect(a?.getAttribute('href')).toBe(TEACH_BASE)
      expect(a?.getAttribute('hreflang')).toBe('en')
      // `lang` would describe the link TEXT, which is Vietnamese on a Vietnamese page.
      expect(a?.hasAttribute('lang')).toBe(false)
    }
  })
})

/**
 * ⛔ THE SCHOOL SIDE'S WAY IN (teacher visibility plan §4 channel 6; copy approved in the plan, 2026-10-18 — owner: "go with
 * recommended"): "Hiring? Post your job ad free on eno" on a teaching job's page, /c/jobs and /schools — to the post form
 * with Jobs picked. It promises a post on eno, not a FULL ad (the publish guard refuses contact details, and the job-text
 * screen certain lines, so a whole pasted ad is refused) and nothing about Google, and says "free" only while
 * POSTING_IS_FREE does.
 */
const POST_JOB = '/post?category=jobs'

/**
 * The prompt as a build with POSTING_IS_FREE = `free` renders it (the vi.doMock route llms.txt's test takes), so both
 * wordings are pinned whatever the flag says today. Fresh modules: the component AND the provider whose context it reads
 * — one module instance, one context.
 */
async function promptWithFee(free: boolean): Promise<{ en: string; vi: string; enRow: string; viRow: string }> {
  vi.resetModules()
  vi.doMock('@/lib/site-identity', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/site-identity')>()),
    POSTING_IS_FREE: free,
  }))
  try {
    const { PostJobLink: Fresh } = await import('./teaching-links')
    const { LanguageProvider: Provider } = await import('@/context/language-context')
    const say = (lang: 'en' | 'vi', row: boolean) => {
      const el = document.createElement('div')
      el.innerHTML = renderToString(<Provider initialLang={lang} initialViDict={{}}><Fresh href={POST_JOB} row={row} /></Provider>)
      return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    }
    return { en: say('en', false), vi: say('vi', false), enRow: say('en', true), viRow: say('vi', true) }
  } finally {
    vi.doUnmock('@/lib/site-identity')
    vi.resetModules()
  }
}

describe('<PostJobLink> — on a teaching job, /c/jobs and /schools', () => {
  it('asks a school to post its job, "free" while POSTING_IS_FREE holds, in each language and both forms', async () => {
    expect(await promptWithFee(true)).toEqual({
      en: 'Hiring? Post your job ad free on eno',
      vi: 'Bạn cần tuyển người? Đăng tin tuyển dụng miễn phí trên eno',
      enRow: 'Hiring? Post your job ad free on eno',
      viRow: 'Bạn cần tuyển người? Đăng tin tuyển dụng miễn phí trên eno',
    })
  })

  it('drops "free" the moment POSTING_IS_FREE does — the flag is the one place a fee is decided', async () => {
    const paid = await promptWithFee(false)
    expect(paid).toEqual({
      en: 'Hiring? Post your job ad on eno',
      vi: 'Bạn cần tuyển người? Đăng tin tuyển dụng trên eno',
      enRow: 'Hiring? Post your job ad on eno',
      viRow: 'Bạn cần tuyển người? Đăng tin tuyển dụng trên eno',
    })
    for (const s of Object.values(paid)) expect(s).not.toMatch(/free|miễn phí/i)
  })

  it('this build renders the wording its own flag picks', async () => {
    const want = await promptWithFee(POSTING_IS_FREE)
    expect(text('en', <PostJobLink href={POST_JOB} />)).toBe(want.en)
    expect(text('vi', <PostJobLink href={POST_JOB} />)).toBe(want.vi)
  })

  it('promises a post on eno — nothing about Google or job search (no first-party JobPosting yet)', async () => {
    for (const free of [true, false]) {
      for (const s of Object.values(await promptWithFee(free))) expect(s).not.toMatch(/google|search|tìm kiếm/i)
    }
  })

  it('never a FULL ad: the publish guard refuses contact details and the job-text screen certain lines, so no whole ad is promised', async () => {
    for (const free of [true, false]) {
      for (const s of Object.values(await promptWithFee(free))) expect(s).not.toMatch(/\bfull\b|complete|chi tiết|đầy đủ|toàn bộ/i)
    }
  })

  it('the line: the question, then the post form as the link, in the page’s href', () => {
    const a = anchor('vi', <PostJobLink href={POST_JOB} />)
    expect(a?.getAttribute('href')).toBe(POST_JOB)
    expect(a?.getAttribute('data-cross-link')).toBe('post-job')
    // The question stays outside the link; the link is the action.
    expect(text('vi', <PostJobLink href={POST_JOB} />)).toBe(`Bạn cần tuyển người? ${(a?.textContent ?? '').trim()}`)
    expect(a?.textContent).toMatch(/^Đăng /)
    expect(html('en', <PostJobLink href={POST_JOB} className="order-12 mt-0" />)).toMatch(/^<p class="[^"]*order-12 mt-0/)
  })

  it('the row form (/schools): the whole prompt is the link, in the row’s classes — no paragraph to nest in its <p>', () => {
    const out = html('en', <PostJobLink row href={POST_JOB} className="font-semibold text-accent-foreground hover:underline" />)
    expect(out).not.toContain('<p')
    const a = anchor('en', <PostJobLink row href={POST_JOB} className="font-semibold text-accent-foreground hover:underline" />)
    expect(a?.getAttribute('href')).toBe(POST_JOB)
    expect(a?.getAttribute('data-cross-link')).toBe('post-job')
    expect(a?.getAttribute('class')).toBe('font-semibold text-accent-foreground hover:underline')
    expect(a?.textContent).toBe(text('en', <PostJobLink row href={POST_JOB} />))
    expect(a?.textContent).toMatch(/^Hiring\? Post your job ad /)
  })

  // ⚠️ No viewport prefetch of /post (the wizard's route chunks — listings-explorer.tsx warmPost has the measurement): the
  // route is warmed on intent instead, pointer-down for touch and mouse-enter for a desktop hover, in both forms.
  it('warms the post form on pointer-down and on hover — the link itself never prefetches', () => {
    for (const row of [false, true]) {
      const { container, unmount } = render(<LanguageProvider initialLang="en" initialViDict={{}}><PostJobLink row={row} href={POST_JOB} /></LanguageProvider>)
      const a = container.querySelector('a[data-cross-link="post-job"]')!
      expect(h.prefetched).toEqual([])
      fireEvent.pointerDown(a)
      expect(h.prefetched).toEqual([POST_JOB])
      fireEvent.mouseEnter(a)
      expect(h.prefetched).toEqual([POST_JOB, POST_JOB])
      unmount()
      h.prefetched = []
    }
    // Both <Link>s in PostJobLink opt out of Next's viewport prefetch and carry the warm (read as source: a rendered <a>
    // shows neither).
    const src = readFileSync(join(process.cwd(), 'src/app/[lang]/c/[category]/teaching-links.tsx'), 'utf8')
    const body = src.slice(src.indexOf('export function PostJobLink'))
    const links = body.match(/<Link\b[^>]*>/g) ?? []
    expect(links).toHaveLength(2)
    for (const l of links) expect(l).toContain('prefetch={false} onPointerDown={warm} onMouseEnter={warm}')
    expect(body).toContain('const warm = () => router.prefetch(href)')
  })

  // What `/post?category=jobs` opens: the wizard picks the category's FIRST intent (post-wizard.tsx, the `?category=` way in;
  // post-wizard.services-entry.test.tsx renders it). That must stay Hiring — "Looking for work" in Teaching would hold a
  // school's Publish behind the teacher-profile card.
  it('the post form it opens takes a hiring post in Jobs › Teaching', () => {
    expect(isPostableCategory('jobs')).toBe(true)
    expect(typesFor('jobs')[0]).toBe('job')
    expect(isTeacherSeekingPost(TEACHER_SEEKING_POST.category, typesFor('jobs')[0], TEACHER_SEEKING_POST.subcategory)).toBe(false)
  })
})

describe('each surface renders <PostJobLink>, to the post form with Jobs picked, on both editions', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

  it('a teaching job’s page: the school’s line right after the teacher’s, same condition, ONE order-12 group', () => {
    const pdp = read('src/app/[lang]/listings/[id]/(pdp)/page.tsx')
    expect(pdp).toMatch(/import \{ PostJobLink, TeacherProfileLink \} from '@\/app\/\[lang\]\/c\/\[category\]\/teaching-links'/)
    // Jobs › Teaching, hiring — no edition gate: the post form is on both. One `order-12` item, so the page's gap falls
    // around the pair and its lines sit 12px apart (space-y-3, each line's own mt-3 zeroed — /c/jobs' rhythm).
    expect(pdp).toMatch(new RegExp([
      String.raw`\{listing\.listingType === 'job' && rawListing\.category\.slug === TEACHER_SEEKING_POST\.category && rawListing\.subcategorySlug === TEACHER_SEEKING_POST\.subcategory && \(`,
      String.raw`<div className="order-12 space-y-3">`,
      String.raw`<TeacherProfileLink href=\{localizedHref\('/teachers/join', pageVariant\)\} className="mt-0" />`,
      String.raw`<PostJobLink href=\{localizedHref\('/post\?category=jobs', pageVariant\)\} className="mt-0" />`,
      String.raw`</div>\s*\)\}`,
    ].join(String.raw`\s*`)))
    // Neither line carries an order of its own any more: the group is the slot.
    expect(pdp).not.toMatch(/<(TeacherProfileLink|PostJobLink) [^>]*order-12/)
  })

  it('/c/jobs: AFTER the teacher lines (profile, then guide), through postHereHref — `/post?category=jobs` on that page', () => {
    const page = read('src/app/[lang]/c/[category]/(index)/page.tsx')
    // The teacher lines stay together and the school's follows them; on eno.forum, where the guide line renders nothing
    // (IS_SERVICES), it follows the profile line.
    expect(page).toMatch(new RegExp([
      String.raw`\{cat\.slug === TEACHING_JOBS\.category && <TeacherProfileLink href=\{teacherJoinHref\} />\}`,
      String.raw`\{/\*[^]*?\*/\}`,
      String.raw`\{!IS_SERVICES && \(isTeachers \|\| cat\.slug === TEACHING_JOBS\.category\) && <TeachGuideLink />\}`,
      String.raw`\{/\*[^]*?\*/\}`,
      String.raw`\{cat\.slug === TEACHING_JOBS\.category && <PostJobLink href=\{postHereHref\} />\}`,
    ].join(String.raw`\s*`)))
    expect(page.match(/<PostJobLink\b/g)).toHaveLength(1)
    expect(page).toMatch(/const postHereHref = localizedHref\(`\/post\?\$\{new URLSearchParams\(\{ category: cat\.slug \}\)\.toString\(\)\}`, pageLang\(lang\)\)/)
    expect(TEACHING_JOBS.category).toBe('jobs')
    expect(localizedHref(`/post?${new URLSearchParams({ category: TEACHING_JOBS.category }).toString()}`, 'vi', pilot)).toBe(POST_JOB)
  })

  it('/schools: in the intro link row, the row form, after the teachers’ links', () => {
    const schools = read('src/app/[lang]/schools/page.tsx')
    expect(schools).toMatch(/import \{ PostJobLink \} from '@\/app\/\[lang\]\/c\/\[category\]\/teaching-links'/)
    const row = schools.indexOf('<p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">')
    const rowEnd = schools.indexOf('</p>', row)
    const at = schools.indexOf(`<PostJobLink row href={localizedHref('/post?category=jobs', lang)} className="font-semibold text-accent-foreground hover:underline" />`)
    const awards = schools.indexOf('<Link href={AWARDS_PATH}', row)
    expect(row).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(awards)
    expect(at).toBeLessThan(rowEnd)
    // ⛔ AT THE ROW'S TOP LEVEL, NO EDITION GATE AROUND IT. The JSX shape is pinned: the awards link, then only a comment,
    // then the prompt, then the row's own </p> — a `{cond && (` opened anywhere before it (around the awards link and the
    // prompt, or the prompt alone) would put `)}` or `</>` between the prompt and the </p>.
    expect(schools).toMatch(new RegExp([
      String.raw`<Link href=\{AWARDS_PATH\}[^\n]*</Link>`,
      String.raw`\{/\*[^]*?\*/\}`,
      String.raw`<PostJobLink row href=\{localizedHref\('/post\?category=jobs', lang\)\} className="font-semibold text-accent-foreground hover:underline" />`,
      String.raw`</p>`,
    ].join(String.raw`\s*`)))
    // …and every expression the row opens before it is closed before it: braces and parens balance from the row's <p> to
    // the prompt, comments aside (a gate opening earlier, say at the hub link, and enclosing the prompt fails here).
    const before = schools.slice(row, at).replace(/\{\/\*[^]*?\*\/\}/g, '')
    const count = (re: RegExp) => before.match(re)?.length ?? 0
    expect(count(/\{/g)).toBe(count(/\}/g))
    expect(count(/\(/g)).toBe(count(/\)/g))
    // No edition gate of its own (the hub link's marketplace gate closes before the awards link).
    expect(schools.slice(awards, at)).not.toContain('IS_SERVICES')
  })
})
