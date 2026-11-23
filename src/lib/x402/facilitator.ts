import 'server-only'
import { cdpJwt } from './cdp-jwt'
import type { X402Config } from './config'
import type { PaymentPayload, PaymentRequirements, SettlementResponse } from './wire'
import { X402_VERSION } from './wire'

/**
 * ── The facilitator calls (x402 v2 §7; the same request the reference HTTPFacilitatorClient sends:
 * github.com/coinbase/x402 typescript/packages/core/src/http/httpFacilitatorClient.ts). Body:
 * { x402Version, paymentPayload, paymentRequirements }. ⛔ `paymentRequirements` is ALWAYS eno's own offer, never the
 * buyer's `accepted` copy (wire.ts checkPayload has already required them equal).
 *
 * Outcomes are explicit so the caller can tell "the facilitator said no" (nothing moved) from "we could not hear the
 * answer" (money MAY have moved: the caller must not show the ad and must not forget the payment either).
 */
export type VerifyOutcome = { kind: 'valid'; payer: string } | { kind: 'invalid'; reason: string } | { kind: 'error'; detail: string }
export type SettleOutcome =
  | { kind: 'settled'; response: SettlementResponse }
  | { kind: 'refused'; reason: string; response: SettlementResponse | null }
  | { kind: 'unknown'; detail: string }

const TIMEOUT_MS = 30_000

async function call(cfg: X402Config, op: 'verify' | 'settle', body: unknown, fetchImpl: typeof fetch): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const url = new URL(`${cfg.facilitatorUrl}/${op}`)
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  if (cfg.cdp) headers.authorization = `Bearer ${cdpJwt({ ...cfg.cdp, method: 'POST', host: url.host, path: url.pathname })}`
  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  let json: Record<string, unknown> | null = null
  try {
    const parsed: unknown = await res.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
  } catch {
    json = null
  }
  return { status: res.status, json }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export async function facilitatorVerify(cfg: X402Config, payload: PaymentPayload, ours: PaymentRequirements, fetchImpl: typeof fetch = fetch): Promise<VerifyOutcome> {
  try {
    const { status, json } = await call(cfg, 'verify', { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: ours }, fetchImpl)
    if (json && json.isValid === true) return { kind: 'valid', payer: str(json.payer) || payload.payload.authorization.from }
    if (json && json.isValid === false) return { kind: 'invalid', reason: str(json.invalidReason) || 'invalid_payload' }
    return { kind: 'error', detail: `verify answered ${status}` }
  } catch (e) {
    return { kind: 'error', detail: e instanceof Error ? e.name : 'verify_failed' }
  }
}

export async function facilitatorSettle(cfg: X402Config, payload: PaymentPayload, ours: PaymentRequirements, fetchImpl: typeof fetch = fetch): Promise<SettleOutcome> {
  let status = 0
  let json: Record<string, unknown> | null = null
  try {
    ;({ status, json } = await call(cfg, 'settle', { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: ours }, fetchImpl))
  } catch (e) {
    // A timeout or a dropped connection AFTER the request left: the transfer may have been broadcast.
    return { kind: 'unknown', detail: e instanceof Error ? e.name : 'settle_failed' }
  }
  if (json && typeof json.success === 'boolean') {
    const response: SettlementResponse = {
      success: json.success,
      ...(str(json.errorReason) ? { errorReason: str(json.errorReason) } : {}),
      ...(str(json.payer) ? { payer: str(json.payer) } : {}),
      transaction: str(json.transaction),
      network: str(json.network) || ours.network,
      ...(str(json.amount) ? { amount: str(json.amount) } : {}),
    }
    if (response.success && /^0x[0-9a-fA-F]{64}$/.test(response.transaction)) return { kind: 'settled', response }
    // settlement_pending carries a broadcast hash: money is on its way, not refused.
    if (response.errorReason === 'settlement_pending') return { kind: 'unknown', detail: `pending ${response.transaction}` }
    if (!response.success) return { kind: 'refused', reason: response.errorReason || 'settle_refused', response }
    return { kind: 'unknown', detail: 'success without a transaction hash' }
  }
  // A 4xx without a settlement body was refused before anything was broadcast; a 5xx or an unreadable 2xx tells us
  // nothing about whether the transfer went out.
  if (status >= 400 && status < 500) return { kind: 'refused', reason: `settle answered ${status}`, response: null }
  return { kind: 'unknown', detail: `settle answered ${status}` }
}
