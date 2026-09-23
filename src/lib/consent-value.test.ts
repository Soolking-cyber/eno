import { describe, expect, it } from 'vitest'
import {
  CONSENT_MAX_AGE_S,
  consentModeState,
  cookieFromHeader,
  parseConsentV2,
  resolveConsent,
  serializeConsent,
  serverConsent,
} from './consent-value'

/**
 * ⛔ THE ONE RULE FOR "WHAT DID THIS VISITOR AGREE TO?" — shared by the browser, the Meta CAPI gate and
 * the signup attribution copy. Every case below is a way consent could be read as a YES that was never
 * given: a v1 value, an expired or malformed v2 value, a legacy cookie beside a v2 refusal, the app.
 */

const NOW = 1_790_000_000
const CID = 'c0ffee00-1234-4abc-8def-001122334455'
const v2 = (bits: string, ts = NOW - 60, cid = CID) => `v2.${bits}.${ts}.${cid}`

describe('serialize / parse', () => {
  it('round-trips every combination of the three purposes', () => {
    for (const p of [false, true]) for (const a of [false, true]) for (const d of [false, true]) {
      const s = { p, a, d, ts: NOW, cid: CID }
      expect(parseConsentV2(serializeConsent(s))).toEqual(s)
    }
  })

  it('writes only cookie-safe characters (nothing to encode, nothing for a cookie parser to split)', () => {
    expect(serializeConsent({ p: true, a: false, d: true, ts: NOW, cid: CID })).toMatch(/^[A-Za-z0-9_.-]+$/)
  })

  it.each([
    ['a v1 value', 'all'],
    ['a truncated value', 'v2.101'],
    ['a flag that is not 0/1', v2('102')],
    ['a missing consent id', `v2.111.${NOW}.`],
    ['a short consent id', `v2.111.${NOW}.abc`],
    ['a consent id with a separator in it', `v2.111.${NOW}.abc;def=gh`],
    ['a future version', `v3.111.${NOW}.${CID}`],
    ['a zero timestamp', `v2.111.0.${CID}`],
  ])('rejects %s', (_label, raw) => {
    expect(parseConsentV2(raw)).toBeNull()
  })
})

describe('resolveConsent — the reading rule', () => {
  it('a v2 value gives exactly its own flags', () => {
    expect(resolveConsent({ v2Cookie: v2('010') }, NOW)).toMatchObject({ p: false, a: true, d: false, source: 'v2', cid: CID })
  })

  it('⛔ the COOKIE wins over localStorage (a withdrawal on another host updates only the cookie)', () => {
    expect(resolveConsent({ v2Cookie: v2('000'), v2Local: v2('111') }, NOW)).toMatchObject({ p: false, a: false, d: false })
  })

  it('localStorage is the fallback when there is no v2 cookie', () => {
    expect(resolveConsent({ v2Local: v2('100') }, NOW)).toMatchObject({ p: true, a: false, d: false })
  })

  it('⛔ an answer older than 12 months is NO answer — the visitor is asked again', () => {
    expect(resolveConsent({ v2Cookie: v2('111', NOW - CONSENT_MAX_AGE_S - 1) }, NOW)).toBeNull()
    expect(resolveConsent({ v2Cookie: v2('111', NOW - CONSENT_MAX_AGE_S + 60) }, NOW)).not.toBeNull()
  })

  it('⛔ an expired v2 value does NOT fall back to the legacy slots (they hold the refusal every v2 write stamps)', () => {
    // Without this, an expired "yes" would silently become a permanent, never-re-asked "no".
    expect(resolveConsent({ v2Local: v2('111', NOW - CONSENT_MAX_AGE_S - 1), legacy: ['essential'] }, NOW)).toBeNull()
  })

  it('a malformed v2 value also shuts the legacy fallback — it is asked again, never granted', () => {
    expect(resolveConsent({ v2Cookie: 'v2.garbage', legacy: ['essential'] }, NOW)).toBeNull()
  })

  it.each(['essential', 'accepted'])('legacy %s is an ANSWER — a refusal, never re-asked', (legacy) => {
    expect(resolveConsent({ legacy: [legacy] }, NOW)).toEqual({ p: false, a: false, d: false, ts: null, cid: null, source: 'legacy' })
  })

  it.each(['all', 'personalized', 'something-else'])('⛔ legacy %s is NO answer — nothing runs and the card asks once', (legacy) => {
    expect(resolveConsent({ legacy: [legacy] }, NOW)).toBeNull()
  })

  it('legacy slots are read in v1 order — the first present value decides', () => {
    expect(resolveConsent({ legacy: [null, 'essential', 'all'] }, NOW)).toMatchObject({ source: 'legacy' })
    expect(resolveConsent({ legacy: ['all', 'essential'] }, NOW)).toBeNull()
  })

  it('nothing stored is no answer', () => {
    expect(resolveConsent({}, NOW)).toBeNull()
  })
})

describe('serverConsent — the server gate (fails closed)', () => {
  const req = (cookie?: string, ua = 'Mozilla/5.0 (Macintosh)') =>
    new Headers({ 'user-agent': ua, ...(cookie ? { cookie } : {}) })

  it('grants exactly the v2 flags', () => {
    expect(serverConsent(req(`eno-consent-v2=${v2('011')}`), NOW * 1000)).toEqual({ p: false, a: true, d: true })
  })

  it('⛔ a bare v1 "all" grants NOTHING', () => {
    expect(serverConsent(req('eno-cookie-consent=all; eno-consent=all'), NOW * 1000)).toEqual({ p: false, a: false, d: false })
  })

  it('⛔ a shared v2 refusal beside a host-only v1 "all" grants nothing', () => {
    expect(serverConsent(req(`eno-cookie-consent=all; eno-consent-v2=${v2('000')}`), NOW * 1000)).toEqual({ p: false, a: false, d: false })
  })

  it('⛔ inside the native app analytics and advertising are off whatever is stored', () => {
    for (const ua of ['Mozilla/5.0 (iPhone) EnoNativeApp/1', 'Mozilla/5.0 (iPhone) EnoNativeTabs/1']) {
      expect(serverConsent(req(`eno-consent-v2=${v2('111')}`, ua), NOW * 1000)).toEqual({ p: true, a: false, d: false })
    }
  })

  it('an expired v2 cookie grants nothing', () => {
    expect(serverConsent(req(`eno-consent-v2=${v2('111', NOW - CONSENT_MAX_AGE_S - 5)}`), NOW * 1000)).toEqual({ p: false, a: false, d: false })
  })

  it('no cookie header grants nothing', () => {
    expect(serverConsent(req(), NOW * 1000)).toEqual({ p: false, a: false, d: false })
  })
})

describe('cookieFromHeader', () => {
  it('matches the NAME exactly — eno-consent never reads eno-consent-v2', () => {
    const h = `eno-consent-v2=${v2('111')}; eno-consent=essential`
    expect(cookieFromHeader(h, 'eno-consent')).toBe('essential')
    expect(cookieFromHeader(h, 'eno-consent-v2')).toBe(v2('111'))
    expect(cookieFromHeader('xeno-consent=all', 'eno-consent')).toBeNull()
  })
})

describe('consentModeState', () => {
  it('analytics_storage follows Analytics; the three ad signals follow Advertising', () => {
    expect(consentModeState({ a: true, d: false })).toEqual({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
    expect(consentModeState({ a: false, d: true })).toEqual({ analytics_storage: 'denied', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' })
  })
})
