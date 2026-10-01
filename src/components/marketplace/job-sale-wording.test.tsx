import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * ⛔ AN EMPLOYER'S OWN JOB IS NOT A SALE, PAST THE POST WIZARD TOO (owner, 2026-10-01: "tailored to
 * post for job hiring"; review, same day). The listing page's safety line told a candidate to "Meet,
 * inspect, then pay" under a "Safe trading guide" link, and a job thread offered the employer "Price is
 * firm" / "Yes, still available" and the candidate "Is it still available?". This pins the hiring
 * wording on the rendered components, in both languages, and that every other listing keeps its own.
 */

let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (k: string) => k, setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))

import { SafetyStrip } from './safety-strip'
import { QuickReplyChips } from './quick-reply-chips'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const strip = (categorySlug: string) => text(renderToString(<SafetyStrip categorySlug={categorySlug} />))
const chips = (isSeller: boolean, job: boolean) =>
  text(renderToString(<QuickReplyChips isSeller={isSeller} job={job} hasPendingBuyerOffer={false} onInsert={() => {}} />))

describe('the listing page safety line on an employer\'s own job', () => {
  it('warns about the fee-to-get-hired scam, not about inspecting goods before paying', () => {
    LANG = 'en'
    const en = strip('jobs')
    expect(en).toContain('Never pay a fee or a deposit to get a job — eno never asks for one. Meet the employer at the workplace before you start.')
    expect(en).toContain('Safety guide')
    expect(en).not.toMatch(/inspect, then pay|Safe trading guide/)
    LANG = 'vi'
    const vi = strip('jobs')
    expect(vi).toContain('Đừng bao giờ trả phí hay đặt cọc để được nhận việc')
    expect(vi).toContain('Cẩm nang an toàn')
    expect(vi).not.toContain('kiểm tra hàng')
  })

  it('CONTROL: a sale keeps "Meet, inspect, then pay" and the trading guide', () => {
    LANG = 'en'
    const sale = strip('electronics')
    expect(sale).toContain('Meet, inspect, then pay.')
    expect(sale).toContain('Safe trading guide')
  })
})

describe('chat quick replies on a job thread', () => {
  it('the employer gets hiring replies — never "Price is firm" or "still available"', () => {
    LANG = 'en'
    const employer = chips(true, true)
    expect(employer).toContain('Yes, still hiring')
    expect(employer).toContain('Please send your CV')
    expect(employer).not.toMatch(/Price is firm|still available/)
    LANG = 'vi'
    const vi = chips(true, true)
    expect(vi).toContain('Vẫn đang tuyển nhé')
    expect(vi).not.toMatch(/Giá cố định|còn hàng/)
  })

  it('the candidate asks whether the job is still open, not whether it is "still available"', () => {
    LANG = 'en'
    expect(chips(false, true)).toBe('Is this job still open?')
    LANG = 'vi'
    expect(chips(false, true)).toBe('Vị trí này còn tuyển không ạ?')
  })

  it('CONTROL: a sale thread keeps its own chips', () => {
    LANG = 'en'
    expect(chips(true, false)).toContain('Price is firm')
    expect(chips(false, false)).toBe('Is it still available?')
  })
})
