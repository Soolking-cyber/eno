import { describe, expect, it } from 'vitest'
import { publishOutcome } from './publish-funnel'
import { CLIENT_PUBLISH_OUTCOMES, isClientPublishOutcome } from './publish-funnel-codes'
import { PUBLISH_OUTCOME_COPY, summarisePublishFunnel } from './publish-funnel-report'

/**
 * The client-reported half of the publish funnel. `isClientPublishOutcome` is the ENTIRE input
 * validation on a public, unauthenticated endpoint, so these tests are the security boundary as
 * much as they are a unit test.
 */

describe('⚠️ the allowlist is the whole defence of a public counter endpoint', () => {
  it('accepts exactly the five wizard exits and nothing else', () => {
    expect([...CLIENT_PUBLISH_OUTCOMES]).toEqual([
      'client_missing_fields',
      'client_contact_in_name',
      'client_contact_in_text',
      'client_banned_words',
      'client_signin_required',
    ])
    for (const code of CLIENT_PUBLISH_OUTCOMES) expect(isClientPublishOutcome(code)).toBe(true)
  })

  it('rejects anything an attacker could send instead', () => {
    for (const bad of [
      'published',                      // ⚠️ must NOT be forgeable — it would fake a conversion
      'photos_min', 'rate_limited',     // server-owned outcomes, not the client's to assert
      'client_', 'CLIENT_MISSING_FIELDS', ' client_missing_fields', 'client_missing_fields ',
      'x'.repeat(500), '', '../../etc', "'; drop table publish_funnel;--", '__proto__', 'constructor',
    ]) expect(isClientPublishOutcome(bad)).toBe(false)
  })

  it('rejects every non-string, including the shapes a JSON body can carry', () => {
    for (const bad of [null, undefined, 42, true, {}, [], ['client_missing_fields'], { outcome: 'client_missing_fields' }])
      expect(isClientPublishOutcome(bad)).toBe(false)
  })

  it('⚠️ a client can never report a SUCCESS — only the server writes that', () => {
    // publishOutcome() maps a 2xx to 'published' server-side. If the client could post that
    // string, anyone could inflate the success rate and hide a broken funnel.
    expect(publishOutcome(201)).toBe('published')
    expect(isClientPublishOutcome('published')).toBe(false)
  })
})

describe('the client outcomes are readable in the admin view', () => {
  it('every code has operator copy — none renders as a bare slug', () => {
    for (const code of CLIENT_PUBLISH_OUTCOMES) expect(PUBLISH_OUTCOME_COPY[code]).toBeTruthy()
  })

  it('they count as refusals, not as published', () => {
    const r = summarisePublishFunnel([
      { outcome: 'published', total: 2 },
      { outcome: 'client_missing_fields', total: 6 },
      { outcome: 'client_signin_required', total: 2 },
    ])
    expect(r.published).toBe(2)
    expect(r.refused).toBe(8)
    expect(r.attempts).toBe(10)
    expect(r.successRate).toBe(20)
    expect(r.reasons[0].outcome).toBe('client_missing_fields')
  })
})
