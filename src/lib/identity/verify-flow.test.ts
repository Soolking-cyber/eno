import { describe, it, expect } from 'vitest'
import { __toIsoDate as toIsoDate } from './verify-flow'
import { quotaState } from './quota'
import { identityGateEnforced } from '@/lib/compliance/account-state'

describe('VNPT date parsing', () => {
  it('⚠️ reads DD/MM/YYYY positionally, never via the Date constructor', () => {
    // `new Date("02/01/2030")` is 2 Jan in Vietnam and 1 Feb in a US locale — a silent ~11-month
    // error in an EXPIRY check, in the direction that accepts already-lapsed documents.
    expect(toIsoDate('02/01/2030')).toBe('2030-01-02')
    expect(toIsoDate('26/12/1989')).toBe('1989-12-26')
  })
  it('returns undefined rather than guessing at an unexpected shape', () => {
    expect(toIsoDate('2030-01-02')).toBeUndefined()
    expect(toIsoDate('-')).toBeUndefined()
    expect(toIsoDate(undefined)).toBeUndefined()
  })
})

describe('quota', () => {
  it('warns at 80%, not at exhaustion', () => {
    // Warning at zero remaining is telling someone after it already broke.
    expect(quotaState(10, 100)).toBe('ok')
    expect(quotaState(80, 100)).toBe('warn')
    expect(quotaState(100, 100)).toBe('exhausted')
    expect(quotaState(101, 100)).toBe('exhausted')
  })
})

describe('publish gate kill switch', () => {
  it('⚠️ defaults OFF — wiring the gate and switching it on are different decisions', () => {
    // Every Profile row defaults to `unverified`, so enforcing before VNPT works refuses EVERY
    // seller with no route out: they cannot publish and they cannot verify.
    delete process.env.IDENTITY_GATE_ENFORCED
    expect(identityGateEnforced()).toBe(false)
  })
  it('requires the explicit value, not merely a set variable', () => {
    process.env.IDENTITY_GATE_ENFORCED = 'true'   // a plausible-but-wrong value
    expect(identityGateEnforced()).toBe(false)
    process.env.IDENTITY_GATE_ENFORCED = '0'
    expect(identityGateEnforced()).toBe(false)
    delete process.env.IDENTITY_GATE_ENFORCED
  })
})
