// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { COVER_CONSENT_VERSION } from '@/lib/teachers/cover'

// The server component reads one TeacherProfile row; the header, footer and contact block are their own suites.
const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))
vi.mock('@/lib/db', () => ({ db: { teacherProfile: { findUnique: async () => h.row } } }))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/components/teachers/teacher-contact', () => ({ TeacherContact: () => null, TeacherContactJump: () => null }))

const { TeacherProfileView } = await import('./teacher-profile-view')

/**
 * THE PUBLIC TEACHER PROFILE ON THE v2 ANSWERS (teacher onboarding redesign, owner, 2026-10-08): "Lives in" from where
 * the teacher lives ("Not in Vietnam yet" abroad — never an empty city, never the old Hồ Chí Minh fallback), "Can teach
 * in" / "Would move to" from the one teach-area list, the English level and the experience band once answered, the
 * taught languages, cover's "Can travel to" from the DERIVED reach — and the video and contact rules as they were.
 */
const ROW = {
  fullName: 'Jane Doe', headline: 'CELTA teacher with 5 years in Saigon', bio: '', photoUrl: 'https://x/p.webp', videoUrl: null,
  nationality: 'GB', languages: ['French'], availableFrom: null, jobTypes: ['fulltime'], ageGroups: ['adults'], subjects: ['general-english'],
  experience: [], degreeLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null, certificates: [], expectedSalaryM: null,
  updatedAt: new Date('2026-10-08T00:00:00Z'),
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: null,
  teachAreas: ['online', 'd4', 'd7', 'ha-noi'], teachLanguages: [], englishLevel: 'native', experienceBand: '5-10-years',
  coverOpen: false, coverSlots: [], coverRateVnd: null, coverConfirmedAt: null, coverConsentVersion: null,
  videoOnRequest: false, private: { videoPath: null },
  // ⛔ the OLD columns — written mirrors, which the page must never read back as answers
  preferredCities: ['ho-chi-minh-city', 'da-nang'], openToOnline: false, coverAreas: ['d1'], nativeSpeaker: false, yearsExperience: 0, currentDistrict: 'Quận 1',
}
const LISTING = { id: 'L1', title: 'Jane Doe', images: [], video: null, updatedAt: new Date('2026-10-08T00:00:00Z') }

async function page(lang: 'en' | 'vi', over: Record<string, unknown> = {}, indexable = true) {
  h.row = { ...ROW, ...over }
  const node = await TeacherProfileView({ listing: LISTING, canonicalUrl: 'https://eno.vn/listings/L1', indexable, lang })
  const html = renderToString(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
  const el = document.createElement('div')
  el.innerHTML = html
  const ldText = el.querySelector('script[type="application/ld+json"]')?.textContent
  return {
    text: (el.textContent ?? '').replace(/\s+/g, ' '),
    /** the "label → chips" of one row of the Teaching list */
    row: (label: string) => {
      const dt = [...el.querySelectorAll('dt')].find((d) => d.textContent?.trim() === label)
      return dt ? [...(dt.nextElementSibling?.querySelectorAll('li') ?? [])].map((li) => li.textContent?.trim()) : null
    },
    ld: ldText ? JSON.parse(ldText) : null,
  }
}

beforeEach(() => { Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] }) })
afterEach(() => { Reflect.deleteProperty(navigator, 'languages'); h.row = null })

describe('the header line — nationality · English · experience · where they live', () => {
  it('HCMC, District 7: the curated district name, then the city — from the v2 answers, never the old mirrors', async () => {
    const { text } = await page('en')
    expect(text).toContain('United Kingdom · Native English speaker · 5–10 years teaching · Lives in District 7 (Phu My Hung), Ho Chi Minh City')
    expect(text).not.toContain('Quận 1') // the currentDistrict mirror
    expect(text).not.toMatch(/\b0 years teaching/) // the yearsExperience mirror
  })
  it('in Vietnamese: the place in Vietnamese, never machine-translated', async () => {
    const { text } = await page('vi')
    expect(text).toContain('Sống tại Quận 7 (Phú Mỹ Hưng), TP. Hồ Chí Minh')
    expect(text).toContain('Dạy 5–10 năm')
  })
  it('"somewhere else in Vietnam": the province', async () => {
    const { text } = await page('en', { livesIn: 'elsewhere', currentCity: '', currentDistrictKey: null, currentProvince: '52', teachAreas: ['online', 'p-52'] })
    expect(text).toContain('Lives in Gia Lai')
  })
  it('⛔ abroad: "Not in Vietnam yet · Online" — never a city, never the Hồ Chí Minh fallback', async () => {
    const { text } = await page('en', { livesIn: 'abroad', currentCity: '', currentDistrictKey: null, teachAreas: ['online', 'anywhere'] })
    expect(text).toContain('Not in Vietnam yet · Online')
    expect(text).not.toMatch(/Lives in|Ho Chi Minh/)
    const vi = await page('vi', { livesIn: 'abroad', currentCity: '', currentDistrictKey: null, teachAreas: ['anywhere'] })
    expect(vi.text).toContain('Chưa ở Việt Nam')
    expect(vi.text).not.toContain('Trực tuyến')
  })
  it('an unanswered English level or band is left out, not guessed', async () => {
    const { text } = await page('en', { englishLevel: null, experienceBand: null })
    expect(text).toContain('United Kingdom · Lives in District 7 (Phu My Hung), Ho Chi Minh City')
    expect(text).not.toMatch(/Native English speaker|years teaching/)
  })
})

describe('the teach areas — "Can teach in" near home (and Online), "Would move to" the rest', () => {
  it('HCMC: Online and the districts are "Can teach in"; Hanoi is a move', async () => {
    const p = await page('en')
    expect(p.row('Can teach in')).toEqual(['Online', 'District 4', 'District 7 (Phu My Hung)'])
    expect(p.row('Would move to')).toEqual(['Hanoi'])
    expect(p.text).not.toContain('Wants to work in')
    expect(p.text).not.toContain('Da Nang') // the preferredCities mirror is never read
  })
  it('abroad: Online, and "Anywhere in Vietnam" as the move', async () => {
    const p = await page('en', { livesIn: 'abroad', currentCity: '', currentDistrictKey: null, teachAreas: ['online', 'anywhere'] })
    expect(p.row('Can teach in')).toEqual(['Online'])
    expect(p.row('Would move to')).toEqual(['Anywhere in Vietnam'])
  })
  it('in Vietnamese, place names in Vietnamese', async () => {
    const p = await page('vi')
    expect(p.row('Có thể dạy tại')).toEqual(['Trực tuyến', 'Quận 4', 'Quận 7 (Phú Mỹ Hưng)'])
    expect(p.row('Sẵn sàng chuyển đến')).toEqual(['Hà Nội'])
  })
})

describe('teaching details', () => {
  it('"Other language" reads as the languages taught; an old "online" job type is not a job', async () => {
    const p = await page('en', { subjects: ['general-english', 'other-language'], teachLanguages: ['Korean', 'Japanese'], jobTypes: ['parttime', 'online'] })
    expect(p.row('Subjects')).toEqual(['General English', 'Korean', 'Japanese'])
    expect(p.row('Looking for')).toEqual(['Part-time'])
  })
  it('a cover-only teacher (no job type) gets no empty "Looking for" row', async () => {
    expect((await page('en', { jobTypes: [] })).row('Looking for')).toBeNull()
  })
  it('the start month as a month — "Now" is decided only after mount, never in the cached HTML', async () => {
    const p = await page('en', { availableFrom: new Date('2020-01-01T00:00:00Z') })
    // Long past, yet the server HTML says the month: the reader's clock turns it into "Now" only after mount.
    expect(p.row('Available')).toEqual([]) // the row is there, its value plain text (no chips)
    expect(p.text).toContain('AvailableFrom January 2020')
    expect(p.text).not.toMatch(/Available from|\bNow\b/)
    expect((await page('vi', { availableFrom: new Date('2026-11-01T00:00:00Z') })).text).toContain('Có thể bắt đầuTừ tháng 11/2026')
  })
  it('an old row\'s day-precise start (before 2026-10-08) still reads as its month', async () => {
    expect((await page('en', { availableFrom: new Date('2026-11-20T00:00:00Z') })).text).toContain('AvailableFrom November 2026')
  })
})

describe('cover lessons — "Can travel to" is the DERIVED reach', () => {
  const coverOn = { coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 200_000, coverConsentVersion: COVER_CONSENT_VERSION, coverConfirmedAt: new Date('2026-10-08T00:00:00Z') }
  it('the teach areas near home that are cover areas — D4 and D7 — never the stored coverAreas mirror, Online or a move', async () => {
    const p = await page('en', coverOn)
    expect(p.text).toContain('Available for cover lessons')
    const after = p.text.slice(p.text.indexOf('Can travel to'))
    expect(after).toMatch(/^Can travel to\s*District 4\s*District 7 \(Phu My Hung\)/)
    expect(after).not.toMatch(/^Can travel to[^T]*District 1/)
  })
  it('no reach near home (abroad) → no cover section at all', async () => {
    const p = await page('en', { ...coverOn, livesIn: 'abroad', currentCity: '', currentDistrictKey: null, teachAreas: ['online'] })
    expect(p.text).not.toContain('Available for cover lessons')
  })
  it('a consent under an older notice → no cover section', async () => {
    expect((await page('en', { ...coverOn, coverConsentVersion: '2026-01-01' })).text).not.toContain('Available for cover lessons')
  })
  it('⛔ a grant under the PICKED-AREAS notice (2026-10-07) never shows a derived reach the teacher did not pick (gate review, 2026-10-08)', async () => {
    // That notice named the areas the teacher ticked; the derived reach (D4 + D7 here, coverAreas ['d1']) is a new
    // promise — COVER_CONSENT_VERSION was bumped for it (cover.ts), so the old grant shows nothing until it is renewed.
    expect(COVER_CONSENT_VERSION).not.toBe('2026-10-07')
    const p = await page('en', { ...coverOn, coverConsentVersion: '2026-10-07' })
    expect(p.text).not.toContain('Available for cover lessons')
    expect(p.text).not.toContain('Can travel to')
  })
})

describe('JSON-LD', () => {
  it('a city teacher: homeLocation the city, knowsLanguage English first', async () => {
    const { ld } = await page('en')
    expect(ld.mainEntity.homeLocation.name).toBe('Ho Chi Minh City, Vietnam')
    expect(ld.mainEntity.knowsLanguage).toEqual(['English', 'French'])
  })
  it('⛔ abroad: no homeLocation — never ", Vietnam" around nothing', async () => {
    const { ld } = await page('en', { livesIn: 'abroad', currentCity: '', currentDistrictKey: null, teachAreas: ['online'] })
    expect(ld.mainEntity.homeLocation).toBeUndefined()
    expect(JSON.stringify(ld)).not.toContain(', Vietnam')
  })
  it('a province teacher: the province', async () => {
    const { ld } = await page('en', { livesIn: 'elsewhere', currentCity: '', currentDistrictKey: null, currentProvince: '52', teachAreas: ['p-52'] })
    expect(ld.mainEntity.homeLocation.name).toBe('Gia Lai, Vietnam')
  })
})

describe('the video rules stay', () => {
  it('a public video plays; a private one says "sent on request" and leaks no path', async () => {
    expect((await page('en', { videoUrl: 'https://x/v.mp4' })).text).toContain('Intro video')
    const priv = await page('en', { videoUrl: 'https://x/v.mp4', videoOnRequest: true, private: { videoPath: 'p1/secret.mp4' } })
    expect(priv.text).toContain('Sent on request')
    expect(JSON.stringify(priv)).not.toContain('secret.mp4')
  })
})

// The after-mount half (TeacherAvailableFrom): the READER's clock, on Vietnam's calendar, decides "Now".
describe('TeacherAvailableFrom — after mount', () => {
  afterEach(() => { cleanup(); vi.useRealTimers() })
  const mountAt = async (iso: string, from: string, lang: 'en' | 'vi' = 'en', toFake: ('Date' | 'setTimeout' | 'clearTimeout')[] = ['Date']) => {
    vi.useFakeTimers({ toFake })
    vi.setSystemTime(new Date(iso))
    const { TeacherAvailableFrom } = await import('./teacher-available-from')
    let c!: HTMLElement
    await act(async () => { c = render(<LanguageProvider initialLang={lang} initialViDict={{}}><TeacherAvailableFrom from={from} /></LanguageProvider>).container })
    return c
  }
  it('a month that has begun reads "Now" — 1 November in Hanoi is still 31 October in UTC', async () => {
    expect((await mountAt('2026-10-31T18:00:00Z', '2026-11-01')).textContent).toBe('Now')
    expect((await mountAt('2026-10-31T18:00:00Z', '2026-11-01', 'vi')).textContent).toBe('Ngay')
  })
  it('a month still ahead keeps its name', async () => {
    expect((await mountAt('2026-10-31T16:00:00Z', '2026-11-01')).textContent).toBe('From November 2026')
  })
  it('⛔ a page left open across that midnight turns into "Now" — no reload needed (gate review, 2026-10-08)', async () => {
    const c = await mountAt('2026-10-31T16:59:00Z', '2026-11-01', 'en', ['Date', 'setTimeout', 'clearTimeout']) // 23:59 in Hanoi
    expect(c.textContent).toBe('From November 2026')
    await act(async () => { vi.advanceTimersByTime(59_000) })
    expect(c.textContent).toBe('From November 2026') // 23:59:59 — not yet
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(c.textContent).toBe('Now')
  })
  it('⛔ an old row\'s mid-month day (the old form saved any day) reads "Now" only from that day — not on the 1st', async () => {
    expect((await mountAt('2026-11-05T03:00:00Z', '2026-11-20')).textContent).toBe('From November 2026')
    expect((await mountAt('2026-11-19T17:30:00Z', '2026-11-20')).textContent).toBe('Now') // 00:30 on 20 November in Hanoi
  })
})
