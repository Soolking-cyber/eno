import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── The auto-mint path, which is the part that can take verification down ───────────────────────
//
// These exist because the plan review said, correctly, that "no credentials degrades safely" was
// the only failure proven. Everything here is a failure mode that a real VNPT incident produces,
// and every one of them must end in a transient/unavailable outcome — never in a seller being told
// their document was rejected, and never in a loop that hammers the provider.

const queryRaw = vi.fn()
const executeRaw = vi.fn()
vi.mock('@/lib/db', () => ({ db: { $queryRaw: queryRaw, $executeRaw: executeRaw } }))

const mintAccessToken = vi.fn()
vi.mock('./vnpt-auth', async (orig) => ({
  ...(await orig<typeof import('./vnpt-auth')>()),
  mintAccessToken: (...a: unknown[]) => mintAccessToken(...a),
}))

const NOW = 1_800_000_000_000
const jwt = (expMs: number) => `x.${Buffer.from(JSON.stringify({ exp: expMs / 1000 })).toString('base64url')}.sig`

/** No row in the table. */
const noRow = () => queryRaw.mockResolvedValue([])
/** A stored token expiring `ms` from NOW. */
const rowExpiringIn = (ms: number, token = 'stored-token') =>
  queryRaw.mockResolvedValue([{ access_token: token, expires_at: new Date(NOW + ms) }])

async function freshStore() {
  vi.resetModules()
  const m = await import('./vnpt-token-store')
  m.clearTokenCache()
  return m
}

beforeEach(() => {
  queryRaw.mockReset()
  executeRaw.mockReset().mockResolvedValue(1)
  mintAccessToken.mockReset()
  delete process.env.VNPT_EKYC_ACCESS_TOKEN
})

describe('auto-mint', () => {
  it('mints when nothing is stored, and persists what it minted', async () => {
    const { getAccessToken } = await freshStore()
    noRow()
    mintAccessToken.mockResolvedValue({ ok: true, token: 'minted', expiresAt: new Date(NOW + 7_199_000), claims: null })

    expect(await getAccessToken(NOW)).toBe('minted')
    expect(mintAccessToken).toHaveBeenCalledTimes(1)
    expect(executeRaw).toHaveBeenCalled() // wrote it to the shared row
  })

  it('mints when the stored token is inside the expiry skew', async () => {
    // ⚠️ Refresh EARLY. A token with 60s left dies mid-upload, and the 401 reads as a document
    // problem rather than a clock problem.
    const { getAccessToken } = await freshStore()
    rowExpiringIn(60_000)
    mintAccessToken.mockResolvedValue({ ok: true, token: 'fresh', expiresAt: new Date(NOW + 7_199_000), claims: null })

    expect(await getAccessToken(NOW)).toBe('fresh')
  })

  it('does NOT mint when the stored token is healthy', async () => {
    const { getAccessToken } = await freshStore()
    rowExpiringIn(60 * 60_000)

    expect(await getAccessToken(NOW)).toBe('stored-token')
    expect(mintAccessToken).not.toHaveBeenCalled()
  })

  it('⚠️ mints ONCE for a burst of concurrent callers', async () => {
    // A cold start taking 40 concurrent requests must not mint 40 tokens against a free tier.
    const { getAccessToken } = await freshStore()
    noRow()
    let resolve: (v: unknown) => void = () => {}
    mintAccessToken.mockReturnValue(new Promise((r) => { resolve = r }))

    const calls = Promise.all(Array.from({ length: 20 }, () => getAccessToken(NOW)))
    resolve({ ok: true, token: 'one', expiresAt: new Date(NOW + 7_199_000), claims: null })
    expect(await calls).toEqual(Array(20).fill('one'))
    expect(mintAccessToken).toHaveBeenCalledTimes(1)
  })
})

describe('failure handling — an outage must not become a storm', () => {
  it('⚠️ falls back to a still-valid token when the REFRESH mint fails', async () => {
    // agy's sharpest finding: we refresh 2 min before expiry, so a 429 in that window would send
    // every verification to manual review while a perfectly good token sat in the row.
    const { getAccessToken } = await freshStore()
    rowExpiringIn(60_000, 'old-but-alive')
    mintAccessToken.mockResolvedValue({ ok: false, reason: 'HTTP 429' })

    expect(await getAccessToken(NOW)).toBe('old-but-alive')
  })

  it('throws a NAMED failure when the mint fails and nothing usable remains', async () => {
    const { getAccessToken, VnptTokenUnavailable } = await freshStore()
    rowExpiringIn(-1000) // already dead
    mintAccessToken.mockResolvedValue({ ok: false, reason: 'HTTP 503' })

    await expect(getAccessToken(NOW)).rejects.toBeInstanceOf(VnptTokenUnavailable)
  })

  it('⚠️ COOLS DOWN after a failure instead of re-minting on every request', async () => {
    // Without this, a VNPT auth outage is amplified into a self-inflicted DDoS: every verification
    // finds no token, mints, fails, and the next one does it again, from every instance.
    const { getAccessToken } = await freshStore()
    noRow()
    mintAccessToken.mockResolvedValue({ ok: false, reason: 'HTTP 503' })

    await expect(getAccessToken(NOW)).rejects.toThrow()
    await expect(getAccessToken(NOW + 1_000)).rejects.toThrow()
    await expect(getAccessToken(NOW + 30_000)).rejects.toThrow()
    expect(mintAccessToken).toHaveBeenCalledTimes(1)

    // …and tries again once the cooldown lapses, so an outage that ends is recovered from.
    await expect(getAccessToken(NOW + 61_000)).rejects.toThrow()
    expect(mintAccessToken).toHaveBeenCalledTimes(2)
  })

  it('⚠️ the COOLDOWN must not cancel the still-valid fallback', async () => {
    // The bug all three reviewers found. `usable` demands MORE than the 2-min skew, so a token with
    // 60s left is not "usable" but is alive. With the cooldown checked first, every request for 60s
    // threw while a working token sat in the row — the cooldown silently cancelling the fallback.
    const { getAccessToken } = await freshStore()
    rowExpiringIn(60_000, 'old-but-alive')
    mintAccessToken.mockResolvedValue({ ok: false, reason: 'HTTP 429' })

    expect(await getAccessToken(NOW)).toBe('old-but-alive')        // first call: mint fails, falls back
    expect(await getAccessToken(NOW + 1_000)).toBe('old-but-alive') // second: INSIDE the cooldown
    expect(await getAccessToken(NOW + 30_000)).toBe('old-but-alive')
    expect(mintAccessToken).toHaveBeenCalledTimes(1)               // and still only one mint attempt
  })

  it('⚠️ a persist failure returns the token instead of throwing it away', async () => {
    // A throw from persist() used to propagate out of getAccessToken(), skipping BOTH the cooldown
    // and the fallback — so a Postgres blip killed verification and freed every later request to
    // hammer VNPT again.
    const { getAccessToken } = await freshStore()
    noRow()
    mintAccessToken.mockResolvedValue({ ok: true, token: 'minted', expiresAt: new Date(NOW + 7_199_000), claims: null })
    executeRaw.mockRejectedValue(new Error('connection terminated'))

    expect(await getAccessToken(NOW)).toBe('minted')
  })

  it('⚠️ a THROWING mint still records the cooldown and still falls back', async () => {
    const { getAccessToken } = await freshStore()
    rowExpiringIn(60_000, 'old-but-alive')
    mintAccessToken.mockRejectedValue(new Error('socket hang up'))

    expect(await getAccessToken(NOW)).toBe('old-but-alive')
    expect(await getAccessToken(NOW + 1_000)).toBe('old-but-alive')
    expect(mintAccessToken).toHaveBeenCalledTimes(1) // cooldown held despite the rejection
  })

  it('⚠️ a rejected mint does not poison the single-flight latch forever', async () => {
    // A rejected promise left in `inFlight` would make every later call replay the same failure.
    const { getAccessToken } = await freshStore()
    noRow()
    mintAccessToken.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(getAccessToken(NOW)).rejects.toThrow()

    mintAccessToken.mockResolvedValue({ ok: true, token: 'recovered', expiresAt: new Date(NOW + 7_199_000), claims: null })
    expect(await getAccessToken(NOW + 61_000)).toBe('recovered')
  })
})

describe('the env fallback is a fallback, not an override', () => {
  it('⚠️ never beats a stored token', async () => {
    // codex: "the env var wins if set" is a poison path — a stale value would beat every minted
    // token and could only be cured by a new Cloud Run revision.
    const { getAccessToken } = await freshStore()
    process.env.VNPT_EKYC_ACCESS_TOKEN = jwt(NOW + 9_000_000)
    rowExpiringIn(60 * 60_000)

    expect(await getAccessToken(NOW)).toBe('stored-token')
  })

  it('⚠️ is ignored when it has itself expired', async () => {
    const { getAccessToken } = await freshStore()
    process.env.VNPT_EKYC_ACCESS_TOKEN = jwt(NOW - 1000)
    noRow()
    mintAccessToken.mockResolvedValue({ ok: true, token: 'minted', expiresAt: new Date(NOW + 7_199_000), claims: null })

    expect(await getAccessToken(NOW)).toBe('minted')
  })
})

describe('invalidateAccessToken', () => {
  it('⚠️ deletes only the exact token that failed', async () => {
    // Both reviewers, independently: a slow request holding token A can 401 AFTER another instance
    // stored token B. An unconditional delete would wipe B and force another mint, oscillating.
    const { invalidateAccessToken } = await freshStore()
    await invalidateAccessToken('token-A')

    const values = executeRaw.mock.calls[0].slice(1)
    expect(values).toContain('token-A')
  })
})
