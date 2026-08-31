import 'server-only'

/**
 * MARKETPLACE-EDITION STUB for payments/crossmint.ts.
 *
 * eno.vn is a licensed sàn TMĐT and is deliberately paymentless — owner, 2026-08-30: *"eno.vn stay
 * paymentless but eno.forum will have payment settlement layer"*. The real adapter already refuses
 * to act on a marketplace build (`IS_SERVICES` is checked inside it AND at its call site), but a
 * gate decides what RENDERS and an alias decides what SHIPS: measured on a marketplace build before
 * this stub existed, `.next/server` carried `staging.crossmint.com`, `adminSigner`, `usdxm` and
 * `base-sepolia`. next.config.ts aliases the real module here so the licensed image contains no
 * wallet-provider vocabulary and no code path to a custody API at all.
 *
 * ⚠️ THE CLIENT BUNDLE WAS ALREADY CLEAN — this is about the SERVER artifact. Worth stating so the
 * next person does not conclude the alias is unnecessary after grepping `.next/static` and finding
 * nothing.
 *
 * ⚠️ ITS SHAPE MUST TRACK THE REAL MODULE'S, and nothing type-checks that across an alias — a stub
 * missing an export is a runtime crash on the edition nobody ran locally. Every function here
 * returns the same `Result` shape the real one does, with the reason that is true on this build.
 */

export type CrossmintEnv = 'staging' | 'production'
export type CrossmintConfig = {
  env: CrossmintEnv
  baseUrl: string
  apiKey: string
  signerSecret: string
  chain: string
}
export type AdapterFailure = 'not_configured' | 'misconfigured' | 'wrong_edition' | 'provider_rejected' | 'provider_unreachable'
export type Result<T> = { ok: true; value: T } | { ok: false; reason: AdapterFailure; detail?: string }
export type WalletRef = { address: string; chain: string; provider: 'crossmint' }
export type Balance = { token: string; rawAmount: string; decimals: number }

/**
 * ⚠️ `wrong_edition`, NOT `not_configured`. The two mean different things to the KYC provisioning
 * hook — one is "this build has no settlement layer", the other is "credentials are missing and an
 * eligible user is waiting". Returning the wrong one here would put marketplace users into a retry
 * queue for a wallet this edition may never create.
 */
const REFUSED = { ok: false as const, reason: 'wrong_edition' as const, detail: 'marketplace edition has no settlement layer' }

export function crossmintConfig(): CrossmintConfig | null {
  return null
}

/**
 * ⚠️ `absent` — this edition is not misconfigured, it simply has no settlement layer.
 * ⛔ AND IT IS UNREACHABLE IN PRACTICE, WHICH THE COMMENT ABOVE USED TO OBSCURE. A reviewer noticed
 * the stub advertising that it "answers `wrong_edition`, never `not_configured`" while
 * `provisionForVerifiedIdentity` consults `configState()` — whose vocabulary has no
 * `wrong_edition` — before any Result-returning function. It never gets that far: the edition gate
 * at the top of that function returns `skipped_edition` first, and a test asserts the custody table
 * is never even queried. So the REFUSED value below is the belt, this is the braces, and neither
 * is the thing actually holding the trousers up.
 */
export function configState(): 'ok' | 'absent' | 'broken' {
  return 'absent'
}

/**
 * ⚠️ THROWS, LIKE THE REAL ONE, rather than returning a fake address. This is only ever called with
 * a secret this edition does not have, and a plausible-looking address that nobody controls is the
 * single worst thing this file could hand back.
 */
export function signerAddress(_secret: string): string {
  throw new Error('crossmint is not available on the marketplace edition')
}

export async function createWallet(_profileId: string): Promise<Result<WalletRef>> {
  return REFUSED
}

export async function walletBalances(_address: string, _tokens?: string[]): Promise<Result<Balance[]>> {
  return REFUSED
}

export async function stagingFund(_address: string, _amount: number): Promise<Result<true>> {
  return REFUSED
}
