import { beforeAll, describe, expect, it, vi } from 'vitest'

// The pure half of the proof of employment (employment.ts); the retention sweep is covered by the routes probe.
vi.mock('@/lib/db', () => ({ db: {} }))
beforeAll(() => { process.env.SCHOOL_PROOF_SECRET ||= 'test-secret-for-school-proof-0123456789abcdef' })
const load = () => import('./employment')

describe('normaliseLinkedIn', () => {
  it('accepts a personal profile on any linkedin.com host and canonicalises it', async () => {
    const { normaliseLinkedIn } = await load()
    for (const raw of ['https://www.linkedin.com/in/Jane-Doe-123/', 'linkedin.com/in/jane-doe-123', 'https://vn.linkedin.com/in/jane-doe-123?trk=x#about', 'http://www.linkedin.com/in/jane-doe-123/details/experience/']) {
      expect(normaliseLinkedIn(raw), raw).toEqual({ slug: 'jane-doe-123', url: 'https://www.linkedin.com/in/jane-doe-123/' })
    }
  })

  it('refuses anything that is not a personal LinkedIn profile', async () => {
    const { normaliseLinkedIn } = await load()
    for (const raw of ['https://www.linkedin.com/company/ila-vietnam/', 'https://evil-linkedin.com/in/jane', 'https://linkedin.com.evil.io/in/jane', 'https://www.linkedin.com/in/ab', 'javascript:alert(1)', 'not a url',
      // A member-id share link: the same person as their public URL, so never a second key.
      'https://www.linkedin.com/in/ACoAAAB1c2VyIdABCDEFGHIJKLMNOPQRSTUVWX']) {
      expect(normaliseLinkedIn(raw), raw).toBeNull()
    }
  })
})

describe('codes and hashes', () => {
  it('a LinkedIn challenge is opaque (nothing about eno.vn or schools)', async () => {
    const { newChallenge } = await load()
    for (let i = 0; i < 50; i++) expect(newChallenge()).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/)
  })

  it('the hash is keyed and deterministic; without a 32+ character secret nothing can be proved', async () => {
    const { proofHash, proofConfigured } = await load()
    expect(proofHash('linkedin', 'jane-doe-123')).toBe(proofHash('linkedin', 'jane-doe-123'))
    expect(proofHash('linkedin', 'jane-doe-123')).not.toBe(proofHash('linkedin', 'jane-doe-124'))
    expect(proofConfigured()).toBe(true)
    const kept = process.env.SCHOOL_PROOF_SECRET
    process.env.SCHOOL_PROOF_SECRET = 'too-short'
    expect(proofConfigured()).toBe(false)
    process.env.SCHOOL_PROOF_SECRET = kept
  })
})
