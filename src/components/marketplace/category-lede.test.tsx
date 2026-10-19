// @vitest-environment jsdom
/**
 * ⛔ THE LEDE OPENS WITH WHAT THE CATEGORY HOLDS, GROUPED (C1-LEDE, L-NUMBERS, 2026-09-29). It used to
 * BE the provenance sentence with a raw "63730 listings available." trailing it — no separator, and
 * the reader learned where the stock came from before what it was. Every number is a live count, so
 * these pin the frame and the gates, not a figure.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { CATEGORY_LINKED_SENTENCE, TEACHERS_CONTACT_SENTENCE, TEACHERS_H1, TEACHERS_PROFILE_SENTENCE } from '@/app/[lang]/c/[category]/category-copy'
import { CategoryLede, TeachersHeading } from './category-lede'
import { TEACHERS_COUNSEL_WORDS } from '@/test/teachers-counsel-words'

beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
})

const text = (lang: 'en' | 'vi', node: React.ReactNode) => {
  const el = document.createElement('div')
  el.innerHTML = renderToString(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const cat = { name: 'Electronics', nameVi: 'Điện tử', slug: 'electronics' }
const top = [
  { name: 'Phones', nameVi: 'Điện thoại', count: 41002 },
  { name: 'Laptops', nameVi: 'Laptop', count: 9114 },
  { name: 'Audio', nameVi: 'Âm thanh', count: 3508 },
]

describe('CategoryLede — the count sentence', () => {
  it('opens with the grouped count and the busiest subcategories, then the provenance sentence', () => {
    const en = text('en', <CategoryLede {...cat} linked="all" total={63730} top={top} />)
    expect(en).toBe(`63,730 listings in Electronics, including Phones (41,002), Laptops (9,114) and Audio (3,508). ${CATEGORY_LINKED_SENTENCE.all.en}`)
    const vi = text('vi', <CategoryLede {...cat} linked="all" total={63730} top={top} />)
    expect(vi).toBe(`63.730 tin đăng điện tử, gồm Điện thoại (41.002), Laptop (9.114) và Âm thanh (3.508). ${CATEGORY_LINKED_SENTENCE.all.vi}`)
    expect(`${en} ${vi}`).not.toMatch(/\d{5,}/)
  })

  it('is singular at exactly one, and names no subcategory when there is none to name', () => {
    expect(text('en', <CategoryLede {...cat} linked="none" total={1} />)).toMatch(/^1 listing in Electronics\. /)
    expect(text('vi', <CategoryLede {...cat} linked="none" total={1} />)).toMatch(/^1 tin đăng điện tử\. /)
  })

  it('prints no count on an empty category — never "0 listings"', () => {
    expect(text('en', <CategoryLede {...cat} linked="none" total={0} />)).not.toMatch(/\b0 listing/)
  })

  it('keeps the jobs safety sentence after the count', () => {
    expect(text('en', <CategoryLede name="Jobs" nameVi="Việc làm" slug="jobs" linked="all" total={2400} />)).toMatch(/^2,400 listings in Jobs\. Most jobs here link to the original posting/)
  })
})

/**
 * Plan B3 (teacher visibility plan, approved in the plan, 2026-10-18): /c/teachers is written for the people hiring.
 * The count counts teachers — it read "93 listings in Teachers" — with their subjects after a colon, and the sentences
 * after it are category-copy.ts's, so the page and its description say one thing (the claims and how each was checked
 * are there). The subject labels below are taxonomy.ts's, the counts the live lede's on 2026-10-18 — as inputs.
 */
describe('CategoryLede on /c/teachers — for the people hiring', () => {
  const teachers = { name: 'Teachers', nameVi: 'Giáo viên', slug: 'teachers' }
  const subjects = [
    { name: 'IELTS & exams', nameVi: 'IELTS & luyện thi', count: 60 },
    { name: 'English', nameVi: 'Tiếng Anh', count: 24 },
    { name: 'Subjects in English', nameVi: 'Môn học bằng tiếng Anh', count: 9 },
  ]

  it('counts teachers, not listings, their subjects after a colon, then what a profile shows and who may write', () => {
    const en = text('en', <CategoryLede {...teachers} total={93} top={subjects} />)
    expect(en).toBe(
      `93 teachers: IELTS & exams (60), English (24) and Subjects in English (9). ${TEACHERS_PROFILE_SENTENCE.en} ${TEACHERS_CONTACT_SENTENCE.en} Teachers: create your free profile`,
    )
    const vi = text('vi', <CategoryLede {...teachers} total={93} top={subjects} />)
    expect(vi).toBe(
      `93 giáo viên: IELTS & luyện thi (60), Tiếng Anh (24) và Môn học bằng tiếng Anh (9). ${TEACHERS_PROFILE_SENTENCE.vi} ${TEACHERS_CONTACT_SENTENCE.vi} Giáo viên: tạo hồ sơ miễn phí`,
    )
    expect(`${en} ${vi}`).not.toMatch(/listing|tin đăng|including|gồm/i)
  })

  /**
   * ⛔ THE COLON LIST ONLY WHEN IT ADDS UP (review round 2, owner 2026-10-18: "go with recommended"): the colon presents
   * the subjects as the whole breakdown, and topSubcategories never lists "Other languages". One teacher filed there
   * makes 94 of a list that sums to 93 — so the line is the count alone, the no-subcategory path, never a short list.
   * (Other shelves keep "including", which claims no whole: the Electronics lede above lists 53,624 of 63,730.)
   */
  it('lists the subjects only when they add up to the count — otherwise the count alone', () => {
    expect(text('en', <CategoryLede {...teachers} total={94} top={subjects} />)).toBe(
      `94 teachers. ${TEACHERS_PROFILE_SENTENCE.en} ${TEACHERS_CONTACT_SENTENCE.en} Teachers: create your free profile`,
    )
    expect(text('vi', <CategoryLede {...teachers} total={94} top={subjects} />)).toBe(
      `94 giáo viên. ${TEACHERS_PROFILE_SENTENCE.vi} ${TEACHERS_CONTACT_SENTENCE.vi} Giáo viên: tạo hồ sơ miễn phí`,
    )
    // However short it falls: 60 in IELTS & exams and 34 in Other languages lists IELTS & exams alone — no colon either.
    expect(text('en', <CategoryLede {...teachers} total={94} top={subjects.slice(0, 1)} />)).toMatch(/^94 teachers\. Profiles show/)
    expect(text('vi', <CategoryLede {...teachers} total={94} top={subjects.slice(0, 1)} />)).toMatch(/^94 giáo viên\. Hồ sơ nêu/)
  })

  it('is singular at exactly one, groups a large count, and prints no count on an empty category', () => {
    expect(text('en', <CategoryLede {...teachers} total={1} />)).toMatch(/^1 teacher\. Profiles show/)
    expect(text('vi', <CategoryLede {...teachers} total={1} />)).toMatch(/^1 giáo viên\. Hồ sơ nêu/)
    expect(text('en', <CategoryLede {...teachers} total={1250} />)).toMatch(/^1,250 teachers\. /)
    expect(text('vi', <CategoryLede {...teachers} total={1250} />)).toMatch(/^1\.250 giáo viên\. /)
  })

  it('says what profiles show only when there are profiles: an empty page opens on who may write', () => {
    for (const lang of ['en', 'vi'] as const) {
      const empty = text(lang, <CategoryLede {...teachers} total={0} />)
      expect(empty.startsWith(TEACHERS_CONTACT_SENTENCE[lang])).toBe(true)
      expect(empty).not.toContain(TEACHERS_PROFILE_SENTENCE[lang])
      expect(text(lang, <CategoryLede {...teachers} total={1} />)).toContain(TEACHERS_PROFILE_SENTENCE[lang])
    }
  })

  /**
   * ⛔ THE LEDE WAITS FOR COUNSEL TOO (plan C1, decision 4; review round 2): its Vietnamese is part of the school-side
   * wording (category-copy.ts TEACHERS_H1), so the rendered paragraph — count line, profile sentence, contact sentence and
   * join link — is held to the list the title and the description are (src/test/teachers-counsel-words.ts): no "nước
   * ngoài", no "cung cấp / giới thiệu / cho thuê giáo viên", over live profiles and on an empty page.
   */
  it('says nothing that waits for counsel — the rendered lede at 93 teachers and at none', () => {
    for (const lang of ['vi', 'en'] as const) {
      const live = text(lang, <CategoryLede {...teachers} total={93} top={subjects} />)
      const empty = text(lang, <CategoryLede {...teachers} total={0} />)
      // The whole paragraph rendered, so the guard reads real copy: the count line and the profile sentence at 93, and
      // the contact sentence in both.
      expect(live).toMatch(/^93 /)
      expect(live).toContain(TEACHERS_PROFILE_SENTENCE[lang])
      expect(empty).toContain(TEACHERS_CONTACT_SENTENCE[lang])
      expect(live.normalize('NFC')).not.toMatch(TEACHERS_COUNSEL_WORDS)
      expect(empty.normalize('NFC')).not.toMatch(TEACHERS_COUNSEL_WORDS)
    }
  })

  it('makes no "native", "verified", trust or visa claim, in either language', () => {
    for (const lang of ['en', 'vi'] as const) {
      const out = text(lang, <CategoryLede {...teachers} total={93} top={subjects} />)
      expect(out).not.toMatch(/native|bản ngữ|bản xứ|verified|xác minh|xác thực|trust|uy tín|visa|thị thực|residence|tạm trú|immigration|xuất nhập cảnh/i)
    }
  })

  it('the H1 renders exactly TEACHERS_H1 in both languages', () => {
    for (const lang of ['en', 'vi'] as const) expect(text(lang, <TeachersHeading />)).toBe(TEACHERS_H1[lang])
  })
})
