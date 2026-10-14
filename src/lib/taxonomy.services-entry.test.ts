import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { suggestSubcategory } from './taxonomy'

// Owner, 2026-10-14: "people can post any type of service jobs like dog walking baby sitting plumbing etc." — the words
// people use file the post in the right aisle (whole words, the longest keyword wins).
describe('services — the aisles find the words providers use', () => {
  it.each([
    ['Dog walking in Thao Dien, 1 hour', 'pet-services'],
    ['Dắt chó đi dạo buổi sáng', 'pet-services'],
    ['Pet sitter while you travel', 'pet-services'],
    ['Babysitting evenings and weekends', 'childcare'],
    ['Bảo mẫu tận nhà', 'childcare'],
    ['Plumbing repairs, same day', 'repair'],
    ['Sửa ống nước tận nơi', 'repair'],
    ['Thợ điện nước quận 7', 'repair'],
    // ⛔ "điện nước" alone is utilities, never Repair: a cleaning post that mentions them stays Cleaning.
    ['Dọn dẹp căn hộ, đã bao gồm điện nước', 'cleaning'],
  ])('%s → %s', (title, sub) => {
    expect(suggestSubcategory('services', title)).toBe(sub)
  })
})

describe('the pages around them', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('/c/services offers "Post your service" into the form with Services picked; an empty page posts into itself', () => {
    const page = src('src/app/[lang]/c/[category]/(index)/page.tsx')
    expect(page).toContain("{cat.slug === 'services' && <OfferServiceLink href={postHereHref} />}")
    expect(page).toContain("localizedHref(`/post?${new URLSearchParams({ category: cat.slug }).toString()}`, pageLang(lang))")
    expect(page).toContain("<Link href={isTeachers ? teacherJoinHref : postHereHref} className=\"px-5 py-2.5\">")
  })

  it('a service page says who answers for a licence or work permit — the provider', () => {
    const page = src('src/app/[lang]/listings/[id]/(pdp)/page.tsx')
    const en = 'Each provider is responsible for holding any licence or work permit they need to offer their service.'
    // ⚠️ Assembled, never written as a Tr/tr call: scripts/gen-ui-strings.mjs scans test files too, and would catalogue a
    // template placeholder as copy (taxonomy.post-picker.test.ts has the same note).
    expect(page).toContain(['<Tr', ' text="', en, '" />'].join('')) // eno.vn: the nine MT languages translate it
    expect(page).toContain(['tr(', "'", en, "'"].join('')) // eno.forum: an authored pair
    // eno.vn's Vietnamese is curated, never machine-made.
    expect(src('src/generated/vi-overrides.ts')).toContain(`"${en}": "Mỗi nhà cung cấp tự chịu trách nhiệm có đủ giấy phép hoặc giấy phép lao động cần thiết để cung cấp dịch vụ của mình."`)
  })
})
