/**
 * ── x402 v2 wire format (owner 2026-11-23: "build all regarding x402 … paid ad creation via mcp for ai agents … pay
 * through x402"). Types and the base64 header codec, no I/O. The objects follow the x402 v2 specification
 * (github.com/coinbase/x402 specs/x402-specification-v2.md §5) and its HTTP and MCP transports (specs/transports-v2):
 *   HTTP: 402 + `PAYMENT-REQUIRED` (base64 JSON PaymentRequired) → the client retries with `PAYMENT-SIGNATURE` (base64
 *         JSON PaymentPayload) → the answer carries `PAYMENT-RESPONSE` (base64 JSON SettlementResponse).
 *   MCP:  a tool result with isError and the PaymentRequired as structuredContent (and as content[0].text) → the client
 *         repeats tools/call with params._meta["x402/payment"] → the result carries _meta["x402/payment-response"].
 * ⛔ The scheme is `exact` on EVM (EIP-3009 transferWithAuthorization of USDC): the client signs, the facilitator
 * submits and pays the gas, eno never holds a key that can move anyone's money.
 */
import { z } from 'zod'

export const X402_VERSION = 2

export const HEADER_REQUIRED = 'PAYMENT-REQUIRED'
export const HEADER_SIGNATURE = 'PAYMENT-SIGNATURE'
export const HEADER_RESPONSE = 'PAYMENT-RESPONSE'
export const MCP_META_PAYMENT = 'x402/payment'
export const MCP_META_RESPONSE = 'x402/payment-response'

export type PaymentRequirements = {
  scheme: 'exact'
  /** CAIP-2, e.g. eip155:8453 (Base). */
  network: string
  /** Atomic units of `asset`, as a decimal string (USDC has 6 decimals: "3760000" = 3.76 USDC). */
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  /** exact/EVM: the token's EIP-712 domain name and version, which the client signs against. */
  extra: { name: string; version: string }
}

export type ResourceInfo = { url: string; description?: string; mimeType?: string; serviceName?: string; tags?: string[]; iconUrl?: string }

export type PaymentRequired = {
  x402Version: typeof X402_VERSION
  error?: string
  resource: ResourceInfo
  accepts: PaymentRequirements[]
  extensions?: Record<string, unknown>
}

export type SettlementResponse = {
  success: boolean
  errorReason?: string
  payer?: string
  transaction: string
  network: string
  amount?: string
}

const hex = (bytes?: number) => z.string().regex(bytes ? new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`) : /^0x[0-9a-fA-F]+$/)
const uintString = z.string().regex(/^\d{1,78}$/)
const address = hex(20)

/** What a buyer sends. Parsed strictly where eno reads it; `extensions` and `resource` pass through to the facilitator
 *  untouched (the Bazaar needs them on settle). Unknown keys are kept for the same reason. */
export const paymentPayloadSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  resource: z.object({ url: z.string() }).passthrough().optional(),
  accepted: z.object({
    scheme: z.string(),
    network: z.string(),
    amount: uintString,
    asset: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
  payload: z.object({
    signature: hex(),
    authorization: z.object({
      from: address,
      to: address,
      value: uintString,
      validAfter: uintString,
      validBefore: uintString,
      nonce: hex(32),
    }).passthrough(),
  }).passthrough(),
  extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

export type PaymentPayload = z.infer<typeof paymentPayloadSchema>

/** Standard base64 of the UTF-8 JSON, as the HTTP transport's examples show. */
export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

/** Reads standard or URL-safe base64, padded or not. Null when it is not base64 of a JSON value. Capped: a payment
 *  header is ~1 KB; anything past 16 KB is refused before decoding. */
export function decodeHeader(raw: string | null | undefined): unknown {
  const s = (raw ?? '').trim()
  if (!s || s.length > 16_384 || !/^[A-Za-z0-9+/_-]+=*$/.test(s)) return null
  try {
    return JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

export type PayloadCheck = { ok: true; payload: PaymentPayload } | { ok: false; reason: string }

/**
 * ⛔ THE BUYER'S `accepted` MUST BE OUR OFFER, FIELD FOR FIELD, and the signed authorization must pay exactly it. The
 * facilitator is also sent OUR requirements (never the buyer's copy), so a payload that names another amount, token,
 * network or recipient fails twice. Addresses compare case-insensitively (EIP-55 checksums differ only in case).
 */
export function checkPayload(raw: unknown, ours: PaymentRequirements, nowSec = Math.floor(Date.now() / 1000)): PayloadCheck {
  const parsed = paymentPayloadSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'invalid_payload' }
  const p = parsed.data
  const a = p.accepted
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()
  if (a.scheme !== ours.scheme) return { ok: false, reason: 'unsupported_scheme' }
  if (a.network !== ours.network) return { ok: false, reason: 'invalid_network' }
  if (!same(a.asset, ours.asset)) return { ok: false, reason: 'invalid_payment_requirements' }
  if (!same(a.payTo, ours.payTo)) return { ok: false, reason: 'invalid_exact_evm_payload_recipient_mismatch' }
  if (a.amount !== ours.amount) return { ok: false, reason: 'invalid_exact_evm_payload_authorization_value_mismatch' }
  const auth = p.payload.authorization
  if (!same(auth.to, ours.payTo)) return { ok: false, reason: 'invalid_exact_evm_payload_recipient_mismatch' }
  if (auth.value !== ours.amount) return { ok: false, reason: 'invalid_exact_evm_payload_authorization_value_mismatch' }
  // ⛔ A SHORT VALIDITY WINDOW (gate review 2026-11-23): the authorization must be usable now and expire within the offer's
  // maxTimeoutSeconds. A payment can then only ever settle inside [now, validBefore] — which is what lets reconciliation
  // search a few hundred blocks at any later date, and call a payment never seen by validBefore unpaid for good.
  if (Number(auth.validAfter) > nowSec + 5) return { ok: false, reason: 'invalid_exact_evm_payload_authorization_valid_after' }
  const before = Number(auth.validBefore)
  if (before < nowSec + 30 || before > nowSec + ours.maxTimeoutSeconds + 120) return { ok: false, reason: 'invalid_exact_evm_payload_authorization_valid_before' }
  return { ok: true, payload: p }
}
