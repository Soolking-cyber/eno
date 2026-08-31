/**
 * VIETQR — the way Vietnam actually pays.
 *
 * Owner, 2026-08-31: *"vietnam is the place users will pay with qr"*. A VietQR code is a NAPAS 247
 * bank transfer rendered as an EMVCo QR: the buyer scans it in their own banking app, which
 * pre-fills our account, the amount and a memo, and they confirm. It is FIAT — an ordinary domestic
 * bank transfer — which is why it is the rail for Vietnamese buyers while the stablecoin rail is
 * not. See payments/eligibility.ts: Vietnam's DTI Law legalised holding and trading digital assets
 * and not paying with them, so the country that cannot use the wallet is precisely the one this
 * exists for.
 *
 * ⛔ PURE STRING BUILDING, NO NETWORK, NO IMAGE SERVICE. There are hosted generators
 * (img.vietqr.io and friends) that will render this from account details over HTTP; using one would
 * post a seller's bank account and every order amount to a third party on every checkout, and make
 * a payment page depend on someone else's uptime. The payload is a few hundred bytes of TLV — we
 * build it here and render it client-side with the `qrcode-generator` already in the tree.
 *
 * ⚠️ EVERY FIELD IS "TAG, TWO-DIGIT LENGTH, VALUE" (EMVCo TLV), and the length is in CHARACTERS of
 * the value. A wrong length does not throw — it silently shifts the parse of everything after it,
 * so a bank app shows a plausible QR that pays the wrong account. That is why `tlv()` computes the
 * length and nothing may hand-write one.
 */

/** NAPAS's application identifier inside tag 38. */
const NAPAS_AID = 'A000000727'
/** "QR IBFT to Account" — a transfer to an account number, as opposed to a card. */
const SERVICE_TRANSFER_TO_ACCOUNT = 'QRIBFTTA'
/** ISO 4217 for the Vietnamese dong. */
const VND = '704'

export type VietQrTarget = {
  /** The 6-digit NAPAS acquirer BIN of the beneficiary bank (e.g. 970415 = VietinBank). */
  bankBin: string
  /** The beneficiary account number at that bank. */
  accountNo: string
}

/**
 * ⛔ THE ONE PLACE THE DATABASE'S FIELD NAMES MEET THIS MODULE'S. `SellerPayout` calls it
 * `bankAccountNo`; a NAPAS target calls it `accountNo`. A reviewer found the seam before any caller
 * existed to fall into it — passing a payout row straight to the builder would have produced
 * `undefined` for the account and, before the coercion above, a `TypeError` from a function that
 * promises never to throw.
 * ⚠️ IT RETURNS null RATHER THAN A HALF-BUILT TARGET, so "this seller cannot be paid by QR" is one
 * answer with one shape, and matches `vietqrPayoutReady` in eligibility.ts by construction.
 */
export function vietqrTargetFrom(payout: {
  bankBin?: string | null
  bankAccountNo?: string | null
} | null | undefined): VietQrTarget | null {
  const bankBin = (payout?.bankBin ?? '').trim()
  const accountNo = (payout?.bankAccountNo ?? '').trim()
  /**
   * ⛔ THE SAME SHAPES `vietqrPayoutReady` REQUIRES, not merely "non-empty". The docstring claimed
   * the two matched "by construction" while this checked presence and that one checked format — so
   * a seller with a five-digit BIN was targetable here and unpayable there. A reviewer read both
   * functions rather than the sentence connecting them. Duplicating the regexes is the lesser evil:
   * importing eligibility.ts here would make a pure string module depend on the edition flag.
   */
  if (!/^\d{6}$/.test(bankBin) || !/^\d{4,19}$/.test(accountNo)) return null
  return { bankBin, accountNo }
}

export type VietQrRequest = {
  target: VietQrTarget
  /**
   * ⚠️ WHOLE DONG, AND THAT IS ALSO THE MINOR UNIT. VND has no subdivision in practice, so unlike
   * USDC there is no scaling here — the number in the QR is the number the buyer sees. Passing a
   * USDC-style base-unit amount would ask for a million times too much.
   */
  amountVnd: number
  /**
   * The transfer memo. ⛔ THIS IS HOW THE PAYMENT IS MATCHED TO THE ORDER — SePay reads it off the
   * bank statement — so it must survive a banking app unchanged. See `sanitiseMemo`.
   */
  memo: string
}

/** One EMVCo data object: two-digit tag, two-digit length, value. */
function tlv(tag: string, value: string): string {
  if (value.length > 99) throw new Error(`vietqr: value for tag ${tag} exceeds 99 chars`)
  return `${tag}${String(value.length).padStart(2, '0')}${value}`
}

/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no input or output reflection, no
 * final XOR — computed over the whole payload INCLUDING the `6304` that introduces the checksum.
 *
 * ⚠️ VERIFIED AGAINST A REAL VIETQR CODE, not against itself. Every one of those parameters has a
 * plausible wrong alternative (0x0000 init, reflected input, excluding `6304`), each of which
 * produces a confident four-character answer that no bank will accept. The vector is in the test.
 */
export function crc16ccitt(input: string): string {
  let crc = 0xffff
  /**
   * ⛔ `TextEncoder`, NOT `Buffer` — THIS MODULE'S OWN DOCSTRING SAYS IT RENDERS CLIENT-SIDE, and
   * `Buffer` is Node-only. A reviewer spotted the contradiction: the first version would have thrown
   * `ReferenceError: Buffer is not defined` the moment a checkout tried to draw the QR in a browser.
   * `TextEncoder` is universal and does the same UTF-8 encoding, so the CRC is identical on both
   * sides — which matters, because a server that computed a different checksum from the client would
   * produce codes that verify in tests and fail in banking apps.
   */
  for (const byte of new TextEncoder().encode(input)) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * ⛔ THE MEMO IS THE ONLY LINK BETWEEN A BANK TRANSFER AND AN ORDER, so it is stripped to what a
 * Vietnamese banking app will carry unchanged: ASCII letters, digits and spaces. Diacritics are
 * removed rather than rejected — `Đơn hàng` becomes `Don hang` — because a bank that transliterates
 * or drops them would break the match silently, and a memo nobody can match is money that arrives
 * with no order attached.
 * ⚠️ UPPERCASED, because several banks display and export memos uppercased; matching is then
 * case-independent by construction rather than by remembering to lowercase on the other side.
 */
export function sanitiseMemo(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/đ/g, 'd').replace(/Đ/g, 'D') // NFD does not decompose these
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 25)
}

export type VietQrError = 'bad_bank_bin' | 'bad_account' | 'bad_amount' | 'bad_memo'

/**
 * Build the payload a banking app scans.
 *
 * ⚠️ RETURNS A RESULT RATHER THAN THROWING for the same reason the wallet adapter does: this is
 * called while rendering a checkout, and bad seller bank details are a data problem to show, not an
 * exception to swallow somewhere up the tree.
 */
export function buildVietQrPayload(
  req: VietQrRequest,
): { ok: true; payload: string; memo: string } | { ok: false; reason: VietQrError } {
  /**
   * ⛔ COERCED, NOT ASSUMED. The docstring above promises a Result rather than a throw, and the
   * first version called `.trim()` straight on the fields — so a caller passing a partial object
   * (or, as a reviewer found, a `SellerPayout` row whose field is `bankAccountNo` rather than
   * `accountNo`) got a `TypeError` from the function that exists not to throw. The mismatch is
   * fixed properly by `vietqrTargetFrom` below; this is the belt that means getting it wrong
   * anywhere else is a refusal instead of a crash.
   * ⚠️ THE OPTIONAL CHAIN STARTS AT `req`, not at `req.target`. A reviewer noticed the guard stopped
   * one level short: a nullish REQUEST still threw on `null.target`, from a render.
   */
  const bin = String(req?.target?.bankBin ?? '').trim()
  // ⛔ EXACTLY SIX DIGITS. A NAPAS acquirer BIN is fixed-width; anything else shifts the TLV parse
  // of tag 38 and produces a QR that points somewhere unintended.
  if (!/^\d{6}$/.test(bin)) return { ok: false, reason: 'bad_bank_bin' }

  const account = String(req?.target?.accountNo ?? '').trim()
  if (!/^\d{4,19}$/.test(account)) return { ok: false, reason: 'bad_account' }

  /**
   * ⛔ A WHOLE, POSITIVE NUMBER OF DONG. A float would render as `120000.5` and be rejected or, far
   * worse, truncated by the receiving app; zero and negatives are not payments. The ceiling is
   * EMVCo's 13-character field, which is far above any plausible marketplace order.
   */
  if (!Number.isSafeInteger(req?.amountVnd) || req.amountVnd <= 0) return { ok: false, reason: 'bad_amount' }
  const amount = String(req.amountVnd)
  if (amount.length > 13) return { ok: false, reason: 'bad_amount' }

  const memo = sanitiseMemo(String(req?.memo ?? ''))
  /**
   * ⛔ A MEMO SHORT ENOUGH TO COLLIDE IS UNMATCHABLE MONEY. Empty was refused from the start; a
   * reviewer pointed out that `"A"` or `"PAYMENT"` passed just as happily, and two buyers sending
   * "PAYMENT" on the same day cannot be told apart on a bank statement. Four characters is not a
   * guarantee of uniqueness — that is the caller's job, and `buildVietQrPayload` RETURNS the
   * sanitised memo precisely so the caller stores the exact string to reconcile against rather
   * than re-deriving it. It is a floor under the obviously-hopeless case.
   * ⚠️ AND PUT THE REFERENCE FIRST. `sanitiseMemo` truncates at 25 characters because banks do, so
   * a reference placed after a description would be the part that disappears.
   */
  if (memo.replace(/ /g, '').length < 4) return { ok: false, reason: 'bad_memo' }

  const beneficiary = tlv('00', bin) + tlv('01', account)
  const merchantAccount =
    tlv('00', NAPAS_AID) + tlv('01', beneficiary) + tlv('02', SERVICE_TRANSFER_TO_ACCOUNT)

  const body =
    tlv('00', '01') +
    /**
     * ⚠️ `12` — DYNAMIC, NOT `11`. A static code is a reusable "pay me anything" poster; this one
     * carries an amount and an order reference and is good for exactly one payment. Real-world
     * samples do exist with `11` and an amount, which banks tolerate, but a single-use code
     * describing itself as reusable is the sort of thing a stricter app is right to reject.
     */
    tlv('01', '12') +
    tlv('38', merchantAccount) +
    tlv('53', VND) +
    tlv('54', amount) +
    tlv('58', 'VN') +
    tlv('62', tlv('08', memo))

  const withCrcTag = `${body}6304`
  return { ok: true, payload: withCrcTag + crc16ccitt(withCrcTag), memo }
}

/**
 * Parse a payload back into its top-level data objects.
 *
 * ⚠️ EXISTS FOR THE TESTS, AND EARNS ITS PLACE THERE. Asserting on a 150-character string compares
 * the builder to a transcription of itself; asserting that tag 54 holds the amount and tag 38
 * contains the account number checks the thing a bank will actually read.
 */
export function parseEmvTlv(payload: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let i = 0
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2)
    const len = Number(payload.slice(i + 2, i + 4))
    if (!Number.isInteger(len) || i + 4 + len > payload.length) break
    out.push([tag, payload.slice(i + 4, i + 4 + len)])
    i += 4 + len
  }
  return out
}

/**
 * ⛔ AN ORDERED LIST, NOT AN OBJECT, AND THAT IS NOT A STYLE CHOICE. TLV is positional and EMVCo
 * requires the payload format indicator first and the CRC last — but a JS object reorders keys that
 * look like integers, so `{'00':…, '38':…}` enumerates as 38, 53, 54, … then 00, 01. The
 * round-trip test caught it immediately; a reader that trusted the object's order to re-serialise
 * would have produced a payload no bank could read, and nothing about the code would have looked
 * wrong. `emvRecord` exists for LOOKUP, where order does not matter.
 */
export function emvRecord(payload: string): Record<string, string> {
  return Object.fromEntries(parseEmvTlv(payload))
}

/** ⚠️ A payload is only valid if its own checksum agrees — used by the tests and any future reader. */
export function verifyVietQrPayload(payload: string): boolean {
  if (payload.length < 8) return false
  const body = payload.slice(0, -4)
  if (!body.endsWith('6304')) return false
  return crc16ccitt(body) === payload.slice(-4).toUpperCase()
}
