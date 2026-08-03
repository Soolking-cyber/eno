import { describe, it, expect, vi } from 'vitest'
import { readMrz, extractMrzLines, readFailureHint, VARIANTS, MRZ_CHARSET, type OcrEngine } from './mrz-ocr'
import { outcomeToStatus, isTransient, quotaStatus, shouldAttempt } from './provider'
import { readTokenClaims, needsRefresh, missingScopes, vnptConfigured } from './vnpt-auth'

// A real, checksum-valid ICAO 9303 TD3 specimen (the standard's own example).
const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'
const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'

const engineReturning = (...pages: string[]): OcrEngine => {
  let i = 0
  return vi.fn(async () => pages[Math.min(i++, pages.length - 1)])
}

describe('extractMrzLines', () => {
  it('finds the MRZ pair among surrounding text', () => {
    // The crop band routinely catches a caption or the last line of print above the MRZ.
    expect(extractMrzLines(`REPUBLIC OF UTOPIA\n${L1}\n${L2}`)).toEqual([L1, L2])
  })

  it('normalises OCR-B filler misreads', () => {
    // '<' is very commonly returned as '«' by generic OCR; without normalising, length and charset
    // checks both fail and a perfectly good scan is rejected.
    const got = extractMrzLines(`${L1.replace(/</g, '«')}\n${L2}`)
    expect(got?.[0]).toBe(L1)
  })

  it('ignores lines of the wrong shape', () => {
    expect(extractMrzLines('SHORT\nALSO SHORT')).toBeNull()
  })

  it('rejects lines containing characters outside the MRZ alphabet', () => {
    const dirty = 'P'.padEnd(44, '@')
    expect(extractMrzLines(`${dirty}\n${dirty}`)).toBeNull()
  })

  it('the charset itself is the ICAO alphabet', () => {
    expect(MRZ_CHARSET).toHaveLength(37) // 26 letters + 10 digits + '<'
  })
})

describe('readMrz — checksum-driven variant search', () => {
  it('accepts a valid MRZ on the first variant and stops', () => {
    const engine = engineReturning(`${L1}\n${L2}`)
    return readMrz({ width: 800, height: 600 }, engine).then((r) => {
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.variantIndex).toBe(0)
        expect(r.attempts).toBe(1) // ⚠️ must NOT sweep further once it has passed
        expect(r.mrz.fields.passportNumber).toBe('L898902C3')
        expect(r.mrz.fields.nationalityCode).toBe('UTO')
      }
      expect(engine).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps sweeping when early variants read badly, and succeeds later', async () => {
    // Glare defeats variant 0; higher contrast rescues it. This is the whole point of the sweep.
    const engine = engineReturning('garbage', 'still garbage', `${L1}\n${L2}`)
    const r = await readMrz({ width: 800, height: 600 }, engine)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.variantIndex).toBe(2)
  })

  it('a throwing variant does not abort the sweep', async () => {
    // One preprocessing setting OOMing on a cheap phone must not lose the ones that would work.
    let n = 0
    const engine: OcrEngine = vi.fn(async () => {
      if (n++ === 0) throw new Error('wasm out of memory')
      return `${L1}\n${L2}`
    })
    const r = await readMrz({ width: 800, height: 600 }, engine)
    expect(r.ok).toBe(true)
  })

  it('reports checksums_failed — with the best near-miss — when lines are found but corrupt', async () => {
    // A single transposed digit: lines are clearly an MRZ, but the check digits say no.
    const corrupt = L2.replace('L898902C36', 'L898902C37')
    const r = await readMrz({ width: 800, height: 600 }, engineReturning(`${L1}\n${corrupt}`))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('checksums_failed')
      expect(r.attempts).toBe(VARIANTS.length) // exhausted every variant before giving up
      expect(r.best).toBeDefined()             // so the UI can name the failing field
    }
  })

  it('distinguishes "no MRZ in frame" from "MRZ unreadable"', async () => {
    const r = await readMrz({ width: 800, height: 600 }, engineReturning('PASSPORT\nUTOPIA'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_mrz_found')
  })

  it('⚠️ a forged-but-consistent MRZ still reads as valid — proving this is NOT verification', async () => {
    // Check digits are a mod-10 sum, not a signature. This test exists to keep the trust boundary
    // honest: if anyone ever wires readMrz() straight into a "verified" decision, this is the
    // reason they must not. The server decides, from evidence the client cannot author.
    const r = await readMrz({ width: 800, height: 600 }, engineReturning(`${L1}\n${L2}`))
    expect(r.ok).toBe(true) // a valid-looking MRZ from an untrusted source. Necessary, not sufficient.
  })
})

describe('failure guidance', () => {
  it('names the physical cause rather than saying "try again"', () => {
    const hint = readFailureHint({ ok: false, reason: 'checksums_failed', attempts: 4 })
    expect(hint.en).toMatch(/glare/i)
    expect(hint.vi).toMatch(/loá/i)
  })
})

describe('eKYC provider outcomes', () => {
  it('⚠️ quota exhaustion routes to human review, never to rejection', () => {
    // Merging these would tell honest Vietnamese citizens their national ID failed verification,
    // because we ran out of free calls.
    const quota = { status: 'unavailable', reason: 'quota_exhausted' } as const
    expect(outcomeToStatus(quota)).toBe('pending')
    expect(outcomeToStatus({ status: 'rejected', reason: 'face_mismatch' })).toBe('rejected')
    expect(isTransient(quota)).toBe(true)
  })

  it('a real verification maps to verified', () => {
    expect(outcomeToStatus({ status: 'verified', subject: 'x' })).toBe('verified')
  })

  it('quota warns before the wall, not at it', () => {
    const at = (used: number) => quotaStatus({ used, limit: 100, periodStart: new Date(0) })
    expect(at(10)).toBe('ok')
    expect(at(80)).toBe('warn')      // alert with headroom left to react
    expect(at(100)).toBe('exhausted')
    expect(shouldAttempt({ used: 100, limit: 100, periodStart: new Date(0) })).toBe(false)
  })
})

// ── VNPT token lifecycle ────────────────────────────────────────────────────────────────────────
// ⚠️ NO REAL TOKEN IN THIS FILE. Fixtures are locally-built JWTs with only an unsigned payload;
// a live credential in a test file is a credential in git forever.
describe('VNPT token lifecycle', () => {
  const jwt = (payload: object) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

  it('reads expiry from our own token without verifying it', () => {
    const c = readTokenClaims(jwt({ exp: 1785835553, jti: 'j1', scope: ['read'] }))
    expect(c?.exp).toBe(1785835553)
    expect(c?.scope).toEqual(['read'])
  })

  it('refreshes BEFORE expiry, not at it', () => {
    const exp = 2_000_000_000
    const nearly = exp * 1000 - 5 * 60 * 1000 // 5 min left — would die mid-upload
    expect(needsRefresh({ exp }, nearly)).toBe(true)
    expect(needsRefresh({ exp }, exp * 1000 - 6 * 60 * 60 * 1000)).toBe(false)
  })

  it('treats an unparseable or absent token as needing refresh (fail safe)', () => {
    expect(needsRefresh(null)).toBe(true)
    expect(readTokenClaims('not-a-jwt')).toBeNull()
    expect(readTokenClaims('')).toBeNull()
  })

  it('⚠️ flags a read-only token — eKYC verification is a WRITE', () => {
    // The token issued 2026-08-03 had scope:["read"]. Without this check the failure surfaces as a
    // confusing 403 that looks like a malformed request.
    expect(missingScopes({ exp: 1, scope: ['read'] })).toEqual(['write'])
    expect(missingScopes({ exp: 1, scope: ['read', 'write'] })).toEqual([])
  })

  it('is not configured unless EVERY credential is present', () => {
    // Half-configured is worse than off: it fails per-user, at verification time.
    expect(vnptConfigured()).toBe(false) // no env in test
  })
})
