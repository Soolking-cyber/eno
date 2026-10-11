import { beforeEach, describe, expect, it, vi } from 'vitest'

const p = vi.hoisted(() => ({ profile: { accountType: null as string | null, phone: null as string | null } }))
vi.mock('@/lib/profile', () => ({ ensureProfile: async () => p.profile }))

import { finishSignInPath } from './auth-finish'

const USER = { id: 'u1' } as never

beforeEach(() => { p.profile = { accountType: null, phone: null } })

describe('finishSignInPath — the account-type step never interrupts a page that keeps its place (owner, 2026-10-11)', () => {
  it('a new account signing in on the teacher form goes straight back to it — every redirect-style method and native Apple', async () => {
    expect(await finishSignInPath(USER, '/teachers/join')).toBe('/teachers/join')
    expect(await finishSignInPath(USER, '/teachers/join?goal=cover')).toBe('/teachers/join?goal=cover')
  })
  it('anywhere else a new account still meets /onboard first, carrying next', async () => {
    expect(await finishSignInPath(USER, '/')).toBe('/onboard?next=%2F')
    expect(await finishSignInPath(USER, '/teachers/joinx')).toBe('/onboard?next=%2Fteachers%2Fjoinx')
    expect(await finishSignInPath(USER, '/teachers/edit')).toBe('/onboard?next=%2Fteachers%2Fedit')
  })
  it('an onboarded account goes to next', async () => {
    p.profile = { accountType: 'individual', phone: null }
    expect(await finishSignInPath(USER, '/listings/x')).toBe('/listings/x')
  })
  it('the /onboard detour carries no earlier failure either', async () => {
    expect(await finishSignInPath(USER, '/listings/x?auth_error=oauth')).toBe(`/onboard?next=${encodeURIComponent('/listings/x')}`)
  })
  it('a successful landing drops an earlier failure\'s auth_error from next', async () => {
    p.profile = { accountType: 'individual', phone: null }
    expect(await finishSignInPath(USER, '/teachers/join?goal=cover&auth_error=oauth')).toBe('/teachers/join?goal=cover')
  })
})

describe('…but only the account type: any other pending step still comes first (commit gate, 2026-10-11)', () => {
  it('an untyped account that also owes the phone (once required) meets /onboard even from the teacher form', async () => {
    vi.resetModules()
    vi.doMock('@/lib/auth-policy', async (orig) => ({
      ...(await orig<object>()),
      pendingOnboardingStep: (q: { accountType: string | null; phone: string | null } | null) => (!q ? null : !q.accountType ? 'account-type' : !q.phone ? 'phone' : null),
    }))
    const { finishSignInPath: finish } = await import('./auth-finish')
    p.profile = { accountType: null, phone: null }
    expect(await finish(USER, '/teachers/join')).toBe(`/onboard?next=${encodeURIComponent('/teachers/join')}`)
    p.profile = { accountType: null, phone: '+84901234567' }
    expect(await finish(USER, '/teachers/join')).toBe('/teachers/join')
    vi.doUnmock('@/lib/auth-policy')
  })
})

