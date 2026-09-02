import { describe, it, expect, vi } from 'vitest'
import { readMrz, extractMrzLines, readFailureHint, extractMrzFields, mergeMrzPool, poolToMrzLines, VARIANTS, MRZ_CHARSET, type OcrEngine } from './mrz-ocr'
import { parsePassportMrz } from '../identity/mrz'
import { outcomeToStatus, isTransient, quotaStatus, shouldAttempt } from './provider'
import { readTokenClaims, needsRefresh, effectiveExpiry, vnptConfigured } from './vnpt-auth'

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

describe('multi-frame salvage (real 2026-09-02 webcam captures of a TKM passport)', () => {
  // Four preprocessing variants of ONE webcam frame. No single one validates (each flips a different
  // digit and drops line-1 filler), but across them every field is read with a valid check digit.
  const CAP_COMPLETE = [
    'P<TKMBABAKULYYEV<<SHANAZAR<<<<<<<CKKEKKCK\nA1944134<6TKM9407152M 7O083S00LB00014670<<<<40',
    'P<TKMBABAKULYYEV<<SHANAZARK<K<<<<S<SS868888488\nA1944134<6TKM9407152M2708500LB 90014670<<<<40',
    'B<TKMBABAKULYYEV<<SHANAZARK<K<<<<<<S6666688885\nA1944134<6TKM9407 152M2708300LB00014670<<<<4U',
    'P<TKMBABAKULYYEV<<SHANAZARK<K<<<<S<SS868888488\nA1944134<6TKM9407152M2708500LB 90014670<<<<40',
  ]
  // A different frame of the SAME passport where the number digit is misread (4→6) in every variant —
  // the check digit correctly rejects it, so the passport number is unrecoverable from this frame alone.
  const CAP_NO_PASSPORT = [
    'P<TKMBABAKULYYEV<<SHANAZAR<<<<<<<<<<KEKK\nA1964134<6TKM9407152M27083500LB00014670<<<<49',
    'P<TKMBABAKULYYEV<<SHANAZARK<K<<<<<<<<<K<KKEKK\nA41964134<6TKE9407152M2 708300LB00014670<<<<40',
    'P<TKMBABAKULYYEV<<SHANAZARK<K<<<<<<<<<KKKEKEK\nA1964134<6TKM9407152M27083500LB00014670<<<<49',
    'P<TKMBABAKULYYEV<<SHANAZAR<K<<<<<<<<<KKKKEKEK\nA1964134<6TKE9407152M2 708300LB00014670<<<<40',
  ]

  it('recovers a valid MRZ from one capture whose every variant individually fails', async () => {
    let i = 0
    const r = await readMrz({ width: 10, height: 10 }, async () => CAP_COMPLETE[i++] ?? '')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mrz.fields.passportNumber).toBe('A1944134')
      expect(r.mrz.fields.dateOfBirth).toBe('1994-07-15')
      expect(r.mrz.fields.passportExpiryDate).toBe('2027-08-30')
    }
  })

  it('does NOT invent a passport number when every variant misread it (check digit rejects it)', () => {
    const pool = extractMrzFields(CAP_NO_PASSPORT)
    expect(pool.dateOfBirth).toBe('940715')
    expect(pool.expiry).toBe('270830')
    expect(pool.passportNumber).toBeUndefined()
    expect(poolToMrzLines(pool)).toBeNull()
  })

  it('accumulates across captures — a later frame supplies the field an earlier one missed', () => {
    let pool = mergeMrzPool({}, extractMrzFields(CAP_NO_PASSPORT))
    expect(poolToMrzLines(pool)).toBeNull() // still missing the passport number
    pool = mergeMrzPool(pool, extractMrzFields(CAP_COMPLETE)) // supplies it
    const lines = poolToMrzLines(pool)
    expect(lines).not.toBeNull()
    expect(parsePassportMrz(lines![0], lines![1]).valid).toBe(true)
  })

  it('a name-line missed by the crop does NOT block a fully check-valid line 2', async () => {
    // Band caught only line 2; line 1 came out as garbage not starting with P. Line 2 (with the passport
    // number) reads cleanly in ≥2 variants, so consensus is met and the number is trusted.
    const cap = [
      'OAD S S\nA1944134<6TKM9407152M2708300LB00014670<<<<40',
      'JL S\nA1944134<6TKM9407152M2708300LB00014670<<<<40',
      'P 2 2 J 7\nA1944134<6TKM9407152M2708300LB00014670<<<<40',
      'JL S S ASN\nA1944134<6TKM9407152M2708300LB00014670<<<<40',
    ]
    let i = 0
    const r = await readMrz({ width: 10, height: 10 }, async () => cap[i++] ?? '')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mrz.fields.passportNumber).toBe('A1944134')
      expect(r.mrz.fields.passportExpiryDate).toBe('2027-08-30')
      expect(r.mrz.fields.surname).toBeUndefined() // no name captured — the user types it
    }
  })

  it('⛔ a passport number seen in only ONE variant is NOT trusted (check-digit mod-10 blind spot)', () => {
    // The number is check-valid on a single line but appears nowhere else — a filler-as-letter misread
    // (`<`→`K`, both ≡ 0 mod 10) reads exactly like this. Consensus (≥2 agreeing) must withhold it.
    const oneVariant = extractMrzFields([
      'P<TKMX<<Y\nA1944134<6TKM9407152M2708300LB00014670<<<<40',
      'garbage only, no readable line 2 here',
    ])
    expect(oneVariant.dateOfBirth).toBe('940715')   // dates need no consensus (numeric, no blind spot)
    expect(oneVariant.expiry).toBe('270830')
    expect(oneVariant.passportNumber).toBeUndefined() // withheld — one variant is not enough
  })

  it('⛔ a synthesized MRZ is NAME-LESS even when a name line was read (the server prefers MRZ over typed)', () => {
    // Safety invariant: poolToMrzLines must never carry an OCR name into line 1 — a garbage read would
    // overwrite the user's confirmed, typed name in the stored record (all reviewers, 2026-09-02).
    const pool = { passportNumber: 'A1944134<', dateOfBirth: '940715', expiry: '270830', sex: 'M', nationality: 'TKM', nameLine: 'P<TKMWRONGNAME<<GARBAGE<<<<<<<<<<<<<<<<<<<<<<' }
    const lines = poolToMrzLines(pool)
    expect(lines).not.toBeNull()
    const m = parsePassportMrz(lines![0], lines![1])
    expect(m.valid).toBe(true)
    expect(m.fields.surname).toBeUndefined()      // no name from the synthesis — user types it
    expect(m.fields.givenNames).toBeUndefined()
    expect(m.fields.passportNumber).toBe('A1944134') // the check-valid number IS carried
  })

  it('⛔ never fuses two DIFFERENT identities — a conflicting passport/DOB resets the pool', () => {
    const a = { passportNumber: 'A1944134', dateOfBirth: '940715', expiry: '270830', nameLine: 'P<TKMX<<Y' }
    const b = { passportNumber: 'Z9999999', dateOfBirth: '800101' } // a different person
    const merged = mergeMrzPool(a, b)
    expect(merged.passportNumber).toBe('Z9999999') // pool discarded, rebuilt from the new document
    expect(merged.expiry).toBeUndefined()          // the old document's expiry did NOT carry over
  })
})

describe('failure guidance', () => {
  it('names the physical cause rather than saying "try again"', () => {
    const hint = readFailureHint({ reason: 'checksums_failed' })
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

  it('⚠️ effectiveExpiry takes the EARLIEST of exp and expires_in', () => {
    const t0 = 1_000_000_000_000
    // The real shape, measured 2026-08-04: expires_in 7199s, JWT exp 7200s out. expires_in wins.
    expect(effectiveExpiry({ exp: (t0 + 7_200_000) / 1000 }, 7199, t0)?.getTime()).toBe(t0 + 7_199_000)
    // …and the other direction: a JWT that dies before expires_in claims.
    expect(effectiveExpiry({ exp: (t0 + 60_000) / 1000 }, 7199, t0)?.getTime()).toBe(t0 + 60_000)
    // Either source alone is enough.
    expect(effectiveExpiry(null, 3600, t0)?.getTime()).toBe(t0 + 3_600_000)
    expect(effectiveExpiry({ exp: (t0 + 60_000) / 1000 }, undefined, t0)?.getTime()).toBe(t0 + 60_000)
  })

  it('⚠️ effectiveExpiry rejects junk rather than producing an Invalid Date', () => {
    // An Invalid Date compares false against everything, so it would never look expired — the same
    // fail-open shape the decision layer's malformed-expiry guard exists to stop.
    const t0 = 1_000_000_000_000
    expect(effectiveExpiry(null, undefined, t0)).toBeNull()
    expect(effectiveExpiry(null, 0, t0)).toBeNull()
    expect(effectiveExpiry(null, -5, t0)).toBeNull()
    expect(effectiveExpiry(null, 'soon', t0)).toBeNull()
    expect(effectiveExpiry(null, Number.NaN, t0)).toBeNull()
    expect(effectiveExpiry(null, Number.POSITIVE_INFINITY, t0)).toBeNull()
  })

  it('is not configured unless EVERY credential is present', () => {
    // Half-configured is worse than off: it fails per-user, at verification time.
    expect(vnptConfigured()).toBe(false) // no env in test
  })
})
