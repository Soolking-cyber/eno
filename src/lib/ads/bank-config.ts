import 'server-only'
import crypto from 'crypto'
import { buildVietQrPayload } from '@/lib/payments/vietqr'
import { VN_BANKS } from '@/lib/payments/vn-banks'
import { qrSvg } from '@/lib/qr-svg'

/**
 * ── eno's RECEIVING ACCOUNT FOR ADS PAID BY BANK TRANSFER, AND THE CODE A PAYER SCANS (bank.ts). Light on purpose: the
 * offer (offer.ts) reads bankConfig() to say whether bank transfer is on sale without loading the order code.
 * ⛔ SERVER ENV ONLY, NEVER NEXT_PUBLIC: ADS_BANK_BIN (the NAPAS BIN, default 970416 = ACB), ADS_BANK_ACCOUNT,
 *   ADS_BANK_ACCOUNT_NAME. Any part missing or malformed → null: nothing is sold, no order is made.
 * ⛔ THE QR IS BUILT HERE, NEVER BY A THIRD-PARTY IMAGE SERVICE (vietqr.ts's own rule): the EMVCo / NAPAS 247 payload
 *   (GUID A000000727, the BIN and the account, service QRIBFTTA, the amount in đồng, the reference as tag 62.08, CRC16-
 *   CCITT) from vietqr.ts buildVietQrPayload, drawn as inline SVG by qr-svg.ts — the footer app QR's renderer.
 */
const REF_PREFIX = 'ENOAD'
/** Uppercase base32 without the look-alikes O/0 and I/1: 24 letters and 2–9, 32 symbols — so `byte & 31` is uniform. */
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const REF_CHARS = 6
export const AD_REFERENCE_RE = /^ENOAD [A-HJ-NP-Z2-9]{6}$/

export type BankConfig = { bin: string; bankName: string; account: string; accountName: string }

/** eno's receiving account, from the server env; null (nothing is sold) when any part is missing or malformed. */
export function bankConfig(env: NodeJS.ProcessEnv = process.env): BankConfig | null {
  const bin = (env.ADS_BANK_BIN || '970416').trim()
  const bank = VN_BANKS.find((b) => b.bin === bin)
  const account = (env.ADS_BANK_ACCOUNT || '').trim()
  const accountName = (env.ADS_BANK_ACCOUNT_NAME || '').trim().replace(/\s+/g, ' ')
  // The same account shape the VietQR builder accepts (vietqr.ts vietqrTargetFrom): a QR it would refuse is never offered.
  if (!bank || !/^\d{4,19}$/.test(account) || accountName.length < 2 || accountName.length > 70) return null
  return { bin, bankName: bank.short, account, accountName }
}

/** A fresh reference, e.g. "ENOAD 7K3F9Q": ASCII only (banks strip marks), 12 characters (a memo keeps 25). */
export function newAdReference(): string {
  const bytes = crypto.randomBytes(REF_CHARS)
  let out = ''
  for (const b of bytes) out += REF_ALPHABET[b & 31]
  return `${REF_PREFIX} ${out}`
}

/** The VietQR payload (EMVCo / NAPAS 247, built locally — vietqr.ts) and its SVG (qr-svg.ts), or null when it cannot be
 *  built (which bankConfig's checks rule out). */
export function bankQr(cfg: BankConfig, amountVnd: number, reference: string): { payload: string; svg: string } | null {
  const built = buildVietQrPayload({ target: { bankBin: cfg.bin, accountNo: cfg.account }, amountVnd, memo: reference })
  if (!built.ok) return null
  const svg = qrSvg(built.payload, { size: 220, decorative: true })
  return svg ? { payload: built.payload, svg } : null
}

