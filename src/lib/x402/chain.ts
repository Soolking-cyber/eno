import 'server-only'
import { keccak_256 } from '@noble/hashes/sha3.js'
import type { X402Config } from './config'

/**
 * ── Read-only chain lookups for RECONCILIATION (codex plan review 2026-11-23: "money can settle without recoverable
 * fulfilment"). When a settlement answer is lost (timeout, crash, a DB write that failed after the facilitator said yes),
 * the row keeps the signed authorization, and this finds whether USDC consumed it: EIP-3009 emits
 * `AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)` from transferWithAuthorization only
 * (cancelAuthorization emits AuthorizationCanceled instead), so a log for (from, nonce) on the asset contract — in a
 * successful transaction that also moved exactly `amount` from `from` to `payTo` — is the payment.
 * Public JSON-RPC; X402_RPC_URL overrides. eth_getLogs covers the authorization's own window (row creation → validBefore,
 * Base: one block every 2 s), padded by 30 minutes either side.
 */
const DEFAULT_RPC: Record<string, string> = { 'eip155:8453': 'https://mainnet.base.org', 'eip155:84532': 'https://sepolia.base.org' }
const hexOf = (s: string) => `0x${Buffer.from(keccak_256(new TextEncoder().encode(s))).toString('hex')}`
const AUTHORIZATION_USED = hexOf('AuthorizationUsed(address,bytes32)')
const TRANSFER = hexOf('Transfer(address,address,uint256)')
const WINDOW = 2_000
const BLOCK_SECONDS = 2
const PAD_BLOCKS = 900

const pad32 = (addr: string) => `0x${addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`

async function rpc<T>(url: string, method: string, params: unknown[], fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  })
  const j = (await res.json()) as { result?: T; error?: { message?: string } }
  if (j.error || j.result === undefined) throw new Error(`rpc ${method}: ${j.error?.message ?? res.status}`)
  return j.result
}

export type ChainPayment = { found: true; txHash: string } | { found: false }

const AUTH_STATE_SELECTOR = hexOf('authorizationState(address,bytes32)').slice(0, 10)

/**
 * EIP-3009 `authorizationState(authorizer, nonce)`: true once that authorization was used OR cancelled — read from the
 * contract's own storage, so no log search or block estimate can miss it. FALSE past validBefore is the only proof that an
 * authorization never moved money and never will (gate review 2026-11-23: "a negative log lookup is not definitive").
 */
export async function authorizationUsed(
  cfg: Pick<X402Config, 'network' | 'asset'>,
  p: { from: string; nonce: string },
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const url = (env.X402_RPC_URL || DEFAULT_RPC[cfg.network] || '').trim()
  if (!url) throw new Error('no rpc for network')
  const data = `${AUTH_STATE_SELECTOR}${pad32(p.from).slice(2)}${p.nonce.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`
  const out = await rpc<string>(url, 'eth_call', [{ to: cfg.asset, data }, 'latest'], fetchImpl)
  if (!/^0x[0-9a-fA-F]{64}$/.test(out)) throw new Error('authorizationState: unexpected answer')
  return BigInt(out) !== BigInt(0)
}

export async function findAuthorizationPayment(
  cfg: Pick<X402Config, 'network' | 'asset' | 'payTo'>,
  p: { from: string; nonce: string; amount: string; since: Date; validBefore: number },
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChainPayment> {
  const url = (env.X402_RPC_URL || DEFAULT_RPC[cfg.network] || '').trim()
  if (!url) throw new Error('no rpc for network')
  const latest = parseInt(await rpc<string>(url, 'eth_blockNumber', [], fetchImpl), 16)
  // The transfer can only have happened between the row's creation and the authorization's validBefore (wire.ts keeps that
  // window to minutes): blocks are estimated from Base's fixed block time, padded either side, so a lookup works at any
  // later date and stays a few hundred blocks wide.
  const nowSec = Date.now() / 1000
  const blockAt = (sec: number) => Math.round(latest - (nowSec - sec) / BLOCK_SECONDS)
  const floor = Math.max(0, blockAt(p.since.getTime() / 1000) - PAD_BLOCKS)
  const ceil = Math.min(latest, blockAt(p.validBefore) + PAD_BLOCKS)
  for (let to = ceil; to >= floor; to -= WINDOW) {
    const from = Math.max(floor, to - WINDOW + 1)
    const logs = await rpc<{ transactionHash: string }[]>(url, 'eth_getLogs', [{
      address: cfg.asset,
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
      topics: [AUTHORIZATION_USED, pad32(p.from), p.nonce.toLowerCase()],
    }], fetchImpl)
    for (const log of logs) {
      if (await paidInTx(url, cfg, log.transactionHash, p, fetchImpl)) return { found: true, txHash: log.transactionHash }
    }
  }
  return { found: false }
}

/** The receipt succeeded and carries a Transfer(from → payTo, amount) of the asset. */
async function paidInTx(url: string, cfg: Pick<X402Config, 'asset' | 'payTo'>, txHash: string, p: { from: string; amount: string }, fetchImpl: typeof fetch): Promise<boolean> {
  const r = await rpc<{ status: string; logs: { address: string; topics: string[]; data: string }[] } | null>(url, 'eth_getTransactionReceipt', [txHash], fetchImpl)
  if (!r || r.status !== '0x1') return false
  return r.logs.some((l) =>
    l.address.toLowerCase() === cfg.asset.toLowerCase() &&
    l.topics[0] === TRANSFER &&
    l.topics[1]?.toLowerCase() === pad32(p.from) &&
    l.topics[2]?.toLowerCase() === pad32(cfg.payTo) &&
    BigInt(l.data) === BigInt(p.amount))
}
