import { describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { identityVerification: { findMany: (...a: unknown[]) => findMany(...a) } } }))

import { DECLARATIONS } from '@/lib/compliance/declaration-text'
import { IDENTITY_EXPORT_SELECT, identityVerificationExportOf, identityVerificationExportRows } from './export'

/**
 * The account export's identity section (2026-10-16): the facts of each check and the declaration affirmed before
 * uploading — the consent record for a teacher's "Identity verified" since identity-v2 — and never the document.
 */
const row = (over: Partial<Parameters<typeof identityVerificationExportRows>[0][number]> = {}) => ({
  tier: 'B', method: 'passport_mrz', status: 'verified',
  submittedAt: new Date('2026-10-10T03:00:00Z'), decidedAt: new Date('2026-10-11T03:00:00Z'),
  declarationVersion: 'identity-v2', declarationHash: 'a'.repeat(64), declaredAt: new Date('2026-10-10T02:59:00Z'), declarationIp: '203.0.113.7',
  ...over,
})

describe('identity checks in the account export', () => {
  it('carries the declaration with its exact words, version, time, address and digest', () => {
    const [out] = identityVerificationExportRows([row()])
    expect(out.declaration).toEqual({
      version: 'identity-v2', declaredAt: new Date('2026-10-10T02:59:00Z'), ip: '203.0.113.7', hash: 'a'.repeat(64),
      words: { vi: DECLARATIONS['identity-v2'].vi, en: DECLARATIONS['identity-v2'].en },
    })
    expect(out).toMatchObject({ tier: 'B', method: 'passport_mrz', status: 'verified' })
  })

  it('an identity-v1 record exports v1’s own words — never today’s', () => {
    const [out] = identityVerificationExportRows([row({ declarationVersion: 'identity-v1' })])
    expect(out.declaration?.words?.en).toBe(DECLARATIONS['identity-v1'].en)
    expect(out.declaration?.words?.en).not.toContain('(5)')
  })

  it('a row from before the declaration existed has none; an unknown id has no words', () => {
    expect(identityVerificationExportRows([row({ declarationVersion: null, declarationHash: null, declaredAt: null, declarationIp: null })])[0].declaration).toBeNull()
    expect(identityVerificationExportRows([row({ declarationVersion: 'identity-v9' })])[0].declaration).toMatchObject({ version: 'identity-v9', words: null })
  })

  it('⛔ selects the safe columns only — never the document, the names, the evidence or the subject hash', async () => {
    findMany.mockResolvedValueOnce([row()])
    await identityVerificationExportOf('p1')
    const arg = findMany.mock.calls[0][0] as { where: unknown; select: Record<string, true> }
    expect(arg.where).toEqual({ profileId: 'p1' })
    expect(arg.select).toBe(IDENTITY_EXPORT_SELECT)
    expect(Object.keys(arg.select).sort()).toEqual(
      ['decidedAt', 'declarationHash', 'declarationIp', 'declarationVersion', 'declaredAt', 'method', 'status', 'submittedAt', 'tier'],
    )
  })
})
