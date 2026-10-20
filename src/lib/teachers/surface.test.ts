import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { matchHas, prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination'
import { FORUM_TEACHER_HOST, TEACHER_SIGNUP_ORIGIN, TEACHER_SURFACE_ORIGIN, isTeacherSurfacePath } from './surface'

/**
 * ⛔ eno.forum HANDS THE TEACHER SURFACE TO eno.vn (owner decision 6, 2026-10-20; ./surface.ts) — and eno.vn changes nothing.
 * The real next.config.ts is loaded once per edition and every request is resolved through Next's OWN matcher, host check
 * and destination compiler (src/lib/forum-canonical-redirect.test.ts does the same for the apex move), so a pattern Next
 * reads differently from how it looks fails here: an empty repeated parameter, a look-alike prefix, the query carried over.
 */
type Redirect = { source: string; destination: string; has?: Parameters<typeof matchHas>[2]; missing?: Parameters<typeof matchHas>[3]; permanent?: boolean }
const rules: Record<'services' | 'marketplace', Redirect[]> = { services: [], marketplace: [] }

beforeAll(async () => {
  for (const [edition, appUrl] of [['services', 'https://www.eno.forum'], ['marketplace', 'https://eno.vn']] as const) {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', appUrl)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn') // public: baked into the CSP; next.config refuses without it
    const config = (await import('../../../next.config')).default as { redirects: () => Promise<Redirect[]> }
    rules[edition] = await config.redirects()
    vi.unstubAllEnvs()
  }
})

/** Where `host` + `path` (+ query) goes, as Next resolves it — or null when no redirect matches. */
function resolve(edition: 'services' | 'marketplace', host: string, path: string, query: Record<string, string> = {}) {
  for (const r of rules[edition]) {
    const params = getPathMatch(r.source, { removeUnnamedParams: true, strict: true })(path)
    if (!params) continue
    const hasParams = matchHas({ headers: { host } } as unknown as IncomingMessage, query, r.has, r.missing)
    if (!hasParams) continue
    const { parsedDestination: d } = prepareDestination({ appendParamsToQuery: false, destination: r.destination, params: { ...params, ...hasParams }, query })
    return { to: `${d.protocol ? `${d.protocol}//${d.hostname}` : ''}${d.pathname}`, query: d.query, permanent: r.permanent }
  }
  return null
}

const TEACHER_PAGES = [
  '/c/teachers', '/c/teachers/d2', '/c/teachers/thao-dien', '/teachers/cover', '/teachers/join', '/teachers/edit',
  '/schools', '/schools/vus', '/schools/vus/review', '/schools/awards', '/schools/awards/2026', '/schools/suggest',
]
const NOT_TEACHER_PAGES = [
  '/', '/c/rentals', '/c/jobs', '/c/teachersx', '/c/teacher', '/c/teachers-x/d2', '/teachers', '/teachersx/cover',
  '/schoolsx', '/schools-guide', '/listings/cmuqf807001e801mveklo43iu', '/jobs-vietnam-expats', '/help', '/sellers/abc',
  '/api/teachers/me', '/c', '/x/schools', '/x/c/teachers',
]

describe('eno.forum → eno.vn: the teacher pages, by path', () => {
  it('⛔ every teacher page goes to the SAME path on eno.vn, permanently (308), with its query', () => {
    for (const p of TEACHER_PAGES) expect(resolve('services', 'www.eno.forum', p), p).toEqual({ to: `${TEACHER_SURFACE_ORIGIN}${p}`, query: {}, permanent: true })
    expect(resolve('services', 'www.eno.forum', '/teachers/join', { goal: 'cover', utm_source: 'fb' }))
      .toEqual({ to: 'https://eno.vn/teachers/join', query: { goal: 'cover', utm_source: 'fb' }, permanent: true })
    expect(resolve('services', 'www.eno.forum', '/c/teachers', { district: 'd2' })?.query).toEqual({ district: 'd2' })
  })

  it('nothing else moves: look-alike prefixes, a bare /teachers (no page there), the listings, the API', () => {
    for (const p of NOT_TEACHER_PAGES) expect(resolve('services', 'www.eno.forum', p), p).toBeNull()
  })

  it('the forum apex keeps its own first hop to www (then this one), and a mixed-case path is matched as Next matches it', () => {
    expect(resolve('services', 'eno.forum', '/c/teachers')?.to).toBe('https://www.eno.forum/c/teachers')
    expect(resolve('services', 'www.eno.forum', '/C/Teachers')?.to).toBe('https://eno.vn/c/teachers')
  })

  it('⛔ isTeacherSurfacePath is EXACTLY the path rules — what the links and the tests read cannot drift from what Next does', () => {
    for (const p of [...TEACHER_PAGES, ...NOT_TEACHER_PAGES, '/C/Teachers', '/SCHOOLS/VUS']) {
      const moved = resolve('services', 'www.eno.forum', p)
      expect(isTeacherSurfacePath(p), p).toBe(!!moved && moved.to.startsWith(`${TEACHER_SURFACE_ORIGIN}/`))
    }
  })
})

describe('eno.forum → eno.vn: the teacher sign-up host', () => {
  it('⛔ teacher.eno.forum, every page path, goes to the same path on teacher.eno.vn, with its query — `/` included', () => {
    expect(resolve('services', FORUM_TEACHER_HOST, '/', { utm_source: 'fb' })).toEqual({ to: `${TEACHER_SIGNUP_ORIGIN}/`, query: { utm_source: 'fb' }, permanent: true })
    for (const p of ['/teachers/join', '/c/teachers', '/x/y', '/robots.txt', '/apix', '/sw.jsx']) {
      expect(resolve('services', FORUM_TEACHER_HOST, p), p).toEqual({ to: `${TEACHER_SIGNUP_ORIGIN}${p}`, query: {}, permanent: true })
    }
  })

  it('keeps what the forum apex keeps: the API (beacons of a page still open), the build\'s chunks, .well-known, sw.js', () => {
    for (const p of ['/api', '/api/page-speed', '/api/translate', '/_next', '/_next/static/chunks/a.js', '/_next/image', '/.well-known', '/.well-known/assetlinks.json', '/sw.js']) {
      expect(resolve('services', FORUM_TEACHER_HOST, p), p).toBeNull()
    }
  })
})

describe('⛔ eno.vn: none of it', () => {
  it('a marketplace build carries no rule to eno.vn\'s teacher pages or its teacher host — eno.vn never redirects to itself', () => {
    expect(rules.marketplace.length).toBeGreaterThan(0)
    for (const r of rules.marketplace) {
      expect(r.destination, r.source).not.toMatch(/^https:\/\/eno\.vn\/(?:c\/teachers|teachers|schools)(?:\/|$)|^https:\/\/teacher\.eno\.vn/)
      expect(JSON.stringify(r.has ?? []), r.source).not.toContain(FORUM_TEACHER_HOST)
    }
    for (const p of TEACHER_PAGES) expect(resolve('marketplace', 'eno.vn', p), p).toBeNull()
    for (const p of ['/', '/x']) expect(resolve('marketplace', 'teacher.eno.vn', p), p).toBeNull()
  })

})
