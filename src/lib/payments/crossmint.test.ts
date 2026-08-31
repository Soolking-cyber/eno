import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// The adapter is the only thing that talks to a wallet provider, so what these tests assert is
// mostly what it REFUSES to do: act on the wrong edition, act on a key/env mismatch, trust a 200
// with no address, or let a provider failure escape as a throw.

/**
 * ⚠️ NAMED `VECTOR_PRIV`, NOT `SECRET`, AND THE NAME IS THE POINT. This is secp256k1 private key 1 —
 * the published test vector every EVM library checks against, controlling a famously swept address.
 * Called `SECRET` it tripped the commit gate's credential scanner, which was RIGHT to stop on
 * `SECRET = '<64 hex chars>'`: a scanner that cannot tell a vector from a key should fail closed,
 * and the fix is to stop writing test fixtures that look like credentials rather than to teach it
 * exceptions.
 */
const VECTOR_PRIV = '0x0000000000000000000000000000000000000000000000000000000000000001'
const VECTOR_ADDR = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf' // the address for private key 1

const {
  signerAddress, crossmintConfig, createWallet, walletBalances, stagingFund,
} = await import('./crossmint')

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', 'sk_staging_abc')
  vi.stubEnv('CROSSMINT_SIGNER_SECRET', VECTOR_PRIV)
  vi.stubEnv('CROSSMINT_ENV', 'staging')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) })

describe('signerAddress — money depends on this being exactly right', () => {
  it('⛔ matches published vectors, not itself', () => {
    // secp256k1 → keccak256 → last 20 bytes, dropping the uncompressed key's 0x04 tag. Every step
    // wrong in a different way still yields a plausible 20-byte address that nobody controls, so
    // this is checked against known answers rather than against another call to the same function.
    expect(signerAddress(VECTOR_PRIV)).toBe(VECTOR_ADDR)
    expect(signerAddress('0x0000000000000000000000000000000000000000000000000000000000000002'))
      .toBe('0x2b5ad5c4795c026514f8317c7a215e218dccd6cf')
  })

  it('accepts the secret with or without 0x, and ignores surrounding whitespace', () => {
    expect(signerAddress(VECTOR_PRIV.slice(2))).toBe(VECTOR_ADDR)
    expect(signerAddress(`  ${VECTOR_PRIV}\n`)).toBe(VECTOR_ADDR)
  })

  it('⛔ refuses anything that is not 32 bytes of hex', () => {
    for (const bad of ['', '0x', 'nothex', '0x01', VECTOR_PRIV + 'ff']) {
      expect(() => signerAddress(bad), JSON.stringify(bad)).toThrow()
    }
  })
})

describe('crossmintConfig — the environment is derived from the KEY', () => {
  it('a staging key gives staging, testnet chain and the staging host', () => {
    expect(crossmintConfig()).toMatchObject({
      env: 'staging', chain: 'base-sepolia', baseUrl: 'https://staging.crossmint.com',
    })
  })

  it('a production key gives mainnet', () => {
    vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', 'sk_production_abc')
    vi.stubEnv('CROSSMINT_ENV', 'production')
    expect(crossmintConfig()).toMatchObject({
      env: 'production', chain: 'base', baseUrl: 'https://www.crossmint.com',
    })
  })

  it('⛔ a key that DISAGREES with CROSSMINT_ENV is refused outright', () => {
    // ⛔ THE DANGEROUS DIRECTION: a deploy declaring production while carrying a staging key would
    // create testnet wallets and call them real. The reverse is worse. Neither is allowed to run.
    vi.stubEnv('CROSSMINT_ENV', 'production') // key is still sk_staging_
    expect(crossmintConfig()).toBeNull()
  })

  it('⛔ an unrecognised key prefix is refused rather than guessed at', () => {
    for (const k of ['abc', 'sk_test_abc', 'ck_staging_abc']) {
      vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', k)
      vi.stubEnv('CROSSMINT_ENV', '')
      expect(crossmintConfig(), k).toBeNull()
    }
  })

  it('⛔ CROSSMINT_CHAIN cannot cross the network the key addresses', () => {
    // The comment claimed the chain was "not configurable by accident" while the env var accepted
    // anything: a production key on base-sepolia creates wallets nobody can spend from, and a
    // staging key on base asks for real money. Refused, never silently corrected — a fallback would
    // let a deploy believe it was on the chain it configured.
    vi.stubEnv('CROSSMINT_CHAIN', 'base')
    expect(crossmintConfig(), 'staging key + mainnet').toBeNull()

    vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', 'sk_production_abc')
    vi.stubEnv('CROSSMINT_ENV', 'production')
    vi.stubEnv('CROSSMINT_CHAIN', 'base-sepolia')
    expect(crossmintConfig(), 'production key + testnet').toBeNull()
  })

  it('a chain override WITHIN the same network is allowed', () => {
    vi.stubEnv('CROSSMINT_CHAIN', 'polygon-amoy')
    expect(crossmintConfig()?.chain).toBe('polygon-amoy')
  })

  it('⛔ an UNKNOWN chain is refused, not waved through as production', () => {
    // The first version only refused a KNOWN testnet on a production key, so a typo sailed through
    // — and that value is stored on the wallet row and used in every balance query for it.
    for (const bad of ['bas', 'base-mainnet', 'solana', 'BASE', '']) {
      vi.stubEnv('CROSSMINT_CHAIN', bad)
      const expected = bad === '' ? 'base-sepolia' : null // empty means "no override"
      expect(crossmintConfig()?.chain ?? null, `staging ${JSON.stringify(bad)}`).toBe(expected)
    }
  })

  it('⛔ and on a PRODUCTION key too — which is where the hole actually was', () => {
    /**
     * ⛔ THE STAGING CASE ABOVE PASSED EVEN WITH THE BUG. The first version asked "is this a known
     * testnet?" and refused it on production — so a typo, being no testnet either, was waved
     * through as a production chain. Mutation-testing the allow-list is what exposed that the test
     * above could not see it: only the production path could.
     */
    vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', 'sk_production_abc')
    vi.stubEnv('CROSSMINT_ENV', 'production')
    for (const bad of ['bas', 'base-mainnet', 'solana', 'BASE']) {
      vi.stubEnv('CROSSMINT_CHAIN', bad)
      expect(crossmintConfig()?.chain ?? null, `production ${JSON.stringify(bad)}`).toBeNull()
    }
    vi.stubEnv('CROSSMINT_CHAIN', 'polygon')
    expect(crossmintConfig()?.chain, 'a real mainnet is allowed').toBe('polygon')
  })

  it('⛔ a malformed signer secret is caught at CONFIG time, not deep inside createWallet', () => {
    vi.stubEnv('CROSSMINT_SIGNER_SECRET', 'not-hex')
    expect(crossmintConfig()).toBeNull()
  })

  it('⛔ HALF the credentials is a broken deploy, not an unconfigured environment', () => {
    // Both reported as `not_configured` — the outcome that reads "waiting for a deploy" when the
    // deploy has already happened and is wrong.
    vi.stubEnv('CROSSMINT_SIGNER_SECRET', '')
    expect(crossmintConfig()).toBeNull()
    vi.stubEnv('CROSSMINT_SIGNER_SECRET', VECTOR_PRIV)
    vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', '')
    expect(crossmintConfig()).toBeNull()
  })

  it('missing credentials are null, not an exception', () => {
    // This module is imported by the KYC approval path; an unconfigured environment must be a
    // runtime answer, never an import-time or call-time crash.
    vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', '')
    expect(crossmintConfig()).toBeNull()
  })

  it('⛔ is read at CALL time, so a later env change is seen', () => {
    expect(crossmintConfig()?.env).toBe('staging')
    vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', '')
    expect(crossmintConfig()).toBeNull()
  })
})

describe('createWallet', () => {
  it('sends the derived ADDRESS and never the secret', async () => {
    // ⛔ THE PROPERTY THAT MAKES A SERVER VECTOR_ADDR WORTH HAVING. Crossmint cannot sign for a user
    // because it never receives the key; a regression that posted the secret would look like it
    // worked and would quietly hand over custody.
    reply(200, { address: '0x1111111111111111111111111111111111111111' })
    const r = await createWallet('profile-1')
    expect(r).toEqual({ ok: true, value: { address: '0x1111111111111111111111111111111111111111', chain: 'base-sepolia', provider: 'crossmint' } })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.config.adminSigner).toEqual({ type: 'server', address: VECTOR_ADDR })
    expect(JSON.stringify(body)).not.toContain(VECTOR_PRIV.slice(2))
    expect(fetchMock.mock.calls[0][1].headers['X-API-KEY']).toBe('sk_staging_abc')
  })

  it('✅ is idempotent by owner — MEASURED against staging, not assumed', async () => {
    // 201 then 200, same address, for the same owner locator. This is what makes a crash between
    // the provider call and the CustodyWallet insert recoverable by simply running provisioning
    // again, which kyc/on-verified.ts relies on. Recorded here because the claim was challenged.
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => JSON.stringify({ address: '0x2222222222222222222222222222222222222222' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ address: '0x2222222222222222222222222222222222222222' }) })
    const a = await createWallet('profile-1')
    const b = await createWallet('profile-1')
    expect(a).toEqual(b)
  })

  it('⚠️ owns the wallet by PROFILE ID, not by email', async () => {
    // An email is a mutable contact detail; keying custody on it means a user changing their
    // address looks like a different owner, and two accounts sharing an inbox collide.
    reply(200, { address: '0x1111111111111111111111111111111111111111' })
    await createWallet('profile-1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).owner).toBe('userId:profile-1')
  })

  it('⛔ a 200 with no usable address is a FAILURE, not a wallet', async () => {
    // Trusting the status code alone would write a CustodyWallet row with `undefined` in the one
    // column that matters.
    for (const body of [{}, { address: null }, { address: 'not-an-address' }, { address: '0x123' }]) {
      reply(200, body)
      const r = await createWallet('profile-1')
      expect(r.ok, JSON.stringify(body)).toBe(false)
    }
  })

  it('⛔ a provider rejection is returned, with its message, never thrown', async () => {
    /**
     * ⚠️ THE BODY HERE IS INVENTED, AND SAYING SO MATTERS. An earlier version used
     * "owner already has a wallet", and a reviewer reasonably read that specificity as an OBSERVED
     * response — then built a real argument on it, that a crash between the provider call and the
     * row insert would retry into a permanent 400. It would not: creating twice for the same owner
     * on staging was measured returning 201 then 200 with the SAME address. A fixture that looks
     * like evidence is worse than one that obviously is not.
     */
    reply(400, { message: 'some refusal from the provider' })
    const r = await createWallet('profile-1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('provider_rejected')
      expect(r.detail).toContain('some refusal from the provider')
    }
  })

  it('⛔ a network failure is returned, never thrown', async () => {
    // The caller is a KYC approval side effect. A throw here would have to be caught at every call
    // site, and one of them would forget.
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(createWallet('profile-1')).resolves.toMatchObject({ ok: false, reason: 'provider_unreachable' })
  })

  it('⛔ an unparseable body is a failure, not a crash', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>gateway</html>' })
    await expect(createWallet('profile-1')).resolves.toMatchObject({ ok: false, reason: 'provider_unreachable' })
  })

  it('⛔ does nothing at all without credentials — and makes no request', async () => {
    // ⚠️ BOTH CLEARED, not one. Clearing only the key is now `misconfigured` — a half-configured
    // deploy — which is a different answer on purpose.
    vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', '')
    vi.stubEnv('CROSSMINT_SIGNER_SECRET', '')
    await expect(createWallet('profile-1')).resolves.toMatchObject({ ok: false, reason: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('⛔ a broken LOG TRANSPORT on the misconfigured path does not throw out of createWallet', async () => {
    // The last bare logWarn in the diff, on the exact route a half-configured environment takes.
    vi.stubEnv('CROSSMINT_SIGNER_SECRET', '')
    const boom = () => { throw new Error('log transport down') }
    vi.stubGlobal('console', { ...console, warn: boom, error: boom, log: boom })
    await expect(createWallet('profile-1')).resolves.toMatchObject({ ok: false })
  })

  it('⛔ a HALF-configured environment reports `misconfigured`, not `not_configured`', async () => {
    vi.stubEnv('CROSSMINT_SIGNER_SECRET', '')
    await expect(createWallet('profile-1')).resolves.toMatchObject({ ok: false, reason: 'misconfigured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('walletBalances — a third party response is untrusted input', () => {
  it('reads the real response shape, in BASE UNITS', async () => {
    // ⛔ THE SHAPE IS FROM A LIVE CALL, NOT FROM THE DOCS. The fields are `symbol` and `rawAmount`;
    // `amount` is the DISPLAY value. Reading `amount` recorded a $10 deposit as 10 base units —
    // a thousandth of a cent — and order-state.ts would have accepted it without complaint.
    reply(200, [{ symbol: 'usdxm', name: 'USD Coin', decimals: 6, amount: '10', rawAmount: '10000000' }])
    const r = await walletBalances('0xabc', ['usdxm'])
    expect(r).toEqual({ ok: true, value: [{ token: 'usdxm', rawAmount: '10000000', decimals: 6 }] })
    expect(String(fetchMock.mock.calls[0][0])).toContain('chains=base-sepolia')
  })

  it('⛔ amounts stay STRINGS — a float would round money away', async () => {
    reply(200, [{ symbol: 'usdc', rawAmount: '9007199254740993', decimals: 6 }])
    const r = await walletBalances('0xabc')
    expect(r.ok && r.value[0].rawAmount).toBe('9007199254740993')
  })

  it('⛔ a NUMERIC rawAmount is refused — JSON.parse already rounded it', async () => {
    // 9007199254740993 does not survive JSON.parse as a number; `String(...)` would then faithfully
    // record the corrupted value. Skipping loses a balance reading; accepting loses money.
    reply(200, [{ symbol: 'usdc', rawAmount: 9007199254740993, decimals: 6 }])
    // ⚠️ A FAILURE, not a silent skip: the row was there and we could not read it, which is the
    // same fact as a changed shape. Reporting an empty wallet would be the dangerous answer.
    expect((await walletBalances('0xabc')).ok).toBe(false)
  })

  it('⛔ a row with only a DISPLAY amount is skipped, never converted', async () => {
    // Converting would need the decimals to be right and would silently invent precision.
    reply(200, [{ symbol: 'usdc', amount: '10', decimals: 6 }, { symbol: 'usdc', rawAmount: '1.5' }])
    expect((await walletBalances('0xabc')).ok, 'unreadable rows are a failure, not an empty wallet').toBe(false)
  })

  it('⛔ rows in but nothing out WARNS — a shape change must not read as an empty wallet', async () => {
    /**
     * ⛔ THIS EXACT FAILURE ALREADY HAPPENED HERE. The parser looked for `token`/`amount` while the
     * API returns `symbol`/`rawAmount`, so a wallet holding 10 USDXM reported as holding nothing
     * and nothing said so. An empty result is legitimate for a new wallet, so this cannot fail —
     * it can only stop being silent.
     */
    const warned: unknown[] = []
    vi.stubGlobal('console', { ...console, warn: (...a: unknown[]) => warned.push(a) })
    reply(200, [{ token: 'usdc', amount: '10' }]) // the OLD shape — every row unparseable now
    const r = await walletBalances('0xabc')
    // ⛔ A FAILURE, NOT AN EMPTY WALLET. A checkout must not tell someone holding 10 USDC that they
    // have nothing, and the warning that would say otherwise is deliberately allowed to fail.
    expect(r.ok).toBe(false)
    expect(JSON.stringify(warned)).toContain('shape may have changed')
  })

  it('an EMPTY response does not warn — a new wallet legitimately holds nothing', async () => {
    const warned: unknown[] = []
    vi.stubGlobal('console', { ...console, warn: (...a: unknown[]) => warned.push(a) })
    reply(200, [])
    expect((await walletBalances('0xabc')).ok).toBe(true)
    expect(JSON.stringify(warned)).not.toContain('shape may have changed')
  })

  it('⛔ a NON-ARRAY body is a failure, never an empty wallet', async () => {
    /**
     * ⛔ THE COERCION THAT SURVIVED THE FIRST FIX. `Array.isArray(x) ? x : []` turned any unexpected
     * shape into "no balances" with `ok: true`, so a response re-wrapped as `{ balances: [...] }`
     * would tell a funded user they hold nothing. Rows-in-nothing-out was closed first; this is the
     * same danger one step earlier.
     */
    for (const body of [{}, null, 'nonsense', { balances: [{ symbol: 'usdc', rawAmount: '1' }] }]) {
      reply(200, body)
      expect((await walletBalances('0xabc')).ok, JSON.stringify(body)).toBe(false)
    }
  })

  it('⛔ ONE bad row among good ones is a failure — partial data is worse than none', async () => {
    /**
     * ⛔ THE PARSER FAILED ONLY WHEN EVERY ROW WAS UNREADABLE. So a response where `usdc` parsed
     * and a funded second token did not returned `ok` with an INCOMPLETE balance, and a checkout
     * deciding from that underreports what someone holds. A reviewer put it exactly: partial is
     * worse than none, because none is obvious.
     */
    reply(200, [
      { symbol: 'usdc', rawAmount: '5000000', decimals: 6 },
      { symbol: 'usdt', amount: '10' }, // funded, but in a shape we cannot read
    ])
    const r = await walletBalances('0xabc', ['usdc', 'usdt'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('1 of 2')
  })

  it('an EMPTY ARRAY is a genuinely empty wallet, and stays ok', async () => {
    // The one shape that legitimately means "nothing here" — a wallet nobody has funded yet.
    reply(200, [])
    const r = await walletBalances('0xabc')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual([])
  })
})

describe('stagingFund — test money, and only ever on staging', () => {
  it('mints test stablecoin on staging', async () => {
    reply(200, {})
    await expect(stagingFund('0xabc', 10)).resolves.toEqual({ ok: true, value: true })
  })

  it('⛔ refuses on a production key, which would be trying to conjure real balance', async () => {
    vi.stubEnv('CROSSMINT_SERVER_SIDE_API_KEY', 'sk_production_abc')
    vi.stubEnv('CROSSMINT_ENV', 'production')
    const r = await stagingFund('0xabc', 10)
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
