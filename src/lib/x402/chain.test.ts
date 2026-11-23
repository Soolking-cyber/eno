import { describe, expect, it, vi } from 'vitest'
import { keccak_256 } from '@noble/hashes/sha3.js'

/**
 * Reconciliation's chain reads (src/lib/x402/chain.ts) against a fake JSON-RPC: a payment is THIS authorization's own
 * AuthorizationUsed followed by its own Transfer to us — never "some matching Transfer somewhere in the receipt" (gate
 * review 2026-11-23: one transaction can carry several authorizations).
 */
vi.mock('server-only', () => ({}))
const { findAuthorizationPayment, authorizationUsed } = await import('./chain')

const topic = (s: string) => `0x${Buffer.from(keccak_256(new TextEncoder().encode(s))).toString('hex')}`
const USED = topic('AuthorizationUsed(address,bytes32)')
const TRANSFER = topic('Transfer(address,address,uint256)')
const pad = (a: string) => `0x${a.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`
const ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const PAY_TO = '0x209693Bc6afc0C5328bA36FaF03C514EF312287C'
const BUYER = '0x857b06519E91e3A54538791bDbb0E22373e36b66'
const N1 = `0x${'11'.repeat(32)}`
const N2 = `0x${'22'.repeat(32)}`
const cfg = { network: 'eip155:84532', asset: ASSET, payTo: PAY_TO }
const used = (nonce: string) => ({ address: ASSET, topics: [USED, pad(BUYER), nonce], data: '0x' })
const transfer = (to: string, amount: bigint) => ({ address: ASSET, topics: [TRANSFER, pad(BUYER), pad(to)], data: `0x${amount.toString(16)}` })

function rpc(receipt: { status: string; logs: unknown[] }, opts: { state?: boolean } = {}) {
  return (async (_u: unknown, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body))
    const result =
      method === 'eth_blockNumber' ? '0x100000'
      : method === 'eth_getLogs' ? ((params[0].topics[0] === USED) ? [{ transactionHash: '0xtx' }] : [])
      : method === 'eth_getTransactionReceipt' ? receipt
      : method === 'eth_call' ? `0x${(opts.state ? 1 : 0).toString(16).padStart(64, '0')}`
      : null
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
  }) as typeof fetch
}
const ask = (nonce: string, f: typeof fetch) => findAuthorizationPayment(cfg, { from: BUYER, nonce, amount: '3760000', since: new Date(), validBefore: Math.floor(Date.now() / 1000) + 300 }, f, {} as NodeJS.ProcessEnv)

describe('findAuthorizationPayment', () => {
  it('finds a payment: its own AuthorizationUsed, then its own Transfer to us of the amount', async () => {
    expect(await ask(N1, rpc({ status: '0x1', logs: [used(N1), transfer(PAY_TO, BigInt(3760000))] }))).toEqual({ found: true, txHash: '0xtx' })
  })

  it('⛔ one transaction, two authorizations: N2 spent to the buyer beside a real N1 payment is NOT a payment for N2', async () => {
    const multicall = { status: '0x1', logs: [used(N2), transfer(BUYER, BigInt(3760000)), used(N1), transfer(PAY_TO, BigInt(3760000))] }
    expect((await ask(N2, rpc(multicall))).found).toBe(false)
    expect((await ask(N1, rpc(multicall))).found).toBe(true)
  })

  it('a reverted transaction, a wrong amount or another token is not a payment', async () => {
    expect((await ask(N1, rpc({ status: '0x0', logs: [used(N1), transfer(PAY_TO, BigInt(3760000))] }))).found).toBe(false)
    expect((await ask(N1, rpc({ status: '0x1', logs: [used(N1), transfer(PAY_TO, BigInt(1))] }))).found).toBe(false)
    expect((await ask(N1, rpc({ status: '0x1', logs: [used(N1), { ...transfer(PAY_TO, BigInt(3760000)), address: '0x0000000000000000000000000000000000000001' }] }))).found).toBe(false)
  })
})

describe('authorizationUsed', () => {
  it('reads the contract\'s authorizationState for (from, nonce)', async () => {
    expect(await authorizationUsed(cfg, { from: BUYER, nonce: N1 }, rpc({ status: '0x1', logs: [] }, { state: true }), {} as NodeJS.ProcessEnv)).toBe(true)
    expect(await authorizationUsed(cfg, { from: BUYER, nonce: N1 }, rpc({ status: '0x1', logs: [] }, { state: false }), {} as NodeJS.ProcessEnv)).toBe(false)
  })
})
