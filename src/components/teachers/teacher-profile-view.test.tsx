// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { COVER_CONSENT_VERSION } from '@/lib/teachers/cover'
import { TEACHER_OPTIONS } from '@/lib/teachers/profile'

// The server component reads one TeacherProfile row; the header, footer and contact block are their own suites.
const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  // "Identity verified" (src/lib/teachers/identity-mark.ts — its own rules are its own suite's): what the predicate
  // answers, whether it throws, and what each call was asked about.
  shown: false,
  shownThrows: false,
  markCalls: [] as unknown[][],
}))
vi.mock('@/lib/db', () => ({ db: { teacherProfile: { findUnique: async () => h.row } } }))
vi.mock('@/lib/teachers/identity-mark', () => ({
  identityMarkShownFor: async (...args: unknown[]) => {
    h.markCalls.push(args)
    if (h.shownThrows) throw new Error('identity read down')
    return h.shown
  },
}))
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
  // the account and the mark's inputs — read for one boolean, never rendered
  profileId: 'acct-7f3a9c2e-uuid', identityMarkOn: true, identityMarkNoticeVersion: '2026-10-16',
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
    el,
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
afterEach(() => { Reflect.deleteProperty(navigator, 'languages'); h.row = null; h.shown = false; h.shownThrows = false; h.markCalls = [] })

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
  it('⛔ in Vietnamese, labels and option chips are the taxonomy\'s own Vietnamese — never <Tr> (English in the HTML, then MT)', async () => {
    const p = await page('vi', {
      subjects: ['general-english', 'phonics'], ageGroups: ['kids', 'adults'], jobTypes: ['parttime', 'private'], expectedSalaryM: 20,
      degreeLevel: 'phd', certificates: [{ type: 'celta', hours: 120, provider: 'Cambridge', year: 2020 }],
      experience: [{ role: 'Teacher', employer: 'ILA', city: 'HCMC', from: '2020', to: '' }],
    })
    expect(p.row('Môn dạy')).toEqual(['Tiếng Anh tổng quát', 'Ngữ âm'])
    expect(p.row('Dạy lứa tuổi')).toEqual(['Trẻ em', 'Người lớn'])
    expect(p.row('Tìm việc')).toEqual(['Bán thời gian', 'Gia sư'])
    expect(p.row('Mức lương mong muốn')).toEqual([])
    expect(p.text).toContain('Kinh nghiệm')
    expect(p.text).not.toContain('Trải nghiệm') // the UI-string "Experience" — an experience you go on, not work history
    expect(p.text).toContain('HCMC · 2020 – nay')
    expect(p.text).toContain('Bằng cấp và chứng chỉTiến sĩ')
    expect(p.text).toContain('Bằng cấp và chứng chỉ do giáo viên tự khai.')
    expect(p.text).toContain('Giảng dạy')
    expect(p.row('Ngôn ngữ')).toEqual([])
    expect(p.text).toContain('/ tháng')
    expect(p.text).not.toMatch(/Subjects|Teaches|Teaching|Looking for|Expected salary|Languages|Qualifications|present|\bmonth\b|Private tutoring|Phonics/)
  })
  it('EVERY teacher option, in both languages, is its own label / labelVi — and a value the taxonomy does not know prints as stored', async () => {
    const { subject, ageGroup, jobType, cert, degree } = TEACHER_OPTIONS
    const over = {
      subjects: [...subject.map((o) => o.value), 'made-up-subject'], ageGroups: ageGroup.map((o) => o.value), jobTypes: jobType.map((o) => o.value),
      certificates: cert.map((o) => ({ type: o.value, hours: null, provider: '', year: null })),
    }
    for (const lang of ['en', 'vi'] as const) {
      const say = (o: { label: string; labelVi: string }) => (lang === 'vi' ? o.labelVi : o.label)
      const p = await page(lang, over)
      expect(p.row(lang === 'vi' ? 'Môn dạy' : 'Subjects')).toEqual([...subject.map(say), 'made-up-subject'])
      expect(p.row(lang === 'vi' ? 'Dạy lứa tuổi' : 'Teaches')).toEqual(ageGroup.map(say))
      expect(p.row(lang === 'vi' ? 'Tìm việc' : 'Looking for')).toEqual(jobType.map(say))
      const quals = [...p.el.querySelectorAll('section[aria-labelledby="t-quals"] li')].map((li) => li.textContent?.trim())
      expect(quals).toEqual(cert.map(say))
      for (const d of degree) {
        const q = await page(lang, { degreeLevel: d.value })
        expect(q.el.querySelector('section[aria-labelledby="t-quals"] li')?.textContent?.trim()).toBe(say(d))
      }
    }
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

describe('sharing the profile (owner, 2026-10-11)', () => {
  it('a profile schools can see has a Share button; a hidden one does not', async () => {
    expect((await page('en')).el.querySelector('button[aria-label="Share"]')).toBeTruthy()
    expect((await page('vi')).el.querySelector('button[aria-label="Chia sẻ"]')).toBeTruthy()
    expect((await page('en', {}, false)).el.querySelector('button[aria-label="Share"]')).toBeNull()
  })
})


/**
 * "IDENTITY VERIFIED" — THE PROFILE LINE (owner, 2026-10-15): full width under the header while the predicate says so
 * (src/lib/teachers/identity-mark.ts identityMarkShownFor — the switch under today's notice, a LIVE identity check, the
 * name within the ID): the label and one sentence on what was and was not checked, in English and Vietnamese. A failed
 * read hides it (fails closed). Nothing of it reaches the JSON-LD, and the account id the predicate is asked about never
 * reaches the HTML.
 */
describe('the "Identity verified" line', () => {
  const line = (el: HTMLElement) => el.querySelector('[data-identity-line]')
  it('shown: the label and the sentence, in English — under the header, before the rest of the page', async () => {
    h.shown = true
    const p = await page('en')
    const l = line(p.el)!
    expect(l).toBeTruthy()
    expect(l.textContent).toContain('Identity verified')
    expect(l.textContent).toContain('eno’s team checked this teacher’s ID document and a selfie, and the name above matches that ID. Nationality, qualifications and work permits are as the teacher states. Ask to see documents before hiring.')
    expect(l.previousElementSibling?.tagName).toBe('HEADER')
  })
  it('in Vietnamese — "xác minh", never "xác thực"', async () => {
    h.shown = true
    const p = await page('vi')
    const l = line(p.el)!
    expect(l.textContent).toContain('Đã xác minh danh tính')
    expect(l.textContent).toContain('Đội ngũ eno đã kiểm tra giấy tờ tùy thân và ảnh chân dung của giáo viên này; tên ở trên khớp với giấy tờ đó. Quốc tịch, bằng cấp và giấy phép lao động do giáo viên tự khai — hãy đề nghị xem giấy tờ trước khi tuyển dụng.')
    expect(p.el.innerHTML).not.toContain('xác thực')
  })
  it('the predicate is asked about THIS teacher, with exactly the four inputs it decides from', async () => {
    h.shown = true
    await page('en')
    expect(h.markCalls).toHaveLength(1)
    expect(h.markCalls[0][0]).toEqual({ profileId: 'acct-7f3a9c2e-uuid', fullName: 'Jane Doe', identityMarkOn: true, identityMarkNoticeVersion: '2026-10-16' })
    expect(h.markCalls[0][1]).toBeInstanceOf(Date)
  })
  it('not shown, or a failed read: no line (fails closed) — the page renders as before', async () => {
    h.shown = false
    expect(line((await page('en')).el)).toBeNull()
    h.shown = true
    h.shownThrows = true
    const p = await page('en')
    expect(line(p.el)).toBeNull()
    expect(p.text).toContain('Jane Doe')
  })
  it('⛔ nothing in the JSON-LD, and no account id (nor the switch) anywhere in the HTML', async () => {
    h.shown = true
    const p = await page('en')
    expect(JSON.stringify(p.ld)).not.toMatch(/Identity verified|identityMark|verified/i)
    expect(p.el.innerHTML).not.toContain('acct-7f3a9c2e-uuid')
    expect(p.el.innerHTML).not.toContain('2026-10-16')
    expect(p.el.innerHTML).not.toMatch(/identityMarkOn|profileId/)
  })
  it('no profile row behind the listing: no line, and no read', async () => {
    h.row = null
    const node = await TeacherProfileView({ listing: LISTING, canonicalUrl: 'https://eno.vn/listings/L1', indexable: true, lang: 'en' })
    const html = renderToString(<LanguageProvider initialLang="en" initialViDict={{}}>{node}</LanguageProvider>)
    expect(html).not.toContain('data-identity-line')
    expect(h.markCalls).toEqual([])
  })
})
