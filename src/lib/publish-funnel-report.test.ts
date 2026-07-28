import { describe, expect, it } from 'vitest'
import { PUBLISH_OUTCOME_COPY, summarisePublishFunnel } from './publish-funnel-report'

describe('the headline numbers', () => {
  const rows = [
    { outcome: 'published', total: 7 },
    { outcome: 'photos_min', total: 9 },
    { outcome: 'contact_in_text', total: 3 },
    { outcome: 'rate_limited', total: 1 },
  ]

  it('counts attempts as published + refused, never just the published row', () => {
    const r = summarisePublishFunnel(rows)
    expect(r.published).toBe(7)
    expect(r.refused).toBe(13)
    expect(r.attempts).toBe(20)
    expect(r.successRate).toBe(35)
  })

  it('⚠️ a reason share is of REFUSALS, not of attempts', () => {
    // "photos_min is 69% of refusals" sends someone to look at the photo rule. The same fact
    // as 45% of attempts sits next to a success rate and reads like noise.
    const { reasons } = summarisePublishFunnel(rows)
    expect(reasons[0]).toEqual({ outcome: 'photos_min', total: 9, share: 69 })
  })

  it('orders reasons biggest first, ties broken by name so the page never reshuffles', () => {
    const { reasons } = summarisePublishFunnel([
      { outcome: 'published', total: 1 },
      { outcome: 'banned_words', total: 4 },
      { outcome: 'photos_min', total: 4 },
      { outcome: 'contact_in_name', total: 9 },
    ])
    expect(reasons.map((r) => r.outcome)).toEqual(['contact_in_name', 'banned_words', 'photos_min'])
  })
})

describe('⚠️ it must never put NaN on an operator screen', () => {
  it('handles no data at all', () => {
    expect(summarisePublishFunnel([])).toEqual({
      attempts: 0, published: 0, refused: 0, successRate: 0, reasons: [],
    })
  })

  it('handles a perfect record — no refusals means no division by zero', () => {
    const r = summarisePublishFunnel([{ outcome: 'published', total: 5 }])
    expect(r.successRate).toBe(100)
    expect(r.reasons).toEqual([])
  })

  it('handles refusals with nothing published', () => {
    const r = summarisePublishFunnel([{ outcome: 'photos_min', total: 3 }])
    expect(r.successRate).toBe(0)
    expect(r.reasons[0].share).toBe(100)
  })

  it('drops malformed rows rather than propagating them', () => {
    const r = summarisePublishFunnel([
      { outcome: 'published', total: 4 },
      { outcome: '', total: 99 },
      { outcome: 'photos_min', total: -3 },
      { outcome: 'banned_words', total: Number.NaN },
      { outcome: 'contact_in_text', total: 4 },
    ] as { outcome: string; total: number }[])
    expect(r.attempts).toBe(8)
    expect(r.reasons.map((x) => x.outcome)).toEqual(['contact_in_text'])
  })
})

describe('an unrecognised code still reaches the operator', () => {
  it('has copy for every code the publish guard and the route can emit', () => {
    // ⚠️ THIS LIST IS THE AUDIT, and it is the whole route, not just publish-guard. The last
    // five come from resolve-seller.ts, enforcement.ts and the wrapper's own throw path — all
    // found missing only because a reviewer challenged the privacy of `outcome` and that sent
    // me to read every branch. They would otherwise have surfaced as bare codes on the page.
    for (const code of [
      'rate_limited', 'invalid_input', 'unknown_category', 'contact_in_text', 'contact_in_name',
      'banned_words', 'photo_required', 'photos_min', 'duplicate_listing', 'account_restricted',
      'location_required',
      'phone_taken', 'account_suspended', 'account_held', 'probation_listing_cap', 'exception',
    ]) expect(PUBLISH_OUTCOME_COPY[code]).toBeTruthy()
  })

  it('leaves a brand-new code to fall back to its raw string', () => {
    // The page renders `COPY[outcome] ?? outcome` and prints the code underneath either way,
    // so a reason added later shows up unlabelled rather than vanishing.
    expect(PUBLISH_OUTCOME_COPY['http_500']).toBeUndefined()
    expect(summarisePublishFunnel([{ outcome: 'http_500', total: 2 }]).reasons[0].outcome).toBe('http_500')
  })
})
