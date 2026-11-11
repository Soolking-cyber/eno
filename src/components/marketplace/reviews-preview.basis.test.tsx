// @vitest-environment jsdom
/**
 * THE REVIEW BADGE, WORDED BY WHAT THE REVIEW IS OF (Review.basis — a seller-confirmed rental, lesson or service,
 * src/lib/service-deal.ts, 2026-11-11). ⛔ SPEC v3 A1: NO "VERIFIED" CLAIM — a seller's confirmation plus the buyer's "yes"
 * is not proof of fulfilment, so a basis review reads "Confirmed rental / lesson / service" ('Thuê / Buổi học / Dịch vụ đã
 * xác nhận') with no seal, on the listing page's preview, the storefront and the Help center alike. No basis (a goods
 * sale or an accepted offer) keeps "Verified buyer". The storefront's and the Help center's <Tr> badges are pinned in
 * source below, with their curated Vietnamese in vi-overrides.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const lang = vi.hoisted(() => ({ code: 'en' as 'en' | 'vi' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: lang.code, tr: (en: string, vi: string) => (lang.code === 'vi' ? vi : en) }),
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => ({}) }))
vi.mock('./rating-value', () => ({ RatingValue: ({ value }: { value: number }) => String(value) }))
vi.mock('./report-content-button', () => ({ ReportContentButton: () => null }))

import { ReviewsPreview } from './reviews-preview'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import type { SellerReviewPreview } from '@/lib/seller-metrics'

const reviews: SellerReviewPreview[] = [
  { author: 'An', rating: 5, text: 'Great room', verified: true, basis: 'rental', createdAt: '2026-11-01T00:00:00.000Z' },
  { author: 'Bao', rating: 5, text: 'Great teacher', verified: true, basis: 'lesson', createdAt: '2026-11-01T00:00:00.000Z' },
  { author: 'Chi', rating: 4, text: 'Fast fix', verified: true, basis: 'service', createdAt: '2026-11-01T00:00:00.000Z' },
  { author: 'Dung', rating: 4, text: 'Good bike', verified: true, createdAt: '2026-11-01T00:00:00.000Z' },
]
const view = () => render(<ReviewsPreview reviews={reviews} total={4} avg={4.5} sellerHref="/sellers/s1" />)
const badgeOf = (author: string) => screen.getByText(author).parentElement!.textContent!.replace(author, '').trim()

afterEach(() => { cleanup(); lang.code = 'en' })

describe('the listing page\'s review badge', () => {
  it('English: Confirmed rental / lesson / service by basis — never "Verified"; no basis keeps Verified buyer', () => {
    view()
    expect(badgeOf('An')).toBe('Confirmed rental')
    expect(badgeOf('Bao')).toBe('Confirmed lesson')
    expect(badgeOf('Chi')).toBe('Confirmed service')
    expect(badgeOf('Dung')).toBe('Verified buyer')
    for (const a of ['An', 'Bao', 'Chi']) expect(badgeOf(a)).not.toMatch(/verified/i)
  })

  it('Vietnamese: Thuê / Buổi học / Dịch vụ đã xác nhận — never "xác minh"; no basis keeps Đã mua', () => {
    lang.code = 'vi'
    view()
    expect(badgeOf('An')).toBe('Thuê đã xác nhận')
    expect(badgeOf('Bao')).toBe('Buổi học đã xác nhận')
    expect(badgeOf('Chi')).toBe('Dịch vụ đã xác nhận')
    expect(badgeOf('Dung')).toBe('Đã mua')
    for (const a of ['An', 'Bao', 'Chi']) expect(badgeOf(a)).not.toMatch(/xác minh/)
  })
})

/** Source without comment lines — a pin must match code, not the comment that explains it. */
const code = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\{?\/\*)/.test(l)).join('\n')

describe('the storefront\'s review badge (source pin + curated Vietnamese)', () => {
  const src = code('src/components/marketplace/seller-storefront.tsx')
  it('words the <Tr> badge by basis — Confirmed …, with Verified buyer only for none', () => {
    expect(src).toMatch(/r\.basis === 'rental' \? <Tr text="Confirmed rental" \/>/)
    expect(src).toMatch(/r\.basis === 'lesson' \? <Tr text="Confirmed lesson" \/>/)
    expect(src).toMatch(/r\.basis === 'service' \? <Tr text="Confirmed service" \/>/)
    expect(src).toMatch(/: <Tr text="Verified buyer" \/>/)
    expect(src).not.toMatch(/Verified (renter|student|client)/)
    // …and the seal only for "Verified buyer".
    expect(src).toMatch(/\{r\.basis \? <CheckCircle2 aria-hidden className="h-3 w-3" \/> : <ShieldCheck aria-hidden className="h-3 w-3" \/>\}/)
  })
  it('each has curated Vietnamese; the retired "Verified renter / student / client" have none', () => {
    expect(VI_OVERRIDES['Confirmed rental']).toBe('Thuê đã xác nhận')
    expect(VI_OVERRIDES['Confirmed lesson']).toBe('Buổi học đã xác nhận')
    expect(VI_OVERRIDES['Confirmed service']).toBe('Dịch vụ đã xác nhận')
    expect(VI_OVERRIDES['Verified buyer']).toBe('Người mua đã xác minh')
    for (const k of ['Verified renter', 'Verified student', 'Verified client']) expect(VI_OVERRIDES[k]).toBeUndefined()
  })
})

describe('the Help center\'s review badge (source pin)', () => {
  const src = code('src/components/marketplace/help-center.tsx')
  it('a basis review reads Confirmed …, with no seal; no basis keeps the sealed Verified buyer', () => {
    expect(src).toMatch(/review\.basis \? \(\s*<Badge variant="brand" size="sm">\s*<CheckCircle2 className="size-3" \/>\s*\{review\.basis === 'rental' \? <Tr text="Confirmed rental" \/>\s*: review\.basis === 'lesson' \? <Tr text="Confirmed lesson" \/>\s*: <Tr text="Confirmed service" \/>\}/)
    expect(src).toMatch(/<ShieldCheck className="size-3" \/>\s*<Tr text="Verified buyer" \/>/)
  })
})
