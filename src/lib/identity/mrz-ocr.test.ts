import { describe, it, expect, vi } from 'vitest'
import { readMrz, extractMrzLines, readFailureHint, extractMrzFields, mergeMrzPool, poolToMrzLines, namesFromNameLine, VARIANTS, MRZ_CHARSET, TD3_LINE_LENGTH, type OcrEngine } from './mrz-ocr'
import { parsePassportMrz } from '../identity/mrz'
import { outcomeToStatus, isTransient, quotaStatus, shouldAttempt } from './provider'
import { readTokenClaims, needsRefresh, effectiveExpiry, vnptConfigured } from './vnpt-auth'

// A real, checksum-valid ICAO 9303 TD3 specimen (the standard's own example).
const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'
const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'

// ⚠️ A SECOND, INVENTED specimen — every check digit computed, and an expiry inside the plausibility
// band `isMrzDate` enforces (the ICAO example above expired in 2012, so it can never enter the field
// pool and cannot exercise the fusion paths). Invented rather than borrowed from a real passport:
// these fixtures are read by anyone working on this file (fable).
const SYNTH_L1 = 'P<NLDDE<VRIES<<SOPHIE<ANNA<<<<<<<<<<<<<<<<<<'
const SYNTH_L2 = 'X1234567<7NLD8802141F3007310<<<<<<<<<<<<<<00'

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
      // ⚠️ WAS `VARIANTS.length`. readMrz no longer sweeps ONE band — it sweeps PASSES: the tight
      // MRZ_BAND × 4 variants, then a bottom-half band × 2, then (when the locator finds one) a
      // located band × 2, then the whole image × 1. This image carries no pixel data, so the locator
      // returns null and the total is 4 + 2 + 1. Everything below the tight band exists for the
      // file-picker path, where the passport is somewhere inside a whole photo.
      expect(r.attempts).toBe(VARIANTS.length + 3) // exhausted every pass before giving up
      expect(r.best).toBeDefined()             // so the UI can name the failing field
    }
  })

  it('distinguishes "no MRZ in frame" from "MRZ unreadable"', async () => {
    const r = await readMrz({ width: 800, height: 600 }, engineReturning('PASSPORT\nUTOPIA'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_mrz_found')
  })

  it('⛔ prefers a DIRECT, name-carrying read over an early name-less fusion', async () => {
    // ⚠️ THE REGRESSION codex AND agy BOTH CAUGHT IN THE PLAN. Variants 0 and 1 read line 2 cleanly
    // but lose line 1, which is already enough to fuse a complete pool (two lines agreeing on the
    // number). Variant 2 then reads the WHOLE pair, name and all. Fusing after every OCR call would
    // have returned the deliberately NAME-LESS synthesized MRZ at call 2 and thrown the seller's
    // pre-filled name away; fusing only at a PASS boundary keeps the faithful read strictly preferred.
    // ⚠️ THE INVENTED SPECIMEN, not the real capture above it — a diff that argues fixtures must be
    // invented and then commits a real passport number, name and date of birth has argued nothing
    // (fable). The pre-existing TKM captures stay; anything NEW uses SYNTH.
    const r = await readMrz(
      { width: 800, height: 600 },
      engineReturning(`JUNK\n${SYNTH_L2}`, `JUNK\n${SYNTH_L2}`, `${SYNTH_L1}\n${SYNTH_L2}`),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.attempts).toBe(3)
      expect(r.variantIndex).toBe(2)                  // the direct read, not the fusion (-1)
      expect(r.mrz.fields.surname).toBe('DE VRIES')   // …which is the whole point: the name survives
    }
  })

  it('widens the crop past the tight band when the tight band finds nothing', async () => {
    // ⛔ THE FILE-PICKER PATH. An in-app webview (Zalo, Facebook), a remembered permission denial or a
    // desktop with no camera all hand us a WHOLE PHOTO, where the MRZ is nowhere near the bottom 30%.
    // The sweep has to look further down the image or that seller can never autofill.
    const crops: number[] = []
    const engine: OcrEngine = vi.fn(async (_img, opts) => {
      crops.push(opts.crop.top)
      return opts.crop.top <= 0.45 ? `${L1}\n${L2}` : 'nothing here'
    })
    const r = await readMrz({ width: 800, height: 600 }, engine)
    expect(r.ok).toBe(true)
    expect(crops.slice(0, 4)).toEqual([0.7, 0.7, 0.7, 0.7]) // the tight band still goes first, untouched
    expect(crops).toContain(0.45)
  })

  it('the budget stops the ADDED passes — and never the tight band', async () => {
    // A phone that takes 30s per variant must not run the sweep for five minutes with the selfie
    // camera live beside it. ⛔ But the budget bounds what this file ADDED, never the pass that was
    // always here: the tight band is exempt, so a slow capture readable only by variant 2 or 3 still
    // gets those variants, exactly as it did before passes existed (codex).
    let t = 0
    const crops: number[] = []
    const engine: OcrEngine = vi.fn(async (_img, opts) => { crops.push(opts.crop.top); t += 30_000; return 'nothing here' })
    const r = await readMrz({ width: 800, height: 600 }, engine, {}, { budgetMs: 40_000, now: () => t })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(VARIANTS.length)          // all four tight variants ran…
    expect(crops.every((c) => c === 0.7)).toBe(true)  // …and the budget stopped everything after them
  })

  it('an image the locator cannot read keeps TODAY\'s order — tight band first', () => {
    // A locator that found nothing has told us nothing, so the pass order must not change: the band
    // that has always gone first still does, and the wider ones follow it.
    const crops: number[] = []
    const engine: OcrEngine = vi.fn(async (_img, opts) => { crops.push(opts.crop.top); return 'nothing here' })
    return readMrz({ width: 800, height: 600 }, engine).then(() => {
      expect(crops.slice(0, 4)).toEqual([0.7, 0.7, 0.7, 0.7])
      expect(crops).toContain(0.45)
    })
  })

  it('clamps ONE call\'s charge, so a suspended tab cannot spend the whole budget', async () => {
    // iOS suspends a backgrounded tab. If the suspension lands mid-call, the raw elapsed time is
    // minutes for a call that cost seconds of CPU — unclamped, that ends the sweep after one variant.
    // ⚠️ The budget is sized so the CLAMP is what decides. Four exempt tight calls charge 4×20s = 80s
    // against a 100s budget, leaving room for one more; unclamped they would charge 4×300s and stop
    // the sweep dead at the tight band.
    let t = 0
    const engine: OcrEngine = vi.fn(async () => { t += 300_000; return 'nothing here' })
    const r = await readMrz({ width: 800, height: 600 }, engine, {}, { budgetMs: 100_000, now: () => t })
    expect(r.attempts).toBe(VARIANTS.length + 1)
  })

  it('⛔ the TIGHT band is REACHED even with the budget already spent', async () => {
    // codex: a locator that misjudges a camera still could spend the entire budget on the passes ahead
    // of the tight band and return having never tried the crop that reads today's captures. The tight
    // pass is reserved out of the budget for exactly that reason.
    const W = 800, H = 600
    const data = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = 255 }
    // Ink low in the frame but ABOVE the tight band, so the locator leads and the tight pass follows.
    for (const y of [330, 349]) for (let x = 60; x < 740; x += 4) {
      for (let yy = y; yy < y + 11; yy++) for (let xx = x; xx < x + 3; xx++) {
        const i = (yy * W + xx) * 4
        data[i] = data[i + 1] = data[i + 2] = 30
      }
    }
    let t = 0
    const crops: number[] = []
    const engine: OcrEngine = vi.fn(async (_img, opts) => {
      crops.push(opts.crop.top)
      t += 300_000 // every call blows the whole budget on its own
      return opts.crop.top === 0.7 ? `${SYNTH_L1}\n${SYNTH_L2}` : 'nothing here'
    })
    const r = await readMrz({ width: W, height: H, data }, engine, {}, { budgetMs: 40_000, now: () => t })
    // Reached at all — this fixture reads on the tight band's FIRST variant and returns there, so the
    // count is 1 by early exit, not by the budget. That the pass runs in FULL when it has to is pinned
    // by "the budget stops the ADDED passes — and never the tight band" above.
    expect(crops).toContain(0.7)
    expect(r.ok).toBe(true)
  })

  it('⛔ a budget that runs out MID-PASS still returns what was salvaged', async () => {
    // finish() is reached on EXHAUSTION as well as at the end of the sweep, and exhaustion lands after
    // the pass boundary that would have fused. Without a fuse inside finish() a complete, check-valid
    // pool is thrown away and the seller is told to type 88 characters (agy).
    //
    // ⚠️ THE FIXTURE HAS TO REACH THAT BRANCH, AND AN EARLIER VERSION OF THIS TEST DID NOT — it fused
    // at the tight pass's own boundary and returned there, so it passed whether or not finish() fused
    // at all (codex + fable, the same "passes on the wrong path" defect this file flags elsewhere).
    // The tight band is budget-exempt, so the only way to exhaust the budget MID-pass is to make the
    // tight band contribute nothing and let a LATER pass supply the fields: line 2 appears solely in
    // the wide crop, whose second variant is refused for want of budget.
    let t = 0
    const engine: OcrEngine = vi.fn(async (_img, opts) => {
      t += 30_000
      // ⚠️ Line 2 TWICE in the one result: the passport number needs two lines to AGREE before it is
      // trusted (the mod-10 blind spot), and a single OCR pass that reads the band twice supplies that
      // consensus — which is what lets the pool complete WITHIN a pass rather than at its boundary.
      return opts.crop.top === 0.45 ? `JUNK\n${SYNTH_L2}\n${SYNTH_L2}` : 'nothing here'
    })
    const r = await readMrz({ width: 800, height: 600 }, engine, {}, { budgetMs: 100_000, now: () => t })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.variantIndex).toBe(-1)                  // salvaged, not a direct read
      expect(r.mrz.fields.passportNumber).toBe('X1234567')
      expect(r.attempts).toBe(VARIANTS.length + 1)     // 4 exempt tight calls + ONE wide call, then broke
    }
  })

  it('⛔ END TO END on a WHOLE PHOTO: the located band is what reads it', async () => {
    // ⚠️ EVERY OTHER readMrz TEST PASSES A DATA-LESS IMAGE, so the locator returns null and the
    // located-band branch never runs in any of them (fable). This one draws real pixels: a passport
    // lying on a desk, MRZ at y≈0.70 of the frame — the file-picker case. The engine answers ONLY for
    // a crop that actually frames the MRZ, so a pass this test passes is one the locator earned.
    const W = 800, H = 600
    const data = new Uint8ClampedArray(W * H * 4)
    const paint = (x0: number, y0: number, x1: number, y1: number, v: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4
        data[i] = data[i + 1] = data[i + 2] = v
        data[i + 3] = 255
      }
    }
    paint(0, 0, W, H, 205)          // desk
    paint(150, 120, 650, 470, 250)  // the page
    paint(175, 150, 275, 320, 60)   // the portrait
    for (const y of [408, 427]) for (let x = 175; x < 630; x += 4) paint(x, y, x + 3, y + 12, 30)

    const seen: Array<{ top: number; height: number }> = []
    const engine: OcrEngine = vi.fn(async (_img, opts) => {
      seen.push({ top: opts.crop.top, height: opts.crop.height })
      // The MRZ occupies y 0.680..0.732 of the frame, and the locator returns a band starting at
      // ~0.662. ⚠️ THE CUT IS 0.67, NOT 0.66: at 0.66 the LOCATED band missed by a thousandth and the
      // WIDE pass (0.45) answered instead — the test still passed, on the wrong pass, asserting
      // nothing about the thing it is named for (fable). Hence the call-count assertion below.
      const covers = opts.crop.top <= 0.67 && opts.crop.top + opts.crop.height >= 0.75
      return covers ? `${SYNTH_L1}\n${SYNTH_L2}` : 'blank desk'
    })
    const r = await readMrz({ width: W, height: H, data }, engine)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.mrz.fields.passportNumber).toBe('X1234567')
    // ⛔ ON THE FIRST CALL, FROM THE LOCATED BAND. The fixed bottom-30% band cannot contain this MRZ,
    // so leading with it would be four wasted calls. One call means the locator both led AND was right.
    expect(seen).toHaveLength(1)
    expect(seen[0].top).toBeLessThan(0.70)
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

  it('⛔ THE NAME SURVIVES A SHORT LINE 1 — the on-device failure of 2026-09-04', async () => {
    // The owner's phone, verbatim from the on-screen trace: every variant read line 1 CORRECTLY at 36
    // characters (the engine stops at the last glyph and never emits the trailing filler). 36 is under
    // extractMrzLines' 42-character floor, so no direct pair was found, the capture fused, and a fused
    // MRZ is name-less by design — Surname and Given names came up EMPTY on screen while the name sat
    // in the pool unread. The MRZ must fill in every field it actually read.
    const short1 = 'P<TKMBABAKULYYEV<<SHANAZARK<<<<<<<<<'
    const line2 = 'A1944134<6TKM9407152M2708300LB00014670<<<<40'
    expect(short1.length).toBeLessThan(TD3_LINE_LENGTH - 2) // the premise: too short to pair
    const r = await readMrz({ width: 1841, height: 1417 }, engineReturning(`${short1}\n${line2}`))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.variantIndex).toBe(-1)                    // fused, so mrz.fields carries no name…
      expect(r.mrz.fields.surname).toBeUndefined()
      expect(namesFromNameLine(r.pool.nameLine)).toEqual({ surname: 'BABAKULYYEV', givenNames: 'SHANAZARK' })
    }
  })

  it('⛔ ONE MISREAD CHARACTER MUST NOT COST THE NAME — the 2026-09-04 on-device failure', async () => {
    // Verbatim from the owner's phone: the SAME line 1, read once with the document code as `P` and
    // once as `B`. The old code accepted a name line only when it started with `P`, so a capture whose
    // best line-1 read flipped that single glyph produced no name line, the fused MRZ is name-less by
    // design, and Surname/Given names came up EMPTY on a scan the user was told had succeeded —
    // number and expiry filled, name blank. What identifies TD3 line 1 is the `<<`, not its first byte.
    const line2 = 'A1944134<6TKM9407152M2708300LB00014670<<<<40'
    const misread = [
      `B<TKMBABAKULYYEV<<SHANAZARK<<<<<<<<<\n${line2}`,
      `B<TKMBABAKULYYEV<<SHANAZARK<K<<<<<<S6666688885\n${line2}`,
    ]
    const pool = extractMrzFields(misread)
    expect(pool.nameLine).toBeDefined()
    expect(namesFromNameLine(pool.nameLine)).toEqual({ surname: 'BABAKULYYEV', givenNames: 'SHANAZARK' })
    // ⚠️ …but the issuing state is NOT trusted off a line whose first character was misread.
    expect(pool.nationality).toBeUndefined()

    // End to end: the read still fuses, and the name is now recoverable from the pool.
    const r = await readMrz({ width: 1200, height: 850 }, engineReturning(...misread))
    expect(r.ok).toBe(true)
    if (r.ok) expect(namesFromNameLine(r.pool.nameLine).surname).toBe('BABAKULYYEV')
  })

  it('namesFromNameLine takes only the first `<<` group as given names', () => {
    // TD3 uses `<<` once; everything after the given names is filler, and OCR misreads land in it.
    expect(namesFromNameLine('P<NLDDE<VRIES<<SOPHIE<ANNA<<<<<<<<<<<<<<<<<<'))
      .toEqual({ surname: 'DE VRIES', givenNames: 'SOPHIE ANNA' })
    expect(namesFromNameLine(undefined)).toEqual({})
    expect(namesFromNameLine('A1944134<6TKM9407152M2708300LB00014670<<<<40')).toEqual({}) // not a line 1
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

describe('mononym holders', () => {
  // ⛔ A HOLDER WITH ONE NAME IS NOT A MALFORMED SCAN. Requiring a letter after the `<<` separator
  // treated every mononym line as junk and returned no name at all — for a passport that had been
  // read perfectly. This is ordinary across Indonesia and much of the region eno serves, and it is
  // the same failure shape as the misread document code: one over-tight character rule silently
  // costing the holder their own name.
  it('reads a surname when there are no given names', () => {
    expect(namesFromNameLine('P<IDNSUHARTO<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<')).toEqual({
      surname: 'SUHARTO',
    })
  })

  it('still refuses a line 2 masquerading as a name line', () => {
    expect(namesFromNameLine('X1234567<7NLD8802141F3007310<<<<<<<<<<<<<<00')).toEqual({})
  })
})

describe('misread filler in the given names', () => {
  // ⛔ MEASURED ON THE OWNER'S OWN PASSPORT, 2026-09-04, through the real pipeline. The trailing
  // filler came back as `SS<SCCCES6088S98`, and splitting on `<<` and keeping all of group 1 swept
  // every bit of it into the given names: `SHANAZAR` was pre-filled as
  // `SHANAZARSS SCCCES6088S98`.
  const mangled = 'ZTMBABAKULYYEV<<SHANAZARSS<SCCCES6088S98<<<<'

  it('pre-fills no surname when the prefix is the wrong length', () => {
    // `P<TKM` → `ZTM` shifts the offset, so `slice(5)` returns `BAKULYYEV` for `BABAKULYYEV`. A
    // truncated surname is indistinguishable from a real one — refuse rather than hand one over.
    expect(namesFromNameLine(mangled).surname).toBeUndefined()
  })

  it('still fills the surname when only the DOCUMENT CODE was misread', () => {
    // ⛔ THE OTHER MISREAD OF THE SAME PASSPORT, and the two must not be conflated. `P` read as `B`
    // leaves the prefix five characters wide, so the offset is still right and the name is still
    // good — this is the case fixed earlier today and it must keep working. The `<` at index 1 is
    // what says "five characters", independent of what the first one was read as.
    expect(namesFromNameLine('B<TKMBABAKULYYEV<<SHANAZARK<<<<<<<<<<<<<<<<<').surname)
      .toBe('BABAKULYYEV')
  })

  it('refuses a prefix that simply lost its filler', () => {
    // ⛔ `P<TKM` → `PTKM` is one dropped character and slices to `ABAKULYYEV`. Admitting two-letter
    // document codes (`PD`/`PO`/`PS`) would also admit this, so that convenience was dropped: those
    // holders retype one field rather than anyone receiving a silently shortened surname.
    expect(namesFromNameLine('PTKMBABAKULYYEV<<SHANAZAR<<<<<<<<<<<<<<<<<<<').surname)
      .toBeUndefined()
  })

  it('pre-fills nothing when the field carries a digit', () => {
    // An empty box the seller fills beats any value derived from a read this bad.
    expect(namesFromNameLine(mangled).givenNames).toBeUndefined()
  })

  // ⛔ AND DROPPING JUST THE BAD TOKEN IS WORSE, which is why the rule refuses the whole field.
  // `S0PHIE<ANNA` is the commonest OCR swap; dropping that token pre-fills `ANNA` — a plausible name
  // missing the seller's first name, which they may confirm without noticing. Nothing is safer.
  it('does not silently drop a misread first name', () => {
    expect(namesFromNameLine('P<NLDDE<VRIES<<S0PHIE<ANNA<<<<<<<<<<<<<<<<<<').givenNames)
      .toBeUndefined()
  })

  // ⚠️ AND "STOP AT THE FIRST `<`" IS THE WRONG FIX, which is why the rule is about digits. TD3
  // separates MULTIPLE given names with a SINGLE `<`, so that would silently drop every middle name.
  it('keeps multiple given names', () => {
    expect(namesFromNameLine('P<NLDDE<VRIES<<SOPHIE<ANNA<<<<<<<<<<<<<<<<<<'))
      .toEqual({ surname: 'DE VRIES', givenNames: 'SOPHIE ANNA' })
  })

  // ⛔ WHAT THIS DOES NOT FIX, recorded so nobody mistakes it for solved: purely ALPHABETIC misread
  // filler is indistinguishable from a name. `SS` here, and the `K` the owner reported
  // (`SHANAZAR` read as `SHANAZARK`), both survive — a name may legitimately end in either. Line 1
  // carries no check digit, so there is no oracle; the seller confirms this field, and the real fix
  // is cross-reading the printed name on the data page.
  it('cannot remove alphabetic filler, and does not pretend to', () => {
    expect(namesFromNameLine('P<TKMBABAKULYYEV<<SHANAZARK<<<<<<<<<<<<<<<<<').givenNames)
      .toBe('SHANAZARK')
  })

  it('leaves a clean read completely alone', () => {
    expect(namesFromNameLine('P<NLDDE<VRIES<<SOPHIE<ANNA<<<<<<<<<<<<<<<<<<'))
      .toEqual({ surname: 'DE VRIES', givenNames: 'SOPHIE ANNA' })
  })
})
