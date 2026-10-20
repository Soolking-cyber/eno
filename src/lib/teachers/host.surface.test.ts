import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `teacherSurfaceHref` — an href as THIS edition links it (./host.ts). On eno.forum a teacher page is eno.vn's own URL, since
 * the forum 308s it there (owner decision 6, 2026-10-20; ./surface.ts); on eno.vn every href is exactly what it was.
 * The edition is a getter so one file runs both (vitest pins NEXT_PUBLIC_ENO_EDITION=services).
 */
const h = vi.hoisted(() => ({ services: true }))
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<typeof import('@/lib/edition')>()), get IS_SERVICES() { return h.services } }))

import { teacherSurfaceHref } from './host'

afterEach(() => { h.services = true })

const TEACHER_HREFS = ['/c/teachers', '/c/teachers/d2', '/teachers/join', '/teachers/edit', '/teachers/cover', '/schools', '/schools/vus/review']
const OTHER_HREFS = ['/', '/c/rentals', '/c/jobs', '/c/teachersx', '/teachers', '/schoolsx', '/listings/abc', '/?category=teachers', '/vi', '/jobs-vietnam-expats']

describe('teacherSurfaceHref', () => {
  it('⛔ eno.forum: a teacher page is eno.vn\'s own URL — the path, query and fragment kept', () => {
    for (const href of TEACHER_HREFS) expect(teacherSurfaceHref(href), href).toBe(`https://eno.vn${href}`)
    expect(teacherSurfaceHref('/teachers/join?goal=cover')).toBe('https://eno.vn/teachers/join?goal=cover')
    expect(teacherSurfaceHref('/teachers/edit?step=finish#video')).toBe('https://eno.vn/teachers/edit?step=finish#video')
    expect(teacherSurfaceHref('/schools#how-it-works')).toBe('https://eno.vn/schools#how-it-works')
  })

  it('eno.forum: every other href comes back exactly as given — the explorer\'s teacher filter, look-alikes, absolute URLs', () => {
    for (const href of OTHER_HREFS) expect(teacherSurfaceHref(href), href).toBe(href)
    for (const href of ['https://eno.vn/c/teachers', 'https://teacher.eno.vn/', '//c/teachers', 'mailto:x@eno.vn', '']) {
      expect(teacherSurfaceHref(href), href).toBe(href)
    }
  })

  /**
   * ⛔ A VIETNAMESE READER'S LINKS GO THERE TOO (commit-gate review, 2026-10-20: "/vi/… twins escape both rules"). Every call
   * site composes `teacherSurfaceHref(localizedHref(path, lang))`, and eno.forum never pilots — `viPilotFor(true, …)` is
   * empty (lang-pinned.ts; lang-pinned.test.ts pins it) — so `localizedHref` hands every teacher path back plain and it
   * goes to eno.vn. A public `/vi/c/teachers`, `/vi/teachers/join`, `/vi/schools` or `/vi/listings/<id>` is a 404 on
   * BOTH sites (measured 2026-10-20), never a forum-hosted teacher page.
   */
  it('⛔ eno.forum: a Vietnamese reader\'s teacher links are eno.vn\'s too — localizedHref never makes a forum /vi path', async () => {
    const { localizedHref, VI_PILOT } = await import('@/lib/lang-pinned')
    expect(VI_PILOT).toEqual({ live: [], retired: [] })
    for (const href of TEACHER_HREFS) {
      expect(localizedHref(href, 'vi'), href).toBe(href)
      expect(teacherSurfaceHref(localizedHref(href, 'vi')), href).toBe(`https://eno.vn${href}`)
    }
  })

  it('⛔ eno.vn: every href comes back exactly as given — its own pages, linked as they always were', () => {
    h.services = false
    for (const href of [...TEACHER_HREFS, ...OTHER_HREFS, '/teachers/join?goal=cover']) expect(teacherSurfaceHref(href), href).toBe(href)
  })
})

/**
 * ⛔ EVERY `<TeacherProfileLink>` LINKS THROUGH `teacherSurfaceHref` (verify pass, 2026-10-20). It is a next/link `<Link>`
 * with the default prefetch, drawn on /c/jobs, /jobs-vietnam-expats AND under every teaching job's details on the PDP —
 * a forum page reachable for every job in Jobs › Teaching. The first cut wrapped the first two and missed the PDP's, so
 * www.eno.forum's teaching-job pages kept `href="/teachers/join"` (measured live 2026-10-20 on
 * /listings/cmvfxv64k00015kq4ky9p65ya): after the 308 every view would prefetch a payload that redirects cross-origin and
 * fails CORS, and the tap would pay the failed fetch before the document load. A text scan, so a call site added later is
 * held to it too: the href is `teacherSurfaceHref(…)` itself, or a same-file `const` built from it (/c/jobs' teacherJoinHref).
 */
describe('⛔ every <TeacherProfileLink> call site links through teacherSurfaceHref', () => {
  it('the PDP, /c/jobs and /jobs-vietnam-expats — and any site added later', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : []
    })
    const sites: string[] = []
    for (const file of [...walk('src/app'), ...walk('src/components')]) {
      const src = readFileSync(file, 'utf8')
      for (const [, expr] of src.matchAll(/<TeacherProfileLink\s+href=\{([^}]*)\}/g)) {
        const direct = expr.trim().startsWith('teacherSurfaceHref(')
        const viaConst = /^[A-Za-z_$][\w$]*$/.test(expr.trim()) && new RegExp(String.raw`const ${expr.trim()} = teacherSurfaceHref\(`).test(src)
        sites.push(`${file}: ${direct || viaConst ? 'ok' : expr.trim()}`)
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(3)
    expect(sites.filter((s) => !s.endsWith(': ok'))).toEqual([])
    expect(sites.some((s) => s.includes('listings/[id]/(pdp)/page.tsx'))).toBe(true)
  })
})
