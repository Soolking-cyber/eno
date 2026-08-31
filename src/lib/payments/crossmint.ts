import 'server-only'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { IS_SERVICES } from '@/lib/edition'
import { logWarn } from '@/lib/log'

/**
 * THE CROSSMINT ADAPTER — the only place in this codebase that talks to a wallet provider.
 *
 * ⛔ REST, NOT `@crossmint/wallets-sdk`, AND THAT WAS A MEASURED DECISION RATHER THAN A PREFERENCE.
 * The SDK was installed first and `npm audit --omit=dev` went from 3 vulnerabilities to 12 — four of
 * them HIGH — because it pulls `@solana/web3.js` and `viem`, and viem pins `ws@8.18.2`, which is
 * inside the advisory range for both an uninitialised-memory disclosure and a memory-exhaustion DoS.
 * The committed lockfile had only `ws@8.21.1`, so installing it would have introduced a vulnerable
 * websocket library into a PAYMENTS path, to talk to an HTTPS API, on an EVM chain, via a Solana
 * client we will never call. Removing it and deriving the one thing the SDK actually did for us —
 * the signer address — with `@noble/curves` put the count back to exactly the 3 pre-existing Prisma
 * advisories. Verify with `npm audit --omit=dev` before adding anything here.
 *
 * ⛔ THE SIGNER SECRET NEVER LEAVES THIS PROCESS. Crossmint's own docs are explicit that the secret
 * is not transmitted: the address is derived locally and only the ADDRESS is sent. That is the
 * property worth protecting — it is what stops the provider signing on a user's behalf — so nothing
 * here may log, return, or send `CROSSMINT_SIGNER_SECRET`, and `signerAddress()` is the only
 * function that reads it.
 *
 * ⚠️ EVERY FUNCTION RETURNS A RESULT, NEVER THROWS ON A PROVIDER ERROR. The caller is a KYC approval
 * side effect that must not fail an admin's decision (see kyc/on-verified.ts), so a network failure,
 * a 500 or a malformed body all come back as `{ ok: false }` with a reason. A THROW here would have
 * to be caught by every call site, and one of them would forget.
 */

/** The pinned API version. A different version is a different contract — never `latest`. */
const API_VERSION = '2025-06-09'

/**
 * ⚠️ FUNDING LIVES ON A DIFFERENT, ALPHA API VERSION, AND THAT IS CROSSMINT'S SHAPE, NOT A TYPO.
 * `POST /balances` exists only under `v1-alpha2`; calling it under the pinned version returns a
 * bare 404 that reads exactly like a wrong address. Found by calling it. It is isolated here rather
 * than made a parameter everywhere, so an alpha endpoint cannot quietly become the default: this is
 * a staging-only test convenience, and nothing that touches real money may point at an alpha API.
 */
const FUND_API_VERSION = 'v1-alpha2'

/**
 * ⚠️ THE CHAIN IS PART OF THE IDENTITY OF A WALLET, not a detail. The same address exists on
 * `base` and `base-sepolia`, which is exactly why CustodyWallet is keyed on (provider, chain,
 * address): a staging wallet must not be able to masquerade as a production one.
 */
export type CrossmintEnv = 'staging' | 'production'

export type CrossmintConfig = {
  env: CrossmintEnv
  baseUrl: string
  apiKey: string
  signerSecret: string
  chain: string
}

export type AdapterFailure =
  /** No credentials in this environment — the expected state until they are deployed. */
  | 'not_configured'
  /**
   * ⚠️ CREDENTIALS ARE PRESENT AND UNUSABLE — someone configured this and got it wrong. Distinct
   * from `not_configured` because they need opposite responses: one is "waiting for a deploy", the
   * other is "a deploy is broken right now". They were the same value until a reviewer pointed out
   * that a typo'd key looked exactly like an environment nobody had touched.
   */
  | 'misconfigured'
  /** This build is the marketplace, which has no settlement layer. */
  | 'wrong_edition'
  /** The provider answered, and said no. */
  | 'provider_rejected'
  /** The provider did not answer, or answered with something unusable. */
  | 'provider_unreachable'

export type Result<T> = { ok: true; value: T } | { ok: false; reason: AdapterFailure; detail?: string }

/**
 * ⚠️ READ AT CALL TIME, NOT AT MODULE SCOPE. A module-level read is captured once per process, so a
 * test that stubs the environment — and every test here does — would see whatever the first import
 * happened to observe. It also means an unconfigured environment is a runtime answer rather than an
 * import-time crash, which matters because this module is imported by the KYC approval path.
 */
/**
 * ⛔ CONFIGURED-BUT-BROKEN IS NOT THE SAME AS UNCONFIGURED, AND IT WAS SILENT. Both returned null,
 * so a typo'd key prefix, a chain on the wrong network or a malformed signer secret all surfaced to
 * the provisioning hook as `pending_provider` — "waiting for credentials", the one outcome nobody
 * investigates. A reviewer found that an environment someone had actually tried to configure looked
 * exactly like one nobody had touched. Still null, so callers are unchanged; the difference is that
 * it now says so once.
 * ⚠️ NEVER LOGS THE VALUES. The reason names the variable, never its contents.
 */
let lastConfigWasBroken = false

function misconfigured(why: string): null {
  lastConfigWasBroken = true
  /**
   * ⚠️ THE LOG IS GUARDED, LIKE EVERY OTHER LOG IN A FAILURE PATH. Two reviewers found this bare
   * `logWarn` — the last one in the diff — sitting on the route `createWallet` takes when the
   * environment is half-configured. A broken log transport there would have thrown straight out of
   * a function whose entire contract is that it returns a Result instead.
   */
  try { logWarn('crossmint is configured but unusable', { at: 'payments.crossmint.config', why }) } catch { /* ignore */ }
  return null
}

/**
 * ⛔ WHY THERE IS NO CONFIG, so a caller's mapping cannot diverge from `createWallet`'s. A reviewer
 * found `on-verified.ts` short-cutting a null config to `pending_provider` under a comment claiming
 * that was "the answer the createWallet path would have given anyway" — it was not: createWallet
 * answers `misconfigured` for a broken environment, which maps to `failed` and a warning. So a
 * half-configured eno.forum deploy marked every eligible approval "waiting for credentials" that
 * had already been supplied, wrongly. One function, asked by both, instead of two mappings.
 */
export function configState(): 'ok' | 'absent' | 'broken' {
  const cfg = crossmintConfig()
  if (cfg) return 'ok'
  return lastConfigWasBroken ? 'broken' : 'absent'
}

export function crossmintConfig(): CrossmintConfig | null {
  lastConfigWasBroken = false
  const apiKey = process.env.CROSSMINT_SERVER_SIDE_API_KEY?.trim()
  const signerSecret = process.env.CROSSMINT_SIGNER_SECRET?.trim()
  // ⚠️ ABSENT IS NOT BROKEN, BUT HALF-ABSENT IS. No credentials at all is the ordinary state of an
  // environment nobody has configured; ONE of the two is a deploy somebody got wrong, and two
  // reviewers found both reporting as `not_configured` — the outcome that reads "waiting for a
  // deploy" when the deploy has already happened and is broken.
  if (!apiKey && !signerSecret) return null
  if (!apiKey) return misconfigured('CROSSMINT_SIGNER_SECRET is set but CROSSMINT_SERVER_SIDE_API_KEY is not')
  if (!signerSecret) return misconfigured('CROSSMINT_SERVER_SIDE_API_KEY is set but CROSSMINT_SIGNER_SECRET is not')

  /**
   * ⛔ THE ENVIRONMENT IS DERIVED FROM THE KEY, NOT MERELY FROM A VARIABLE. Crossmint prefixes
   * staging keys `sk_staging_` and production keys `sk_production_`, so the key itself says which
   * network it addresses. Trusting `CROSSMINT_ENV` alone would let a deploy that set it to
   * `production` while carrying a staging key create wallets on a testnet and call them real — or,
   * far worse, the reverse. When the two disagree the key wins and the mismatch is refused outright.
   */
  const keySaysStaging = apiKey.startsWith('sk_staging_')
  const keySaysProduction = apiKey.startsWith('sk_production_')
  if (!keySaysStaging && !keySaysProduction) return misconfigured('API key has no recognised sk_staging_/sk_production_ prefix')

  const declared = process.env.CROSSMINT_ENV?.trim()
  const env: CrossmintEnv = keySaysStaging ? 'staging' : 'production'
  if (declared && declared !== env) return misconfigured('CROSSMINT_ENV disagrees with the API key prefix')

  const chain = chainFor(env)
  if (!chain) return misconfigured(`CROSSMINT_CHAIN is not a ${env} network`)

  try {
    // ⚠️ THE SECRET IS VALIDATED HERE, NOT AT FIRST USE. A malformed one otherwise surfaces as a
    // thrown error deep inside createWallet, long after the deploy that broke it.
    signerAddress(signerSecret)
  } catch {
    return misconfigured('CROSSMINT_SIGNER_SECRET is not 32 bytes of hex')
  }

  return {
    env,
    baseUrl: env === 'staging' ? 'https://staging.crossmint.com' : 'https://www.crossmint.com',
    apiKey,
    signerSecret,
    chain,
  }
}

/**
 * ⛔ THE CHAIN MUST MATCH THE KEY'S NETWORK, AND SAYING SO IN A COMMENT WAS NOT ENOUGH. The comment
 * here read "not configurable by accident" while `CROSSMINT_CHAIN` accepted anything — so a
 * production key with `CROSSMINT_CHAIN=base-sepolia` would create wallets nobody can spend from,
 * and a staging key on `base` would ask for real money. Two reviewers pointed at the gap between
 * the claim and the code. An override is still useful (a second testnet, a future mainnet), but it
 * may only move within the network the key already addresses.
 */
const TESTNETS = new Set(['base-sepolia', 'polygon-amoy', 'ethereum-sepolia', 'optimism-sepolia', 'arbitrum-sepolia'])
const MAINNETS = new Set(['base', 'polygon', 'ethereum', 'optimism', 'arbitrum'])

/**
 * ⛔ AN ALLOW-LIST, NOT "ANYTHING THAT IS NOT A TESTNET". The first version only refused a KNOWN
 * testnet on a production key, so a typo — `bas`, or a chain Crossmint has never heard of — sailed
 * through as production. That value is then STORED on the CustodyWallet row and used in every
 * balance query for that wallet, and `profileId` is unique, so nothing corrects it automatically.
 * A reviewer walked it. This is the same lesson eligibility.ts already records about country codes:
 * validating the shape of a value is not validating the value.
 */
function chainFor(env: CrossmintEnv): string | null {
  const allowed = env === 'staging' ? TESTNETS : MAINNETS
  const override = process.env.CROSSMINT_CHAIN?.trim()
  if (!override) return env === 'staging' ? 'base-sepolia' : 'base'
  // ⚠️ REFUSED, NOT SILENTLY CORRECTED. Falling back to the default would let a deploy believe it
  // was on the chain it configured.
  return allowed.has(override) ? override : null
}

/**
 * The admin signer's address, derived from our secret.
 *
 * ⚠️ secp256k1 → keccak256 → LAST 20 BYTES, and the uncompressed public key's leading `0x04` tag is
 * dropped before hashing. Getting any step of that wrong yields a plausible-looking address that
 * nobody controls, so `crossmint.test.ts` checks it against two published vectors (private keys 1
 * and 2) rather than against itself.
 */
export function signerAddress(secret: string): string {
  const hex = secret.trim().replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('signer secret must be 32 bytes of hex')
  const priv = Uint8Array.from(Buffer.from(hex, 'hex'))
  const pub = secp256k1.getPublicKey(priv, false).slice(1)
  return '0x' + Buffer.from(keccak_256(pub).slice(-20)).toString('hex')
}

/**
 * ⚠️ ONE PLACE THAT SPEAKS HTTP, so the timeout, the headers and the error shape cannot drift
 * between endpoints. `AbortSignal.timeout` is what stops a hung provider becoming a hung request —
 * the KYC approval path bounds this again on its own side, and both bounds are wanted: this one
 * keeps a socket from being held, that one keeps an admin from waiting.
 */
async function call<T>(
  cfg: CrossmintConfig,
  path: string,
  init?: { method?: string; body?: unknown; apiVersion?: string },
): Promise<Result<T>> {
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/api/${init?.apiVersion ?? API_VERSION}/${path}`, {
      method: init?.method ?? 'GET',
      headers: { 'X-API-KEY': cfg.apiKey, 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      /**
       * ⚠️ SHORTER THAN THE CALLER'S BUDGET, ON PURPOSE. `provisionWithinBudget` allows 8s; at 10s
       * this timeout could never fire first, so a hung provider always surfaced as the caller's
       * blunt `timed_out` instead of this function's `provider_unreachable` with a reason. A
       * reviewer spotted the two bounds fighting. Six seconds leaves room for the DB work either
       * side of the call.
       */
      signal: AbortSignal.timeout(6_000),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, reason: 'provider_unreachable', detail: e instanceof Error ? e.message : 'fetch failed' }
  }

  // ⚠️ THE BODY READ IS GUARDED TOO. A reviewer spotted it outside the try: an aborted or broken
  // response stream rejects here, and that rejection would escape a function whose whole contract
  // is that it never throws.
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    /**
     * ⚠️ THE PROVIDER'S MESSAGE IS KEPT, TRUNCATED, AND IS THE ONLY THING KEPT. A 4xx from a wallet
     * API is usually actionable ("owner already has a wallet", "invalid locator") and losing it
     * leaves an operator with a status code. It is truncated because a provider error body is
     * untrusted input that ends up in logs.
     */
    return { ok: false, reason: 'provider_rejected', detail: `${res.status} ${text.slice(0, 300)}` }
  }
  try {
    return { ok: true, value: JSON.parse(text) as T }
  } catch {
    return { ok: false, reason: 'provider_unreachable', detail: 'unparseable response body' }
  }
}

/**
 * ⛔ THE EDITION GATE, ASSERTED IN THE ADAPTER TOO. `on-verified.ts` already returns before reaching
 * here on a marketplace build, and this is deliberate duplication: eno.vn is a licensed sàn TMĐT
 * that is meant to be paymentless, and the module that actually creates a wallet should be the last
 * one able to claim it did not know. A single missing gate at one call site should not be enough.
 */
function guard(): Result<CrossmintConfig> {
  if (!IS_SERVICES) return { ok: false, reason: 'wrong_edition' }
  const cfg = crossmintConfig()
  // ⚠️ `misconfigured` IS DISTINGUISHED FROM `not_configured` HERE, using the flag `crossmintConfig`
  // sets on its way out. Both are null configs; only one of them is somebody's mistake.
  if (!cfg) return { ok: false, reason: lastConfigWasBroken ? 'misconfigured' : 'not_configured' }
  return { ok: true, value: cfg }
}

export type WalletRef = { address: string; chain: string; provider: 'crossmint' }

/**
 * Create (or adopt) the custody wallet for a profile.
 *
 * ⚠️ THE OWNER LOCATOR IS `userId:<profileId>`, NOT AN EMAIL. Crossmint keys a wallet by an owner
 * string, and using the email would tie custody to a mutable contact detail — a user changing their
 * address would look like a different owner, and two accounts sharing an inbox would collide. The
 * profile id is the stable identity this app already treats as the person.
 *
 * ⚠️ IDEMPOTENT BY OWNER. Calling twice for the same profile returns the same wallet rather than a
 * second one, because Crossmint resolves an existing wallet for a known owner. The caller ALSO
 * checks for an existing CustodyWallet row first; both are wanted, because the row can be missing
 * while the wallet exists (a crash between the two writes) and that must converge, not duplicate.
 */
export async function createWallet(profileId: string): Promise<Result<WalletRef>> {
  const g = guard()
  if (!g.ok) return g
  const cfg = g.value

  let admin: string
  try {
    admin = signerAddress(cfg.signerSecret)
  } catch (e) {
    return { ok: false, reason: 'not_configured', detail: e instanceof Error ? e.message : 'bad signer secret' }
  }

  const r = await call<{ address?: string }>(cfg, 'wallets', {
    method: 'POST',
    body: {
      chainType: 'evm',
      type: 'smart',
      config: { adminSigner: { type: 'server', address: admin } },
      owner: `userId:${profileId}`,
    },
  })
  if (!r.ok) return r
  const address = r.value?.address
  // ⚠️ A 200 WITH NO ADDRESS IS A FAILURE, not a wallet. Trusting the status code alone would write
  // a CustodyWallet row with `undefined` for the one column that matters.
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return { ok: false, reason: 'provider_unreachable', detail: 'response had no usable address' }
  }
  return { ok: true, value: { address, chain: cfg.chain, provider: 'crossmint' } }
}

/**
 * ⛔ `rawAmount`, NOT `amount` — AND THE DIFFERENCE IS FOUR ORDERS OF MAGNITUDE. Crossmint returns
 * BOTH: `amount: "10"` is the display value and `rawAmount: "10000000"` is base units. The first
 * version of this parser read `amount`, which would have recorded a $10 deposit as 10 base units —
 * one thousandth of a cent — and order-state.ts, which takes minor units, would have accepted it
 * without complaint. Found by printing the real response instead of trusting the shape.
 * ⚠️ THE FIELD IS `symbol`, NOT `token`, TOO. Both mistakes were invisible: the defensive parser
 * dropped every row it did not recognise and returned an empty array, so a wallet holding 10 USDXM
 * read as a wallet holding nothing — a shape mismatch disguised as an empty balance.
 */
export type Balance = { token: string; rawAmount: string; decimals: number }

/**
 * What a wallet holds, in the tokens we settle in.
 *
 * ⚠️ AMOUNTS STAY STRINGS ALL THE WAY UP, AND ARE BASE UNITS. USDC has six decimals and a
 * base-unit balance can exceed what a float represents exactly; parsing to Number here would put a
 * rounding error at the bottom of every balance. order-state.ts takes bigint for the same reason,
 * and `rawAmount` is the field that speaks its language.
 */
export async function walletBalances(address: string, tokens = ['usdc']): Promise<Result<Balance[]>> {
  const g = guard()
  if (!g.ok) return g
  const cfg = g.value
  const q = new URLSearchParams({ tokens: tokens.join(','), chains: cfg.chain })
  const r = await call<unknown>(cfg, `wallets/${encodeURIComponent(address)}/balances?${q}`)
  if (!r.ok) return r

  // ⚠️ SHAPED DEFENSIVELY. This is a third party's response, not our own type; a change in their
  // payload should degrade to "no balances", never throw inside a render.
  /**
   * ⛔ A NON-ARRAY BODY IS A SHAPE WE DO NOT UNDERSTAND, NOT AN EMPTY WALLET. This coerced anything
   * unexpected to `[]`, which then reported `ok` with no balances — so a provider response wrapped
   * as `{ balances: [...] }` after a schema change would tell a funded user they hold nothing. Two
   * reviewers found the coercion still open after the rows-in-nothing-out case was closed.
   */
  if (!Array.isArray(r.value)) {
    try {
      logWarn('balances response was not an array — the provider response shape may have changed', {
        at: 'payments.crossmint.balances', got: typeof r.value,
      })
    } catch { /* ignore */ }
    return { ok: false, reason: 'provider_unreachable', detail: 'balances response was not an array' }
  }
  const rows = r.value
  const out: Balance[] = []
  /**
   * ⛔ EVERY ROW MUST PARSE, NOT MERELY ONE OF THEM. This failed only when ALL rows were
   * unreadable, so a response where `usdc` parsed and a funded `usdt` row did not would return
   * `ok` with an INCOMPLETE balance — and a checkout deciding from partial data underreports what
   * someone holds. A reviewer put it exactly: partial is worse than none, because none is obvious.
   */
  let unreadable = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object') { unreadable++; continue }
    const o = row as Record<string, unknown>
    const token = typeof o.symbol === 'string' ? o.symbol : null
    /**
     * ⛔ STRINGS ONLY — A NUMERIC `rawAmount` IS ALREADY WRONG BY THE TIME WE SEE IT. `JSON.parse`
     * rounds anything past 2^53 before this code runs, so `String(o.rawAmount)` would faithfully
     * record a value the parser had already corrupted. A reviewer caught the earlier version
     * accepting numbers. Skipping the row loses a balance; accepting it loses money.
     */
    const raw = typeof o.rawAmount === 'string' ? o.rawAmount : null
    // ⛔ A ROW WITHOUT A BASE-UNIT AMOUNT IS SKIPPED, NEVER FILLED IN FROM `amount`. Converting the
    // display value would need the decimals to be right and would silently invent precision.
    if (!token || raw === null || !/^\d+$/.test(raw)) { unreadable++; continue }
    out.push({ token, rawAmount: raw, decimals: typeof o.decimals === 'number' ? o.decimals : 6 })
  }
  /**
   * ⛔ ANY UNREADABLE ROW MEANS THE SHAPE CHANGED — AND THAT MUST NOT READ AS A BALANCE.
   * This exact failure already happened once here: the parser looked for `token`/`amount` while the
   * API returns `symbol`/`rawAmount`, so a wallet holding 10 USDXM reported as holding nothing, and
   * nothing anywhere said so. A reviewer pointed out the defensive filter still hides it in
   * general. An empty result is legitimate — a NEW wallet has no balances — so this cannot fail;
   * what it can do is stop being silent.
   */
  if (unreadable > 0) {
    try {
      logWarn('every balance row was unparseable — the provider response shape may have changed', {
        at: 'payments.crossmint.balances', rows: rows.length, unreadable,
        sample: JSON.stringify(rows[0]).slice(0, 200),
      })
    } catch { /* ignore */ }
    /**
     * ⛔ AND IT FAILS, BECAUSE A WARNING IS NOT A SAFE SUBSTITUTE FOR ONE. A reviewer put it
     * plainly: a funded wallet reported as `{ ok: true, value: [] }` is indistinguishable from an
     * empty one, so a checkout would tell someone holding 10 USDC that they have nothing — and the
     * warning that says otherwise is deliberately allowed to fail. An empty RESPONSE stays `ok`,
     * because a new wallet legitimately holds nothing; rows we cannot read are a different fact.
     */
    return { ok: false, reason: 'provider_unreachable', detail: `${unreadable} of ${rows.length} balance rows could not be parsed` }
  }
  return { ok: true, value: out }
}

/**
 * ⚠️ STAGING ONLY, AND IT REFUSES ANYWHERE ELSE. Crossmint mints its own test stablecoin (USDXM)
 * into a wallet on request, which is what makes an end-to-end payment test possible without a
 * faucet or testnet gas. A production key reaching this would be trying to conjure real balance,
 * so the environment is checked rather than assumed from the caller.
 * ⚠️ NEEDS THE `wallets.fund` SCOPE on the API key, and uses the ALPHA api version — see
 * FUND_API_VERSION. A 404 here usually means the version, and a 403 usually means the scope.
 */
export async function stagingFund(address: string, amount: number): Promise<Result<true>> {
  const g = guard()
  if (!g.ok) return g
  const cfg = g.value
  if (cfg.env !== 'staging') return { ok: false, reason: 'wrong_edition', detail: 'stagingFund is staging-only' }
  const r = await call<unknown>(cfg, `wallets/${encodeURIComponent(address)}/balances`, {
    method: 'POST',
    apiVersion: FUND_API_VERSION,
    body: { amount, token: 'usdxm', chain: cfg.chain },
  })
  return r.ok ? { ok: true, value: true } : r
}
