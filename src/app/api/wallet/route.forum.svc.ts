import { z } from 'zod'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { walletGate, provisionWithinBudget, type ProvisionOutcome } from '@/lib/kyc/on-verified'
import { walletBalances, stagingFund, crossmintConfig } from '@/lib/payments/crossmint'
import { logWarn } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * THE SETTLEMENT WALLET, AS ITS OWNER SEES IT.
 *
 * ⛔ `.forum.svc.`, NOT `.svc.` — AND THE DIFFERENCE IS THE WHOLE POINT. eno.vn is a licensed sàn
 * TMĐT and may not carry a payments surface at all. `.svc.` is NO LONGER SUFFICIENT for that:
 * production eno.vn builds with `MARKETPLACE_HOSTS_SERVICES=true` (armed 2026-08-14, set by
 * /opt/eno/bin/eno-build.sh) so that it can host the PARTNER's visa chat, and that flag adds every
 * `.svc.` extension to the marketplace's `pageExtensions`. `.forum.svc.` is the second tier no
 * marketplace build lists at any flag setting — see next.config.ts, which says in as many words
 * that payments keep the stricter infix.
 * ⛔ MEASURED, NOT REASONED. Written first as `route.svc.ts`, a clean marketplace build served
 * `<title>Wallet | eno.vn</title>` at /dashboard/wallet and answered 401 (not 404) at /api/wallet.
 * tsc, lint, edition-lint and 4818 tests were all green while that was true. The only thing that
 * caught it was building the marketplace artifact and curling it.
 * ⚠️ BOTH PLAN REVIEWERS REFUTED THE PLAN OVER THE EXTENSION and were right for a smaller reason
 * than the real one: they caught that a second route file might not get `.svc.` at all. Every
 * wallet action therefore lives in this one file — one extension to get right instead of two.
 *
 * ⛔ AND THE READ NEVER CREATES. `walletGate` is the same ladder `provisionForVerifiedIdentity`
 * walks — edition, verification, country, provider config, existing row — stopping short of the
 * provider call. A GET that provisioned would mean a page load spending money at a third party.
 */

const actionSchema = z.object({ action: z.enum(['provision', 'fund']) })

/** What the client is told. Deliberately small: an address and a balance, never an identity. */
type WalletView = {
  state: 'ready' | 'eligible' | 'blocked'
  /** Present only when `ready`. A wallet address is public on-chain and this is its owner. */
  address?: string
  chain?: string
  /**
   * ⚠️ `null` IS A REAL AND DIFFERENT ANSWER FROM `[]`. agy refuted the plan for reading `rawAmount`
   * straight off the adapter's `Result`: `walletBalances` returns `{ok:false}` on a provider outage
   * or an unrecognised payload, and collapsing that to an empty array tells a funded user they hold
   * nothing. `null` means "we could not read it", which the page says out loud.
   */
  balances?: { token: string; rawAmount: string; decimals: number }[] | null
  reason?: ProvisionOutcome['wallet']
  /** Whether the test faucet is available — TRUE ONLY ON A STAGING KEY. See `fundable()`. */
  fundable?: boolean
}

/**
 * ⛔ THE FAUCET IS GATED ON THE KEY IN USE, NOT ON `CROSSMINT_ENV`. codex refuted the plan's
 * `CROSSMINT_ENV === 'staging'` check: an env var is a deploy-time string that a misconfiguration
 * can set to anything, so on its own it is not a production safeguard. `crossmintConfig()` derives
 * the environment from the API key's own `sk_staging_` / `sk_production_` prefix AND refuses
 * outright when a declared `CROSSMINT_ENV` disagrees with it — so a production deploy cannot talk
 * itself into having a faucet, whatever its variables say.
 */
function fundable(): boolean {
  return crossmintConfig()?.env === 'staging'
}

/**
 * ⛔ THE EXISTING WALLET IS LOOKED UP FIRST, BEFORE ANY ELIGIBILITY QUESTION — AND THAT INVERSION
 * IS DELIBERATE, NOT AN OVERSIGHT REPEATED FROM THE WRITE PATH.
 *
 * `walletGate` asks "may a wallet be created for this person?", so it checks the country rules
 * BEFORE it checks whether a row already exists. That order is right for provisioning and wrong
 * for reading. agy found what reusing it verbatim would cost: the settlement allow-list is
 * configuration that changes — a country can be REMOVED — and a seller who already holds a funded
 * wallet would then load this page and be told "not open in your country yet", with their balance
 * and their address both hidden. Their money would still be there; they simply could not see it.
 * Eligibility governs whether a wallet is CREATED. It must never govern whether an existing one is
 * VISIBLE to the person who owns it.
 *
 * ⚠️ THE CHAIN CHECK SURVIVES THE INVERSION, because that one is about whether the row can be read
 * MEANINGFULLY at all: a wallet recorded on another network cannot be addressed with this config,
 * so its balance here would be a number from the wrong place. That stays a blocked state.
 */
async function viewFor(profileId: string): Promise<WalletView> {
  const cfg = crossmintConfig()
  const row = await db.custodyWallet.findUnique({
    where: { profileId }, select: { address: true, chain: true, provider: true },
  })

  if (row) {
    // ⚠️ WITHOUT A CONFIG WE CANNOT READ A BALANCE OR EVEN VALIDATE THE CHAIN, so the address is
    // still shown — it is the reader's own and does not depend on our credentials — with the
    // balance reported as unreadable rather than as zero.
    if (!cfg) return { state: 'ready', address: row.address, chain: row.chain, balances: null, fundable: false }
    if (row.chain !== cfg.chain || row.provider !== 'crossmint') {
      return { state: 'blocked', reason: 'wrong_chain' }
    }
    const balances = await walletBalances(row.address)
    return {
      state: 'ready',
      address: row.address,
      chain: row.chain,
      // ⚠️ PASSED THROUGH IN BASE UNITS, UNROUNDED, AND FORMATTED ON THE CLIENT by
      // `formatTokenAmount`. Dividing here would put a float in the response body, which is the one
      // place a rounding error becomes permanent — JSON has no way to say "this was exact".
      balances: balances.ok ? balances.value : null,
      fundable: fundable(),
    }
  }

  /**
   * ⚠️ ONLY WITH NO ROW AT ALL DOES THE CREATION LADDER DECIDE WHAT TO SAY. `existing` cannot come
   * back here (that case was handled above), so it falls through to the generic branch harmlessly.
   */
  const gate = await walletGate(profileId)
  if (gate.blocked === null) return { state: 'eligible' }
  if (gate.blocked === 'existing') return { state: 'eligible' }
  return { state: 'blocked', reason: gate.blocked }
}

export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const view = await viewFor(userId)
  // ⛔ NEVER CACHED, AT ANY LAYER. A balance and an address keyed to a session are the two things a
  // shared cache must not hand to the next visitor.
  return Response.json(view, { headers: { 'cache-control': 'no-store' } })
})

export const POST = route(
  {
    auth: 'userId',
    body: actionSchema as unknown as z.ZodTypeAny,
    invalidBodyCode: 'invalid_body',
    /**
     * ⚠️ STRICT, AND LOW. Both actions reach a third party that charges us: provisioning creates a
     * custodial wallet and the faucet mints tokens. codex noted the `@unique profileId` stops
     * duplicate ROWS but not repeated provider calls, so the limiter is the thing that bounds cost
     * — and `strict` means a limiter outage refuses rather than waves through.
     */
    rateLimit: { bucket: 'wallet-action', limit: 6, window: '1 h', strict: true },
  },
  async ({ userId, body }) => {
    const { action } = body as z.infer<typeof actionSchema>

    if (action === 'provision') {
      /**
       * ⛔ EVERY ELIGIBILITY QUESTION IS RE-ASKED SERVER-SIDE INSIDE THIS CALL. codex made user-
       * triggered creation conditional on exactly that: `provisionWithinBudget` re-runs the edition
       * gate, the verified-identity read, the country rules and the existing-row check. The client
       * asking for a wallet is a request, never an assertion that one is allowed.
       */
      const outcome = await provisionWithinBudget(userId)
      return Response.json(
        { outcome: outcome.wallet, ...(await viewFor(userId)) },
        { headers: { 'cache-control': 'no-store' } },
      )
    }

    // ⛔ THE FAUCET REFUSES BEFORE IT READS ANYTHING. On a production key this is a 404 — not a 403,
    // which would confirm the endpoint exists.
    if (!fundable()) return Response.json({ error: 'not_found' }, { status: 404 })

    /**
     * ⛔ THE ADDRESS COMES FROM THE SIGNED-IN USER'S OWN ROW, NEVER FROM THE REQUEST. codex named
     * this precisely: a caller-supplied address would make this an authenticated faucet pointed at
     * any wallet on the network. There is deliberately no address field in the schema at all, so
     * there is nothing to forget to validate.
     * ⚠️ AND THE AMOUNT IS FIXED HERE TOO, for the same reason.
     */
    const row = await db.custodyWallet.findUnique({ where: { profileId: userId }, select: { address: true } })
    if (!row) return Response.json({ error: 'no_wallet' }, { status: 409 })

    const funded = await stagingFund(row.address, 10)
    if (!funded.ok) {
      logWarn('staging fund refused', { at: 'wallet.fund', profileId: userId, reason: funded.reason })
      return Response.json({ error: 'fund_failed' }, { status: 502 })
    }
    return Response.json(await viewFor(userId), { headers: { 'cache-control': 'no-store' } })
  },
)
