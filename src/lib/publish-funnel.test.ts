import { describe, expect, it } from 'vitest'
import { publishOutcome } from './publish-funnel'
import { PublishBlockedError } from './publish-guard'

/**
 * The outcome classifier for POST /api/listings. Its whole job is to make every exit point
 * of that handler countable WITHOUT a call at each one — so the tests that matter are the
 * ones proving no branch can go uncounted.
 */

describe('a successful publish', () => {
  it.each([200, 201])('counts %i as published', (status) => {
    expect(publishOutcome(status)).toBe('published')
  })

  it('ignores any body on success — 201 is 201', () => {
    expect(publishOutcome(201, 'photos_min')).toBe('published')
  })
})

describe('every refusal the route can return is counted under its own reason', () => {
  it.each([
    [429, 'rate_limited'],
    [400, 'invalid_input'],
    [400, 'contact_in_text'],
    [400, 'banned_words'],
    [400, 'unknown_category'],
    [403, 'account_restricted'],
    [409, 'duplicate_listing'],
    [400, 'photos_min'],
    [400, 'photo_required'],
    [400, 'contact_in_name'],
    [400, 'location_required'],
  ])('%i %s', (status, code) => {
    expect(publishOutcome(status, code)).toBe(code)
  })
})

describe('⚠️ a branch nobody labelled must still show up, never vanish', () => {
  it('buckets an unlabelled failure by status rather than dropping it', () => {
    // A funnel with a silently missing branch is worse than no funnel, because a missing
    // branch reads as zero. `http_500` is a prompt to go and name it.
    expect(publishOutcome(500)).toBe('http_500')
    expect(publishOutcome(500, undefined)).toBe('http_500')
    expect(publishOutcome(400, '')).toBe('http_400')
    expect(publishOutcome(400, '   ')).toBe('http_400')
  })

  it('survives a non-string error field instead of throwing inside the counter', () => {
    for (const weird of [null, 42, {}, [], true]) expect(publishOutcome(400, weird)).toBe('http_400')
  })
})

describe('⚠️ the counter is bounded — it must never become a string sink', () => {
  it('clamps to 40 chars, matching publish_log()', () => {
    expect(publishOutcome(400, 'x'.repeat(200))).toHaveLength(40)
  })
})

describe('⚠️ every PublishBlockCode round-trips, so the guard cannot outgrow the funnel', () => {
  it('classifies each code the publish guard can throw', () => {
    // Kept as a literal list rather than derived: if someone adds a code to PublishBlockCode,
    // this test still passes but the list visibly lacks it — and the http_400 bucket above is
    // the safety net that keeps it counted meanwhile.
    const codes = [
      'account_restricted', 'photo_required', 'photos_min', 'banned_words',
      'contact_in_text', 'contact_in_name', 'duplicate_listing', 'location_required',
    ] as const
    for (const code of codes) {
      const err = new PublishBlockedError(code)
      const status = code === 'account_restricted' ? 403 : code === 'duplicate_listing' ? 409 : 400
      expect(publishOutcome(status, err.code)).toBe(code)
    }
  })
})
