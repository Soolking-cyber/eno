// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CLARITY_COPY_VERSION,
  CLARITY_PROJECT_ID,
  clarityConsent,
  clarityPathAllowed,
  copyRecordNamesClarity,
  claritySealed,
  loadClarity,
  noteClarityPath,
  serializeConsentCopy,
  syncClarity,
} from './clarity'
import { CONSENT_COPY_VERSION } from './consent-value'

const reset = () => {
  delete window.clarity
  delete window.__enoClarity
  delete window.__enoClaritySealed
  document.querySelectorAll('script[src*="clarity.ms"]').forEach((s) => s.remove())
}

describe('clarity — which answers start it', () => {
  it('the card naming Clarity is the one this build shows', () => {
    expect(CONSENT_COPY_VERSION >= CLARITY_COPY_VERSION).toBe(true)
  })

  it('needs a record of THIS answer, given to a card that names Clarity', () => {
    const ts = 1_790_000_000
    expect(copyRecordNamesClarity(serializeConsentCopy(ts, CLARITY_COPY_VERSION), ts, CONSENT_COPY_VERSION)).toBe(true)
  })

  it('⛔ fails closed: no record, another answer, an older card, a version never shown, junk', () => {
    const ts = 1_790_000_000
    expect(copyRecordNamesClarity(null, ts, CONSENT_COPY_VERSION)).toBe(false)
    expect(copyRecordNamesClarity(serializeConsentCopy(ts, CLARITY_COPY_VERSION), null, CONSENT_COPY_VERSION)).toBe(false)
    expect(copyRecordNamesClarity(serializeConsentCopy(ts - 1, CLARITY_COPY_VERSION), ts, CONSENT_COPY_VERSION)).toBe(false)
    expect(copyRecordNamesClarity(serializeConsentCopy(ts, '2026-10-12'), ts, CONSENT_COPY_VERSION)).toBe(false)
    expect(copyRecordNamesClarity(serializeConsentCopy(ts, '2099-01-01'), ts, CONSENT_COPY_VERSION)).toBe(false)
    expect(copyRecordNamesClarity(`${ts}.yes`, ts, CONSENT_COPY_VERSION)).toBe(false)
    expect(copyRecordNamesClarity(`x${ts}.${CLARITY_COPY_VERSION}`, ts, CONSENT_COPY_VERSION)).toBe(false)
  })
})

describe('clarity — private pages', () => {
  it.each([
    '/messages', '/messages/abc', '/dashboard', '/dashboard/account/verify', '/dashboard/wallet', '/account', '/admin/users',
    '/auth/callback', '/oauth/authorize', '/unsubscribe', '/classroom/join/ABC123', '/checkout/x', '/disputes', '/onboard', '/signin',
    '/vi/messages', '/en/dashboard', '/MESSAGES', '/messages/',
    '/account-deletion', '/appeal/x', '/reports/x', '/concierge', '/visa', '/visa/apply', '/itinerary',
    '/teachers/edit', '/teachers/job-messages', '/teachers/check-in', '/teachers/cover', '/teachers/cover-zalo',
  ])('%s is private', (p) => expect(clarityPathAllowed(p)).toBe(false))

  it.each([
    '/', '/vi', '/c/furniture-appliances', '/listings/abc', '/post', '/teachers', '/teachers/join', '/teachers/some-teacher',
    '/alice_shop', '/privacy', '/messages-guide', '/accounting', '/vietnam-evisa', '/saved',
  ])(
    '%s is public',
    (p) => expect(clarityPathAllowed(p)).toBe(true),
  )
})

describe('clarity — consent and loading', () => {
  beforeEach(reset)
  afterEach(reset)

  it('⛔ never grants advertising', () => {
    expect(clarityConsent(true)).toEqual({ ad_Storage: 'denied', analytics_Storage: 'granted' })
    expect(clarityConsent(false)).toEqual({ ad_Storage: 'denied', analytics_Storage: 'denied' })
  })

  it('queues consent BEFORE inserting the official tag, once', () => {
    document.head.appendChild(document.createElement('script'))
    loadClarity()
    loadClarity()
    const tags = document.querySelectorAll(`script[src="https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}"]`)
    expect(tags).toHaveLength(1)
    expect((tags[0] as HTMLScriptElement).async).toBe(true)
    const q = (window.clarity?.q ?? []).map((a) => Array.from(a as ArrayLike<unknown>))
    expect(q).toEqual([['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]])
    expect(window.__enoClarity).toBe('run')
  })

  it('a private page stops it with `stop` alone — the consent is unchanged', () => {
    loadClarity()
    window.clarity!.q = []
    syncClarity(false, true)
    expect(window.clarity!.q!.map((a) => Array.from(a as ArrayLike<unknown>))).toEqual([['stop']])
  })

  it('a withdrawal stops it (consent denied, then stop) and a new yes starts it again — only on a change', () => {
    loadClarity()
    window.clarity!.q = []
    syncClarity(true)
    expect(window.clarity!.q).toEqual([])
    syncClarity(false)
    syncClarity(false)
    const stopped = window.clarity!.q!.map((a) => Array.from(a as ArrayLike<unknown>))
    expect(stopped).toEqual([['consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }], ['stop']])
    window.clarity!.q = []
    syncClarity(true)
    expect(window.clarity!.q!.map((a) => Array.from(a as ArrayLike<unknown>))).toEqual([['start', {}], ['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]])
  })

  it('does nothing before it was ever loaded', () => {
    syncClarity(false)
    syncClarity(true)
    expect(window.clarity).toBeUndefined()
    expect(window.__enoClarity).toBeUndefined()
  })
})

describe('clarity — an address that may carry a secret seals the tab', () => {
  beforeEach(reset)
  afterEach(reset)

  it('⛔ after a join-code page, it never runs again in this tab — and never loads', () => {
    loadClarity()
    noteClarityPath('/classroom/join/ABC123')
    expect(claritySealed()).toBe(true)
    expect(window.__enoClarity).toBe('stopped')
    window.clarity!.q = []
    syncClarity(true)
    expect(window.clarity!.q).toEqual([])
    expect(window.__enoClarity).toBe('stopped')
  })

  it('a sealed tab never loads the tag', () => {
    noteClarityPath('/unsubscribe')
    loadClarity()
    expect(document.querySelector('script[src*="clarity.ms"]')).toBeNull()
  })

  it.each(['/messages/abc', '/dashboard', '/', '/listings/x'])('%s does not seal', (p) => {
    noteClarityPath(p)
    expect(claritySealed()).toBe(false)
  })

  it('⛔ a document reached FROM a join-code page starts sealed (clarity.js uploads document.referrer)', () => {
    const d = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer')!
    Object.defineProperty(document, 'referrer', { configurable: true, get: () => `${location.origin}/classroom/join/ABC123` })
    try {
      loadClarity()
      expect(claritySealed()).toBe(true)
      expect(document.querySelector('script[src*="clarity.ms"]')).toBeNull()
    } finally {
      delete (document as unknown as { referrer?: string }).referrer
      expect(Object.getOwnPropertyDescriptor(Document.prototype, 'referrer')).toEqual(d)
    }
  })
})
