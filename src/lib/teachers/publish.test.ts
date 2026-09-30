import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/core/listings', () => ({ deleteListingCore: vi.fn(), parseVideoField: () => ({ action: 'ignore' }) }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: vi.fn() }))
vi.mock('@/lib/translate', () => ({ warmTranslations: vi.fn() }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: vi.fn() }))
vi.mock('@/lib/trust', () => ({ initialSellerTrust: async () => ({}) }))

const { teacherVisaMention } = await import('./publish')

describe('teacherVisaMention', () => {
  it('catches a visa mention in any form', () => {
    for (const s of ['I can help with your visa', 'VISAS sorted', 'e-visa support', '#visa', 'hỗ trợ thị thực', 'visa.', '비자 지원', 'v.i.s.a help', 'lo thị-thực', 'e.visa', 'Visa-sponsored teacher', 'visa_support', 'work-visa ok', 'VISA-ready']) {
      expect(teacherVisaMention(s), s).toBe(true)
    }
  })
  it('does not block real places and names (Opus, commit gate 09-30)', () => {
    for (const s of ['Western Visayas', 'Visayas State University', 'Visakha Sharma', 'Revisa Academy', 'siêu thị thực phẩm']) {
      expect(teacherVisaMention(s), s).toBe(false)
    }
  })
})
