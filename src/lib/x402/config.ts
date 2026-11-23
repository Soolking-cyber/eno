import 'server-only'
import type { PaymentRequirements } from './wire'

/**
 * ── Where x402 payments go and through whom (server env only; nothing here reaches a browser).
 *
 *   X402_PAY_TO           the wallet that receives the USDC (the owner's, on the network below). ⛔ UNSET = NOTHING IS SOLD:
 *                         every paid route answers 503 and the MCP tool refuses — fail closed, never a default address.
 *   X402_NETWORK          CAIP-2: eip155:8453 Base (default) or eip155:84532 Base Sepolia (test).
 *   X402_FACILITATOR_URL  default Coinbase CDP (https://api.cdp.coinbase.com/platform/v2/x402), which also lists the offer
 *                         in the x402 Bazaar after its first settlement; https://x402.org/facilitator is testnet-only.
 *   CDP_API_KEY_ID / CDP_API_KEY_SECRET   the CDP API key (cdp-jwt.ts); required when the facilitator is CDP.
 *   X402_AD_PRICE_ATOMIC  the ad's price in USDC atomic units (6 decimals). Default 3760000 = 3.76 USDC, the owner's
 *                         99.000 đ (2026-11-23) at about 26.300 đ to the dollar; change it here, not in code.
 */
export const CDP_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402'

/** USDC per network: contract and EIP-712 domain (x402 docs, network-and-token-support; both version "2"). */
const USDC: Record<string, { asset: string; name: string; version: string; label: string }> = {
  'eip155:8453': { asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2', label: 'Base' },
  'eip155:84532': { asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2', label: 'Base Sepolia' },
}

export const AD_DAYS = 7
/** The owner's price in đồng (2026-11-23), shown beside the USDC figure. */
export const AD_PRICE_VND = 99_000
const DEFAULT_AD_PRICE_ATOMIC = '3760000'

export type X402Config = {
  network: string
  networkLabel: string
  payTo: string
  facilitatorUrl: string
  cdp: { keyId: string; secret: string } | null
  adPriceAtomic: string
  asset: string
  extra: { name: string; version: string }
}

/** Null = not configured, so nothing is for sale. Read per call (tests and a re-deployed env both see the change). */
export function x402Config(env: NodeJS.ProcessEnv = process.env): X402Config | null {
  const payTo = (env.X402_PAY_TO || '').trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) return null
  const network = (env.X402_NETWORK || 'eip155:8453').trim()
  const token = USDC[network]
  if (!token) return null
  const facilitatorUrl = (env.X402_FACILITATOR_URL || CDP_FACILITATOR_URL).trim().replace(/\/+$/, '')
  const keyId = (env.CDP_API_KEY_ID || '').trim()
  const secret = (env.CDP_API_KEY_SECRET || '').trim()
  const isCdp = new URL(facilitatorUrl).host === 'api.cdp.coinbase.com'
  if (isCdp && (!keyId || !secret)) return null
  const price = (env.X402_AD_PRICE_ATOMIC || DEFAULT_AD_PRICE_ATOMIC).trim()
  if (!/^[1-9]\d{0,12}$/.test(price)) return null
  return {
    network,
    networkLabel: token.label,
    payTo,
    facilitatorUrl,
    cdp: isCdp ? { keyId, secret } : null,
    adPriceAtomic: price,
    asset: token.asset,
    extra: { name: token.name, version: token.version },
  }
}

/** USDC atomic → "3.76". */
export function usdcText(atomic: string): string {
  const n = BigInt(atomic)
  const unit = BigInt(1_000_000)
  const whole = n / unit
  const frac = (n % unit).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac.length < 2 ? frac.padEnd(2, '0') : frac}` : `${whole}`
}

/** The one offer an ad is sold at. maxTimeoutSeconds bounds how long a signed authorization may wait for settlement. */
export function adRequirements(cfg: X402Config): PaymentRequirements {
  return {
    scheme: 'exact',
    network: cfg.network,
    amount: cfg.adPriceAtomic,
    asset: cfg.asset,
    payTo: cfg.payTo,
    maxTimeoutSeconds: 300,
    extra: cfg.extra,
  }
}
