import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConciergeAction, PageState } from './types'

/**
 * THE CONCIERGE ON THE PAGE SIDE (PLAN §2, §10): the host follows a `go` only to a path it checks again itself — the
 * message is only data — and the window never floats over a page that owns the screen or the microphone.
 *
 * ⚠️ eno.vn's EDITION, IMPORTED AFTER THE STUB (as actions.test.ts): the `/vi` twin of the explorer exists only on the
 * marketplace build (lang-pinned.ts VI_PILOT) and vitest.config.ts pins 'services'.
 */
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
const {
  CONCIERGE_FRAME_PATH, CONCIERGE_OPEN_EVENT, CONCIERGE_PAGE_PATHS, conciergeAvailable, isConciergeFramePath, isConciergeHiddenPath,
  areaForGo, openConcierge, safeConciergeHref, setConciergeAvailable,
} = await import('./client')
const { CONCIERGE_PAGES, resolveAction } = await import('./actions')

afterEach(() => { vi.unstubAllGlobals() })

/** A listing id as Prisma writes it (cuid: 25 characters, `c` first). */
const CUID = 'ckq8w3x0a0000l1k2m3n4o5p6'

describe('safeConciergeHref — the paths a `go` may open', () => {
  it('accepts the explorer with any query, a listing, a fixed page — and returns the path it checked', () => {
    for (const href of [
      '/',
      '/vi',
      '/?category=teachers&attr_workIn=d1',
      '/vi?category=teachers&attr_workIn=d1',
      '/?category=teachers&attr_workIn=d1&attr_native=native&range_salaryM=30-40',
      '/?q=b%C3%A0n+h%E1%BB%8Dc&category=furniture-appliances',
      `/listings/${CUID}`,
      '/post',
      '/teachers/join',
      '/messages',
      '/help',
      '/hcmc-rent-index',
    ]) expect(safeConciergeHref(href), href).toBe(href)
  })

  it('refuses another origin, a backslash, a query on a page, a way out of the allowlist, a hash, an oversized or non-string href', () => {
    for (const href of [
      '//evil.com',
      '//evil.com/?category=teachers',
      'https://x',
      'https://eno.vn/',
      'javascript:alert(1)',
      'listings/x',
      '',
      '/\\evil',
      '/\\\\evil.com',
      '/\t/evil.com',
      '/post?x=1',
      `/listings/${CUID}?x=1`,
      '/listings/../admin',
      '/listings/%2e%2e/admin',
      '/admin',
      '/messages/abc',
      `/listings/${CUID}/edit`,
      '/listings/abc',
      `/listings/C${CUID.slice(1)}`,
      `/listings/c${'a'.repeat(31)}`,
      '/post/',
      '/POST',
      '/vi/help',
      '/en',
      '/concierge',
      '/classroom',
      '/?category=teachers#top',
      '/#x',
      '/post#x',
    ]) expect(safeConciergeHref(href), href).toBeNull()
  })

  it('2,000 characters at most', () => {
    const at = `/?q=${'a'.repeat(2_000 - 4)}`
    expect(at).toHaveLength(2_000)
    expect(safeConciergeHref(at)).toBe(at)
    expect(safeConciergeHref(`${at}a`)).toBeNull()
  })

  it('anything but a string is ignored', () => {
    for (const v of [undefined, null, 0, 1, true, {}, [], ['/'], { href: '/' }, new String('/'), Symbol('x')]) expect(safeConciergeHref(v), String(typeof v)).toBeNull()
  })

  it('a path that resolves onto an allowed one comes back RESOLVED — the host navigates to what was checked, never the raw text', () => {
    expect(safeConciergeHref('/./post')).toBe('/post')
    expect(safeConciergeHref('/listings/../post')).toBe('/post')
    expect(safeConciergeHref('/?q=bàn')).toBe('/?q=b%C3%A0n')
  })
})

describe('CONCIERGE_PAGE_PATHS — the host\'s list IS the server\'s (actions.ts CONCIERGE_PAGES)', () => {
  it('equals the non-home paths of CONCIERGE_PAGES, once each', () => {
    const server = Object.values(CONCIERGE_PAGES).map((p) => p.path)
    expect(new Set(CONCIERGE_PAGE_PATHS)).toEqual(new Set(server.filter((p) => p !== '/')))
    expect(new Set(CONCIERGE_PAGE_PATHS).size).toBe(CONCIERGE_PAGE_PATHS.length)
    // Home is the explorer itself, which the host accepts on its own terms.
    expect(server.filter((p) => !CONCIERGE_PAGE_PATHS.includes(p))).toEqual(['/'])
  })
})

describe('every href the SERVER builds passes the host unchanged (resolveAction → safeConciergeHref)', () => {
  const OFF: PageState = { href: '/help', kind: 'other', category: null, subcategory: null, filters: {}, search: '', total: null, cards: [], summary: '' }
  const act = (a: Partial<ConciergeAction>): ConciergeAction => ({ kind: 'browse', mode: 'replace', category: '', subcategory: '', filters: [], search: '', target: '', ...a })

  for (const lang of ['en', 'vi']) {
    it(`${lang}: every page, a listing from PAGE, and the owner's example ("a teacher in District 1")`, () => {
      const opts = { lang, listingIds: new Set([CUID]) }
      for (const target of Object.keys(CONCIERGE_PAGES)) {
        const r = resolveAction(act({ kind: 'page', target }), OFF, opts)
        expect(r, target).not.toBeNull()
        expect(safeConciergeHref(r!.href), r!.href).toBe(r!.href)
      }
      const listing = resolveAction(act({ kind: 'listing', target: CUID }), OFF, opts)
      expect(safeConciergeHref(listing!.href)).toBe(`/listings/${CUID}`)
      const browse = resolveAction(act({ category: 'teachers', filters: [{ key: 'district', value: 'd1' }] }), OFF, opts)
      expect(browse!.href).toBe(`${lang === 'vi' ? '/vi' : '/'}?category=teachers&attr_workIn=d1`)
      expect(safeConciergeHref(browse!.href)).toBe(browse!.href)
    })
  }
})

describe('isConciergeHiddenPath — pages the window never floats over', () => {
  it('the classroom, sign-in, auth, the messenger, the post flow, the admin and the frame itself', () => {
    for (const p of [
      '/classroom', '/classroom/x', '/classroom/join/abc', '/signin', '/signin/x', '/auth', '/auth/callback', '/messages', '/messages/1',
      '/post', '/post/', '/vi/post', '/listings/x/edit', '/listings/x/edit/', '/admin', '/admin/users', '/concierge', '/concierge/x',
    ]) expect(isConciergeHiddenPath(p), p).toBe(true)
  })

  it('no path known yet: hidden (fails closed)', () => {
    for (const p of [null, undefined, '']) expect(isConciergeHiddenPath(p), String(p)).toBe(true)
  })

  it('the explorer, a category page, a listing, the guides: the window may float', () => {
    for (const p of ['/', '/vi', '/c/teachers', '/c/teachers/d1', '/listings/abc', `/listings/${CUID}`, '/help', '/saved', '/schools', '/hcmc-rent-index']) {
      expect(isConciergeHiddenPath(p), p).toBe(false)
    }
  })

  it('whole segments only: /classrooms, /signing, /authors, /messagesx, /administrator, /conciergex are not hidden', () => {
    for (const p of ['/classrooms', '/signing', '/authors', '/messagesx', '/administrator', '/conciergex']) expect(isConciergeHiddenPath(p), p).toBe(false)
  })

  it('the pages a `go` leaves the window for agree with the host: /post and /messages close it and are hidden; the others are not', () => {
    for (const [key, { path, closes }] of Object.entries(CONCIERGE_PAGES)) {
      if (key === 'teacher-join') continue // see the regression below
      expect(isConciergeHiddenPath(path), path).toBe(closes)
    }
  })

  // Regression (found here 2026-10-27, fixed) — it was: client.ts:23-27 — '/teachers/join' is a page the window cannot live on (actions.ts CONCIERGE_PAGES 'teacher-join'
  // closes: true; PLAN §10 lists it with /post and /messages: "A host route change to any hidden path closes it too"), yet
  // isConciergeHiddenPath says false. So an in-app <Link href="/teachers/join"> (category-lede.tsx on the teachers shelf,
  // schools-sidebar.tsx, job-messages-panel.tsx) soft-navigates there with the window — its microphone and its billed face —
  // still floating over the sign-up form.
  it('/teachers/join, which a `go` must close the window for, is a hidden path', () => {
    expect(CONCIERGE_PAGES['teacher-join']).toMatchObject({ path: '/teachers/join', closes: true })
    expect(isConciergeHiddenPath('/teachers/join')).toBe(true)
  })
})

describe('the frame path, the switch and the open event', () => {
  it('isConciergeFramePath: /concierge and below, whole segment', () => {
    expect(CONCIERGE_FRAME_PATH).toBe('/concierge')
    expect(isConciergeFramePath('/concierge')).toBe(true)
    expect(isConciergeFramePath('/concierge/')).toBe(true)
    expect(isConciergeFramePath('/concierge/x')).toBe(true)
    for (const p of ['/conciergex', '/', '/vi/concierge', '', null, undefined]) expect(isConciergeFramePath(p), String(p)).toBe(false)
  })

  it('setConciergeAvailable / conciergeAvailable', () => {
    expect(conciergeAvailable()).toBe(false)
    setConciergeAvailable(true)
    expect(conciergeAvailable()).toBe(true)
    setConciergeAvailable(false)
    expect(conciergeAvailable()).toBe(false)
  })

  it('openConcierge dispatches the event the host listens for', () => {
    const target = new EventTarget()
    const got: string[] = []
    target.addEventListener(CONCIERGE_OPEN_EVENT, (e) => got.push(e.type))
    vi.stubGlobal('window', target)
    openConcierge()
    expect(CONCIERGE_OPEN_EVENT).toBe('eno:concierge-open')
    expect(got).toEqual(['eno:concierge-open'])
  })
})

describe('areaForGo — the area a `go` sets on the explorer (review, opus: every go cleared it)', () => {
  const q = (s: string) => new URLSearchParams(s)
  it('no place in the href or on the page: the person\'s own area stays (a ward, "near you")', () => {
    expect(areaForGo(q('category=rentals&sort=price-low'), q('category=rentals'))).toBeNull()
  })
  it('a place in the href replaces it — the ward only with its province', () => {
    expect(areaForGo(q('category=rentals&province=79&ward=26734'), q('category=rentals'))).toEqual({ province: '79', ward: '26734' })
    expect(areaForGo(q('category=rentals&district=d1'), q(''))).toEqual({ province: null, ward: null })
    expect(areaForGo(q('category=rentals&ward=26734'), q(''))).toEqual({ province: null, ward: null })
  })
  it('a place the page had and the href dropped ("anywhere"): the area clears', () => {
    expect(areaForGo(q('category=rentals'), q('category=rentals&province=79&ward=26734'))).toEqual({ province: null, ward: null })
  })
})

