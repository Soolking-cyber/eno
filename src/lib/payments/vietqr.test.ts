import { describe, expect, it, vi } from 'vitest'
import {
  buildVietQrPayload, crc16ccitt, emvRecord, parseEmvTlv, sanitiseMemo, verifyVietQrPayload,
  vietqrTargetFrom,
} from './vietqr'

/**
 * A REAL VIETQR CODE, used as the reference for the checksum.
 *
 * ⛔ THE POINT OF A VECTOR IS THAT IT COMES FROM OUTSIDE. CRC-16 has several plausible-looking
 * parameter sets — a 0x0000 initial value, reflected input, computing over the payload WITHOUT the
 * trailing `6304` — and every one of them returns a confident four-character answer that no banking
 * app will accept. Checking the builder against itself would agree with all of them.
 *
 * Decoded: VietinBank (BIN 970415), account 0011001932418, 120,000 VND, memo "ung ho lu lut".
 */
const REAL_SAMPLE =
  '00020101021238570010A00000072701270006970415011300110019324180208QRIBFTTA530370454061200005802VN62170813ung ho lu lut6304C15C'

describe('crc16ccitt — checked against a code a bank actually accepted', () => {
  it('⛔ reproduces the real sample’s checksum', () => {
    expect(crc16ccitt(REAL_SAMPLE.slice(0, -4))).toBe('C15C')
  })

  it('⛔ is computed INCLUDING the 6304 that introduces it', () => {
    // Dropping those four characters is the most natural mistake and yields a different, confident
    // answer — so this pins the boundary rather than trusting the comment above it.
    expect(crc16ccitt(REAL_SAMPLE.slice(0, -8))).not.toBe('C15C')
  })

  it('⛔ uses a 0xFFFF initial value, not 0x0000', () => {
    // A zero-init CRC over the same bytes is a different value; if this ever equals C15C the
    // implementation has drifted to the wrong parameter set.
    const zeroInit = (s: string) => {
      let crc = 0
      for (const b of Buffer.from(s, 'utf8')) {
        crc ^= b << 8
        for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
      }
      return crc.toString(16).toUpperCase().padStart(4, '0')
    }
    expect(zeroInit(REAL_SAMPLE.slice(0, -4))).not.toBe('C15C')
  })

  it('⛔ works with NO `Buffer` at all — this module renders in a browser', () => {
    /**
     * ⛔ THE MODULE'S OWN DOCSTRING SAYS IT BUILDS THE PAYLOAD CLIENT-SIDE, and the first version
     * used `Buffer.from`, which is Node-only: the checkout would have thrown
     * `ReferenceError: Buffer is not defined` the moment it tried to draw a QR. A reviewer caught
     * the contradiction between the comment and the code.
     * ⚠️ jsdom STILL EXPOSES `Buffer` — it is Node underneath — so running under that environment
     * proves nothing. Removing the global is the only honest check, and it must also confirm the
     * SAME checksum: a server and a client that disagreed would produce codes that pass tests and
     * fail in banking apps.
     */
    vi.stubGlobal('Buffer', undefined)
    try {
      expect(crc16ccitt(REAL_SAMPLE.slice(0, -4))).toBe('C15C')
      const r = buildVietQrPayload({
        target: { bankBin: '970415', accountNo: '0011001932418' }, amountVnd: 250_000, memo: 'ENO 7X2K',
      })
      expect(r.ok).toBe(true)
      if (r.ok) expect(verifyVietQrPayload(r.payload)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('always four uppercase hex characters, zero-padded', () => {
    for (const s of ['', 'a', 'hello', REAL_SAMPLE]) expect(crc16ccitt(s)).toMatch(/^[0-9A-F]{4}$/)
  })
})

describe('the real sample decodes the way the builder assembles', () => {
  it('⛔ the FIRST object is the payload format indicator and the LAST is the CRC', () => {
    // EMVCo is positional. An ordered parse is the only way to assert this at all.
    const ordered = parseEmvTlv(REAL_SAMPLE)
    expect(ordered[0][0]).toBe('00')
    expect(ordered[ordered.length - 1][0]).toBe('63')
  })

  it('has the structure this module writes', () => {
    const top = emvRecord(REAL_SAMPLE)
    expect(top['53']).toBe('704') // VND
    expect(top['54']).toBe('120000')
    expect(top['58']).toBe('VN')

    const merchant = emvRecord(top['38'])
    expect(merchant['00']).toBe('A000000727') // NAPAS AID
    expect(merchant['02']).toBe('QRIBFTTA')
    const beneficiary = emvRecord(merchant['01'])
    expect(beneficiary['00']).toBe('970415') // VietinBank
    expect(beneficiary['01']).toBe('0011001932418')

    expect(emvRecord(top['62'])['08']).toBe('ung ho lu lut')
  })

  it('verifies its own checksum', () => {
    expect(verifyVietQrPayload(REAL_SAMPLE)).toBe(true)
    expect(verifyVietQrPayload(REAL_SAMPLE.slice(0, -1) + 'F')).toBe(false)
  })
})

const req = (over: Partial<Parameters<typeof buildVietQrPayload>[0]> = {}) => ({
  target: { bankBin: '970415', accountNo: '0011001932418' },
  amountVnd: 250_000,
  memo: 'ENO ORDER 7X2K',
  ...over,
})

describe('buildVietQrPayload', () => {
  it('produces a self-consistent payload a bank can parse', () => {
    const r = buildVietQrPayload(req())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(verifyVietQrPayload(r.payload)).toBe(true)

    const top = emvRecord(r.payload)
    expect(top['54']).toBe('250000')
    expect(top['53']).toBe('704')
    expect(top['58']).toBe('VN')
    expect(emvRecord(emvRecord(top['38'])['01'])['01']).toBe('0011001932418')
    expect(emvRecord(top['62'])['08']).toBe('ENO ORDER 7X2K')
  })

  it('⚠️ marks itself DYNAMIC — it carries an amount and is good for one payment', () => {
    const r = buildVietQrPayload(req())
    expect(r.ok && emvRecord(r.payload)['01']).toBe('12')
  })

  it('⛔ every TLV length matches its value, or the whole parse shifts', () => {
    // A wrong length does not throw — it silently re-frames everything after it, so a bank app
    // shows a plausible QR that pays the wrong account. A full round-trip is the only real check.
    const r = buildVietQrPayload(req({ target: { bankBin: '970415', accountNo: '1234567890' }, memo: 'AB12' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // ⚠️ THE ORDERED PARSE, NOT A RECORD. A JS object reorders integer-like keys, so re-serialising
    // `Object.entries` produced 38, 53, 54, … then 00, 01 — a payload no bank could read, from code
    // that looked correct. This test found it; that is why `parseEmvTlv` returns pairs.
    const rebuilt = parseEmvTlv(r.payload)
      .map(([t, v]) => `${t}${String(v.length).padStart(2, '0')}${v}`)
      .join('')
    expect(rebuilt).toBe(r.payload)
  })

  it('⛔ VND IS WHOLE DONG — no minor-unit scaling, unlike USDC', () => {
    // Passing a base-unit amount in the USDC style would ask for a million times too much.
    const r = buildVietQrPayload(req({ amountVnd: 120_000 }))
    expect(r.ok && emvRecord(r.payload)['54']).toBe('120000')
  })

  it('⛔ refuses a bank BIN that is not exactly six digits', () => {
    for (const bin of ['97041', '9704155', '97041a', '', ' 970415 x']) {
      expect(buildVietQrPayload(req({ target: { bankBin: bin, accountNo: '0011001932418' } })), bin)
        .toEqual({ ok: false, reason: 'bad_bank_bin' })
    }
  })

  it('⛔ refuses an account number that is not digits', () => {
    for (const acc of ['', '123', 'ABC123', '0011-0019-324']) {
      expect(buildVietQrPayload(req({ target: { bankBin: '970415', accountNo: acc } })), acc)
        .toEqual({ ok: false, reason: 'bad_account' })
    }
  })

  it('⛔ refuses a nonsense amount', () => {
    for (const amountVnd of [0, -1, 1.5, NaN, Infinity, 10 ** 14]) {
      expect(buildVietQrPayload(req({ amountVnd })), String(amountVnd))
        .toEqual({ ok: false, reason: 'bad_amount' })
    }
  })

  it('⛔ refuses to render a QR with no matchable memo', () => {
    // Money that arrives with nothing to attach it to is worse than a checkout that will not load.
    // ⚠️ `A` AND `AB C` ARE IN THIS LIST because two buyers sending "PAYMENT" on the same day
    // cannot be told apart on a bank statement. A floor under the hopeless case, not a uniqueness
    // guarantee — that is the caller's job, which is why the builder returns the memo it used.
    for (const memo of ['', '   ', '!!!', '—–—', 'A', 'A B C']) {
      expect(buildVietQrPayload(req({ memo })), JSON.stringify(memo))
        .toEqual({ ok: false, reason: 'bad_memo' })
    }
  })
})

describe('vietqrTargetFrom — the seam between the database and NAPAS', () => {
  it('⛔ maps `bankAccountNo` to `accountNo`, which nothing else should have to remember', () => {
    // A reviewer found the mismatch before any caller existed to fall into it: SellerPayout says
    // `bankAccountNo`, a NAPAS target says `accountNo`. Passing the row straight through gave
    // `undefined` for the account.
    expect(vietqrTargetFrom({ bankBin: '970415', bankAccountNo: '0011001932418' }))
      .toEqual({ bankBin: '970415', accountNo: '0011001932418' })
  })

  it('⛔ null rather than a half-built target when the seller cannot be paid', () => {
    // ⛔ THE MALFORMED SHAPES ARE HERE TOO. This checked presence while `vietqrPayoutReady` checked
    // FORMAT, so a five-digit BIN was targetable here and unpayable there — while a comment claimed
    // the two matched "by construction".
    for (const row of [null, undefined, {}, { bankBin: '970415' }, { bankAccountNo: '001' },
      { bankBin: ' ', bankAccountNo: ' ' }, { bankBin: '97041', bankAccountNo: '0011001932418' },
      { bankBin: '970415', bankAccountNo: '00-11' }]) {
      expect(vietqrTargetFrom(row), JSON.stringify(row)).toBeNull()
    }
  })

  it('⛔ and the builder REFUSES rather than throwing, however it is called', () => {
    // The contract is a Result. Before this, `.trim()` on a missing field threw a TypeError out of
    // the function that exists not to throw — from a checkout render.
    const bad = [
      undefined, // ⚠️ a nullish REQUEST — the guard used to start one level too deep
      null,
      { target: undefined, amountVnd: 1000, memo: 'XYZ1' },
      { target: {}, amountVnd: 1000, memo: 'X' },
      { target: { bankBin: '970415' }, amountVnd: 1000, memo: 'X' },
      { target: { bankBin: '970415', accountNo: '0011001932418' }, amountVnd: 1000, memo: undefined },
    ] as unknown as Array<Parameters<typeof buildVietQrPayload>[0]>
    for (const req of bad) {
      expect(() => buildVietQrPayload(req), JSON.stringify(req)).not.toThrow()
      expect(buildVietQrPayload(req).ok, JSON.stringify(req)).toBe(false)
    }
  })
})

describe('sanitiseMemo — the only link between a transfer and an order', () => {
  it('strips Vietnamese diacritics rather than rejecting them', () => {
    // A bank that transliterates or drops them would break the match silently.
    expect(sanitiseMemo('Đơn hàng số 42')).toBe('DON HANG SO 42')
    expect(sanitiseMemo('Thanh toán')).toBe('THANH TOAN')
  })

  it('⛔ uppercases, because several banks export memos uppercased', () => {
    // Matching is then case-independent by construction rather than by remembering to lowercase on
    // the other side.
    expect(sanitiseMemo('eno order 7x2k')).toBe('ENO ORDER 7X2K')
  })

  it('reduces punctuation and runs of whitespace to single spaces', () => {
    expect(sanitiseMemo('ENO/ORDER#7X2K')).toBe('ENO ORDER 7X2K')
    expect(sanitiseMemo('  ENO    7X2K  ')).toBe('ENO 7X2K')
  })

  it('⚠️ caps the length, because banks truncate long memos', () => {
    expect(sanitiseMemo('X'.repeat(80)).length).toBe(25)
  })

  it('an order reference survives it unchanged — the case that matters most', () => {
    // If the reference itself were mangled, every payment would need reconciling by hand.
    for (const ref of ['ENO7X2K', 'ENO 7X2K', 'ENOABC123']) expect(sanitiseMemo(ref)).toBe(ref.toUpperCase())
  })
})
