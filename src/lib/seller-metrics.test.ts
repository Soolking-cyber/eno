import { describe, expect, it, vi } from 'vitest'

/**
 * The seller's responsiveness label (SellerCard, the storefront card, the PDP shop link, the thread
 * header). What it must get right, pinned here:
 *   · nothing without a real track record (no receipt, or fewer than RESPONSE_MIN_CONVOS threads);
 *   · "Responds quickly" needs BOTH the 80% rate and a sub-hour median — and never names an hour;
 *   · 80% without the sub-hour median is "Usually replies within a day" (UX program 2, 2026-10-05):
 *     the rate IS the replied-within-24h share, so the label restates the measurement;
 *   · 50–79% stays "Responds within a day"; under 50% shows nothing.
 * The thresholds are unchanged; response-signal.ts mirrors them by reading the source.
 */

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/serialize', () => ({ serializeListingCard: (r: unknown) => r, LISTING_CARD_SELECT: {} }))

import { RESPONSE_MIN_CONVOS, responseBucket } from './seller-metrics'

const RECEIPT = new Date('2026-10-04T00:00:00Z')
const seller = (responseRate: number | null, responseTime: string | null, responseMetricAt: Date | null = RECEIPT) =>
  ({ responseRate, responseTime, responseMetricAt })
const bucket = (rate: number | null, time: string | null) => responseBucket(seller(rate, time), RESPONSE_MIN_CONVOS)

describe('responseBucket', () => {
  it('“Responds quickly” needs the 80% rate AND a sub-hour median — and never promises an hour', () => {
    const b = bucket(80, 'within an hour')
    expect(b).toEqual({ key: 'fast', en: 'Responds quickly', vi: 'Phản hồi nhanh' })
    // A MEDIAN under an hour does not support "usually within an hour".
    expect(b.en.toLowerCase()).not.toContain('hour')
    expect(b.vi).not.toContain('giờ')
    expect(bucket(100, 'within minutes').key).toBe('fast')
  })

  it('⛔ 80% without the sub-hour median: “Usually replies within a day” — the measurement, restated', () => {
    for (const time of ['within a day', 'within a few days', null]) {
      expect(bucket(80, time), String(time)).toEqual({ key: 'usuallyDay', en: 'Usually replies within a day', vi: 'Thường trả lời trong ngày' })
    }
    expect(bucket(97, 'within a day').key).toBe('usuallyDay')
  })

  it('50–79% stays “Responds within a day”, whatever the median — the rate decides first', () => {
    expect(bucket(79, 'within a day')).toEqual({ key: 'day', en: 'Responds within a day', vi: 'Phản hồi trong ngày' })
    expect(bucket(79, 'within an hour').key).toBe('day')
    expect(bucket(50, null).key).toBe('day')
  })

  it('under 50% shows nothing — "within a day" would be a false claim about a seller who mostly does not', () => {
    expect(bucket(49, 'within an hour')).toEqual({ key: null, en: '', vi: '' })
    expect(bucket(null, 'within an hour').key).toBeNull()
  })

  it('no track record, no label: below the conversation floor, or without the nightly job’s receipt', () => {
    expect(responseBucket(seller(100, 'within an hour'), RESPONSE_MIN_CONVOS - 1).key).toBeNull()
    expect(responseBucket(seller(100, 'within an hour', null), 50).key).toBeNull()
  })

  it('three claims, three keys, three labels — no two buckets share a key or a wording', () => {
    const shown = [bucket(90, 'within an hour'), bucket(90, 'within a day'), bucket(60, 'within a day')]
    expect(new Set(shown.map((b) => b.key)).size).toBe(3)
    expect(new Set(shown.map((b) => b.en)).size).toBe(3)
    expect(new Set(shown.map((b) => b.vi)).size).toBe(3)
    for (const b of shown) expect(b.en && b.vi).toBeTruthy()
  })
})
