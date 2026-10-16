import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ claimed: [] as unknown[], afters: 0, capi: false, claimsThrow: false, handleThrows: false, logged: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: () => { h.afters++ } }))
vi.mock('@/lib/db', () => ({ db: { profile: { update: async () => ({}) } } }))
vi.mock('@/lib/site-legal', () => ({ tosAcceptanceStamp: (cur: string | null) => (cur === 'v3' ? {} : { tosAcceptedAt: 'NOW', tosVersion: 'v3' }) }))
vi.mock('@/lib/admin', () => ({ isCurrentUserAdEmailWithheldByClaims: async () => { if (h.claimsThrow) throw new Error('auth claims: timeout'); return false } }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: () => {}, metaUserDataFromHeaders: () => ({}), metaCapiConfigured: () => h.capi }))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { h.logged.push(e) } }))
vi.mock('@/lib/attribution', () => ({ parseAttributionCookie: () => null }))
vi.mock('@/lib/consent-value', () => ({ serverConsent: () => ({ a: false }) }))
vi.mock('@/lib/handle', () => ({ autoClaimHandle: async (...a: unknown[]) => { h.claimed.push(a); if (h.handleThrows) throw new Error('handle: unique violation') } }))

import { afterIndividualOnboarding, individualOnboardingWrite } from './first-onboarding'

const req = new Request('https://eno.vn/api/teachers/me', { method: 'PUT' })
const base = { id: 'p1', email: 'a@example.com', phone: null, displayName: null as string | null, tosVersion: null as string | null }

beforeEach(() => { h.claimed = []; h.afters = 0; h.capi = false; h.claimsThrow = false; h.handleThrows = false; h.logged = [] })

describe('individualOnboardingWrite — what /onboard records for an individual, written by the teacher publish (owner, 2026-10-11)', () => {
  it('the type and the Terms acceptance in force; a display name asked for only where the account has none', () => {
    expect(individualOnboardingWrite(base)).toEqual({ data: { accountType: 'individual', tosAcceptedAt: 'NOW', tosVersion: 'v3' }, nameIfNone: true })
    expect(individualOnboardingWrite({ ...base, displayName: 'Bea' })).toEqual({ data: { accountType: 'individual', tosAcceptedAt: 'NOW', tosVersion: 'v3' }, nameIfNone: false })
  })
  it('an acceptance already of the version in force is not re-stamped', () => {
    expect(individualOnboardingWrite({ ...base, tosVersion: 'v3' }).data).toEqual({ accountType: 'individual' })
  })
})

describe('afterIndividualOnboarding — once the write committed', () => {
  it('claims a personal handle and sends the first-onboarding effects', async () => {
    await afterIndividualOnboarding(req, base, 'Bea Smith')
    expect(h.claimed[0]).toEqual([{ profileId: 'p1' }, 'Bea Smith'])
    expect(h.afters).toBeGreaterThan(0) // CompleteRegistration, after the response
  })
  it('⛔ never throws: a failing handle claim or effects lookup is logged — the account step is already recorded', async () => {
    h.handleThrows = true; h.capi = true; h.claimsThrow = true
    await expect(afterIndividualOnboarding(req, base, 'Bea Smith')).resolves.toBeUndefined()
    expect(h.logged).toHaveLength(2)
  })
})
