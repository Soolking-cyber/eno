import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Provisioning is a SIDE EFFECT of an approval that is already durable, so what these tests assert
// is mostly what it must never do to the approval: never throw, never hang, never run twice.

const h = vi.hoisted(() => ({
  identity: null as Record<string, unknown> | null,
  readCalls: 0,
  cachedCalls: 0,
  /** When set, the uncached read never settles — a stand-in for a provider that stops answering. */
  hang: false,
  logs: [] as unknown[][],
  throwOnLog: false,
  errors: [] as string[],
  existingWallet: null as { id: string } | null,
  rowsCreated: [] as Record<string, unknown>[],
  createCalls: [] as string[],
  createRowError: null as string | null,
  createRowTarget: ['profileId'] as string[],
  lookupThrows: false,
  lookups: 0,
  walletAfterRace: null as { address: string } | null,
  config: { env: 'staging', chain: 'base-sepolia' } as Record<string, unknown> | null,
  configBroken: false,
  createResult: { ok: true, value: { address: '0xabc0000000000000000000000000000000000001', chain: 'base-sepolia', provider: 'crossmint' } } as Record<string, unknown>,
}))

vi.mock('@/lib/log', () => ({
  logError: (e: unknown) => { h.errors.push(e instanceof Error ? e.message : String(e)) },
  logInfo: (...a: unknown[]) => { if (h.throwOnLog) throw new Error('log transport down'); h.logs.push(['info', ...a]) },
  logWarn: (...a: unknown[]) => { if (h.throwOnLog) throw new Error('log transport down'); h.logs.push(['warn', ...a]) },
}))

vi.mock('@/lib/db', () => ({
  db: {
    custodyWallet: {
      findUnique: async () => {
        if (h.lookupThrows) { const e = new Error('db down') as Error & { code?: string }; e.code = 'P1001'; throw e }
        h.lookups++
        // ⚠️ THE SECOND LOOKUP IS THE POST-P2002 RE-READ, and it must be able to answer differently
        // from the first: that is the whole mechanism for telling a concurrent race from a
        // cross-account collision.
        return h.lookups > 1 ? h.walletAfterRace : h.existingWallet
      },
      create: async (args: { data: Record<string, unknown> }) => {
        if (h.createRowError) {
          const e = new Error('row') as Error & { code?: string; meta?: { target?: string[] } }
          e.code = h.createRowError; e.meta = { target: h.createRowTarget }
          throw e
        }
        h.rowsCreated.push(args.data); return args.data
      },
    },
  },
}))

// ⚠️ THE ADAPTER IS MOCKED, NOT THE NETWORK. Its own suite (crossmint.test.ts) covers the HTTP
// contract against a stubbed fetch; what THIS file has to prove is how each adapter ANSWER maps to
// a provisioning outcome, which is a different question and the one that reached production wrong.
vi.mock('@/lib/payments/crossmint', () => ({
  createWallet: async (profileId: string) => { h.createCalls.push(profileId); return h.createResult },
  crossmintConfig: () => h.config,
  configState: () => (h.config ? 'ok' : h.configBroken ? 'broken' : 'absent'),
}))

/**
 * ⛔ ONLY THE READS ARE STUBBED — `railsFor` IS THE REAL ONE. A reviewer pointed out that stubbing
 * the eligibility helper with a veto-free version meant the write path's nationality and residence
 * vetoes were never exercised in composition here: the gate was covered in identity.test.ts and
 * simply assumed to be wired up correctly in this one. Spreading the actual module keeps the
 * predicate honest and still lets the identity itself be dictated per test.
 */
vi.mock('./identity', async () => {
  const actual = await vi.importActual<typeof import('./identity')>('./identity')
  return {
    ...actual,
    readVerifiedIdentity: async (id: string) => {
      h.readCalls++
      if (h.hang) return new Promise(() => {})
      return h.identity ? { ...h.identity, profileId: id } : null
    },
    verifiedIdentityFor: async () => { h.cachedCalls++; return h.identity },
  }
})

const { provisionForVerifiedIdentity, provisionWithinBudget, PROVISION_BUDGET_MS } =
  await import('./on-verified')

const PROFILE = '11111111-2222-4333-8444-555555555555'

beforeEach(() => {
  h.readCalls = 0; h.cachedCalls = 0; h.hang = false; h.logs = []; h.throwOnLog = false; h.errors = []
  h.existingWallet = null; h.rowsCreated = []; h.createCalls = []; h.createRowError = null
  h.createRowTarget = ['profileId']; h.lookupThrows = false
  h.lookups = 0; h.walletAfterRace = null
  h.config = { env: 'staging', chain: 'base-sepolia' }; h.configBroken = false
  h.createResult = { ok: true, value: { address: '0xabc0000000000000000000000000000000000001', chain: 'base-sepolia', provider: 'crossmint' } }
  // ⚠️ EVERY ELIGIBILITY TEST STUBS THE ALLOW-LIST OPEN. Two reviewers found the denial tests
  // vacuous without it: `PAYMENTS_SETTLEMENT_COUNTRIES` is empty by default, so a gate broken shut
  // passes them exactly as happily as a gate that is working.
  vi.stubEnv('PAYMENTS_SETTLEMENT_COUNTRIES', 'GBR,DEU')
  h.identity = { tier: 'B', nationality: 'GBR', nationalities: ['GBR'], residenceCountry: 'GBR',
                 documentExpiresAt: null, verifiedAt: null, fullName: 'A' }
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('provisionForVerifiedIdentity', () => {
  it('⛔ reads the UNCACHED identity, never the request-memoised one', async () => {
    // ⛔ THE REGRESSION A REVIEWER SAID WOULD PASS GREEN. This runs milliseconds after the approval
    // wrote `verified`, inside the same request — and `verifiedIdentityFor` is `cache()`-wrapped,
    // so an earlier call in that request may already have memoised the PRE-approval `null`.
    // Provisioning would then silently skip every case an admin had looked at before approving.
    // The unit tests mock `cache()` to a pass-through and so cannot see staleness at all; this
    // asserts the call itself instead.
    await provisionForVerifiedIdentity(PROFILE)
    expect(h.readCalls).toBe(1)
    expect(h.cachedCalls).toBe(0)
  })

  it('⛔ does nothing for a profile with no live verification', async () => {
    h.identity = null
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'skipped_unverified' })
  })

  it('⛔ does not provision a wallet where the country rules forbid the rail', async () => {
    // Vietnam's DTI Law legalised holding and trading digital assets but not paying with them, so a
    // settlement wallet for a Vietnamese party is an invitation to the one thing that is not legal.
    h.identity = { ...h.identity, residenceCountry: 'VNM' }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'skipped_ineligible' })
  })

  it('⛔ an unknown residence fails CLOSED — and says WHY, rather than "the law says no"', async () => {
    /**
     * ⚠️ NO WALLET EITHER WAY; WHAT CHANGED IS THE REASON. A reviewer traced the circularity:
     * `residenceCountry`'s only trusted writer is the payment provider's KYC, which runs after the
     * desk approval this hook fires on — so the column is null for essentially every real expat at
     * this moment. Reporting that as `skipped_ineligible` buried the whole user base under the
     * outcome reserved for people who are genuinely barred, and a backfill reading those logs would
     * have found nobody to help.
     */
    h.identity = { ...h.identity, residenceCountry: null }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'awaiting_residence' })
  })

  it('⛔ a BARRED nationality with no residence is NOT "awaiting" — it is refused', async () => {
    /**
     * ⛔ THE ORDERING TWO REVIEWERS FOUND INVERTED. `awaiting_residence` means "eligible, pending",
     * and a Vietnamese or sanctioned national approved on eno.forum also has a null residence at
     * this moment — so they were logged as waiting on the provider, and a backfill keyed on that
     * outcome would re-drive permanently barred people forever while burying the ones genuinely
     * waiting. Never tested in combination until now: VNM+null, not VNM+residence or GBR+null.
     */
    for (const n of ['VNM', 'IRN']) {
      h.identity = { ...h.identity, nationality: n, nationalities: [n], residenceCountry: null }
      expect(await provisionForVerifiedIdentity(PROFILE), n).toEqual({ wallet: 'skipped_ineligible' })
    }
  })

  it('⛔ a dual national with ONE unreadable code is still flagged for review', async () => {
    // `every` made this a settled refusal; `some` makes it the escalation it is.
    h.identity = { ...h.identity, nationality: 'GBR', nationalities: ['GBR', 'GBN'] }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'unmappable_nationality' })
  })

  it('⛔ but a BARRED code alongside an unreadable one is SETTLED, not an open question', async () => {
    /**
     * ⛔ THE LAST ORDERING FINDING, ONE LEVEL IN FROM THE PREVIOUS ONE. `['VNM','GBN']` is barred by
     * the Vietnamese passport whatever `GBN` turns out to mean — but the unreadable check ran first,
     * so a permanently barred person was routed to the review queue as an open question, exactly
     * the corruption `unmappable_nationality` was split out to prevent.
     */
    for (const pair of [['VNM', 'GBN'], ['IRN', 'XXA']]) {
      h.identity = { ...h.identity, nationality: pair[0], nationalities: pair, residenceCountry: null }
      expect(await provisionForVerifiedIdentity(PROFILE), pair.join('+'))
        .toEqual({ wallet: 'skipped_ineligible' })
    }
  })

  it('creates the wallet and records it for someone eligible', async () => {
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'created' })
    expect(h.createCalls).toEqual([PROFILE])
    expect(h.rowsCreated[0]).toMatchObject({
      profileId: PROFILE, provider: 'crossmint', chain: 'base-sepolia',
      address: '0xabc0000000000000000000000000000000000001',
    })
  })

  it('⛔ an existing wallet is ADOPTED, never duplicated — and the provider is not called', async () => {
    // A second approval, a retry after a timeout, and a backfill over already-verified users all
    // reach here. Asking the provider again each time is how one person ends up with three wallets.
    h.existingWallet = { chain: 'base-sepolia', provider: 'crossmint', address: '0xabc' } as never
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'existing' })
    expect(h.createCalls).toEqual([])
  })

  it('⛔ a BROKEN config is `failed` and warns — not "waiting for credentials"', async () => {
    // The early return mapped `absent` and `broken` to the same answer while createWallet mapped
    // them differently, so a half-configured eno.forum deploy told every eligible approval to wait
    // for credentials that had already been supplied, wrongly.
    h.config = null; h.configBroken = true
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'failed' })
    expect(h.logs[0]?.[0]).toBe('warn')
  })

  it('⛔ the race re-read compares the ADDRESS, or the new wallet is orphaned', async () => {
    // If the winning row points at a different address, this call's freshly created provider wallet
    // is unreferenced while we report `existing`.
    h.createRowError = 'P2002'
    h.walletAfterRace = { chain: 'base-sepolia', provider: 'crossmint', address: '0xdifferent' } as never
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'failed' })
  })

  it('⛔ without a usable config, an existing row is NOT declared fine', async () => {
    // The chain check was skipped whenever crossmintConfig() returned null, so a broken environment
    // answered `existing` for a wallet it had no way to validate. Without a config we can neither
    // provision nor check — the honest answer is the one the createWallet path would have given.
    h.config = null
    h.existingWallet = { chain: 'base-sepolia', provider: 'crossmint', address: '0xabc' } as never
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'pending_provider' })
  })

  it('⛔ a wallet on ANOTHER CHAIN is not adopted — it is surfaced', async () => {
    /**
     * ⛔ BOTH EDITIONS SHARE ONE DATABASE, so a profile provisioned while the deploy carried staging
     * keys meets a production deploy later and — matching by profileId alone — answered `existing`
     * forever. The user reads as provisioned while their wallet sits on a testnet nobody can pay
     * them through. `profileId` is unique by design, so a second row is impossible: this needs a
     * human, and the outcome has to say so rather than go quiet.
     */
    h.existingWallet = { chain: 'base-sepolia', provider: 'crossmint', address: '0xabc' } as never
    h.config = { env: 'production', chain: 'base' }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'wrong_chain' })
    expect(h.logs[0]?.[0]).toBe('warn')
  })

  it('⛔ the P2002 RE-READ applies the chain check too, or it defeats wrong_chain', async () => {
    // The recovery path was the one meant to be safe: the winner of a staging/production race could
    // leave the loser reporting `existing` over a wrong-chain row.
    h.createRowError = 'P2002'
    h.walletAfterRace = { chain: 'base-sepolia', provider: 'crossmint', address: '0xabc0000000000000000000000000000000000001' } as never
    h.config = { env: 'production', chain: 'base' }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'wrong_chain' })
  })

  it('⛔ a DB outage AND a broken log transport still returns, never throws', async () => {
    // The recovery branch logged without protection, so the one thing that swallows the outage
    // could itself throw. Both failures at once is the state a reviewer named.
    h.lookupThrows = true
    h.throwOnLog = true
    await expect(provisionForVerifiedIdentity(PROFILE)).resolves.toEqual({ wallet: 'failed' })
  })

  it('⛔ a concurrent approval losing the unique race is `existing`, not an error', async () => {
    // Crossmint is idempotent by owner, so both callers got the SAME address (measured: 201 then
    // 200, same address); the loser of the row insert has not failed at anything. The re-read is
    // what sees the winner's row.
    h.createRowError = 'P2002'
    h.walletAfterRace = { chain: 'base-sepolia', provider: 'crossmint', address: '0xabc0000000000000000000000000000000000001' } as never
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'existing' })
  })

  it('⛔ a DATABASE OUTAGE on the existence check does not propagate', async () => {
    // Two reviewers found the one new read sitting outside every try. The approval survived anyway
    // — provisionWithinBudget and review.ts both catch — but this function states its own
    // never-throws contract, and a backfill calling it directly would have inherited the throw.
    h.lookupThrows = true
    await expect(provisionForVerifiedIdentity(PROFILE)).resolves.toEqual({ wallet: 'failed' })
    expect(h.logs[0]?.[0]).toBe('warn')
  })

  it('⛔ a P2002 is resolved by RE-READING, whatever shape meta.target takes', async () => {
    /**
     * ⛔ TWO ATTEMPTS TO READ THE CONSTRAINT OFF THE ERROR WERE BOTH WRONG. First an array of field
     * names; then, told a string was possible, an exact string match — but `@prisma/adapter-pg` can
     * report the CONSTRAINT NAME (`CustodyWallet_profileId_key`, which fails `includes('profileId')`)
     * or nothing at all, so the ordinary concurrent race took the cross-account branch. Re-reading
     * answers the only question that matters — does THIS profile have a row now — for every driver
     * and every target shape.
     */
    for (const target of [['profileId'], 'CustodyWallet_profileId_key', undefined, ['provider', 'chain', 'address']]) {
      h.lookups = 0; h.createRowError = 'P2002'
      h.createRowTarget = target as unknown as string[]
      h.walletAfterRace = { chain: 'base-sepolia', provider: 'crossmint', address: '0xabc0000000000000000000000000000000000001' } as never // the concurrent approval's row is now visible
      expect(await provisionForVerifiedIdentity(PROFILE), JSON.stringify(target)).toEqual({ wallet: 'existing' })
    }
  })

  it('⛔ a P2002 with STILL no row for this profile is a cross-account collision, not `existing`', async () => {
    // The address belongs to somebody else. Saying `existing` would tell the caller this user has a
    // wallet when they have no row at all, and would bury the anomaly.
    h.createRowError = 'P2002'
    h.walletAfterRace = null
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'failed' })
    expect(h.logs[0]?.[0]).toBe('warn')
  })

  it('⛔ the stored address is LOWERCASED, so casing cannot evade the unique index', async () => {
    // Crossmint returns EIP-55 mixed case; the index is case-sensitive and an EVM address is not.
    h.createResult = { ok: true, value: { address: '0xAbCd000000000000000000000000000000000001', chain: 'base-sepolia', provider: 'crossmint' } }
    await provisionForVerifiedIdentity(PROFILE)
    expect(h.rowsCreated[0].address).toBe('0xabcd000000000000000000000000000000000001')
  })

  it('⛔ a wallet created at the provider but NOT recorded is `failed` AND logged with its address', async () => {
    // The dangerous state: a wallet exists that we cannot address. It must be reconcilable by hand.
    h.createRowError = 'P1001'
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'failed' })
    expect(JSON.stringify(h.logs)).toContain('0xabc0000000000000000000000000000000000001')
  })

  it('⚠️ no credentials is `pending_provider` — the ordinary state, not a failure to chase', async () => {
    h.createResult = { ok: false, reason: 'not_configured' }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'pending_provider' })
  })

  it('⛔ a provider refusal or outage is `failed`, and warns', async () => {
    for (const reason of ['provider_rejected', 'provider_unreachable']) {
      h.logs = []
      h.createResult = { ok: false, reason, detail: 'boom' }
      expect(await provisionForVerifiedIdentity(PROFILE), reason).toEqual({ wallet: 'failed' })
      expect(h.logs[0]?.[0], reason).toBe('warn')
    }
  })

  it('⛔ a DUAL NATIONAL with a Vietnamese passport is refused on the WRITE path too', async () => {
    // ⚠️ THE COMPOSITION TEST. identity.test.ts proves the veto; this proves provisioning actually
    // asks for it, which is what a stubbed helper used to hide.
    h.identity = { ...h.identity, nationality: 'GBR', nationalities: ['GBR', 'VNM'] }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'skipped_ineligible' })
  })

  it('⛔ and so is a SANCTIONED nationality anywhere in the history', async () => {
    h.identity = { ...h.identity, nationality: 'GBR', nationalities: ['GBR', 'IRN'] }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'skipped_ineligible' })
  })

  it('⛔ an UNREADABLE nationality is reported as such, not as a lawful refusal', async () => {
    // The two need opposite responses: one is settled, the other is a person waiting on a decision
    // nobody knows they need to make. Reported identically, they were indistinguishable in the logs.
    h.identity = { ...h.identity, nationality: 'GBN', nationalities: ['GBN'] }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'unmappable_nationality' })

    h.identity = { ...h.identity, nationality: 'VNM', nationalities: ['VNM'] }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'skipped_ineligible' })
  })

  it('⛔ and it WARNS, so those users can be found', async () => {
    h.identity = { ...h.identity, nationality: 'XXA', nationalities: ['XXA'] }
    await provisionWithinBudget(PROFILE)
    expect(h.logs[0]?.[0]).toBe('warn')
  })

  it('⛔ with NO allow-list configured, nobody is "barred by law" — that is OUR state', async () => {
    /**
     * ⛔ THE LIVE PRODUCTION CONDITION, AND NO TEST COULD SEE IT. `PAYMENTS_SETTLEMENT_COUNTRIES` is
     * empty until counsel supplies a list, and every other test in this file stubs it open in
     * `beforeEach` — so a reviewer had to find by reading that the probe introduced to fix the
     * previous mislabelling had recreated it wholesale: with no probe, a perfectly eligible British
     * resident was recorded as `skipped_ineligible`, the outcome documented as "settled, never
     * re-drive". The entire early user base written off by a missing environment variable.
     */
    vi.unstubAllEnvs()
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'awaiting_allowlist' })
  })

  it('⛔ and it does NOT warn — it is expected, not a problem to chase', async () => {
    vi.unstubAllEnvs()
    await provisionWithinBudget(PROFILE)
    expect(h.logs[0]?.[0]).toBe('info')
  })

  it('⛔ a LAWFUL but unopened country is "not yet", not "the law says no"', async () => {
    /**
     * ⛔ THE EMPTY-LIST FIX HAD THE SAME DEFECT ONE LEVEL DEEPER. With the list set to GBR,DEU, a
     * verified Dutch national resident in NLD was reported as `skipped_ineligible` — documented as
     * "settled, never re-drive" — when the truth is that counsel has not added NLD yet. The day
     * they do, a backfill keyed on outcomes would skip exactly the people it exists for.
     */
    h.identity = { ...h.identity, nationality: 'NLD', nationalities: ['NLD'], residenceCountry: 'NLD' }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'awaiting_jurisdiction' })
  })

  it('⛔ but a country the law forbids stays SETTLED', async () => {
    for (const c of ['VNM', 'IRN']) {
      h.identity = { ...h.identity, nationality: 'GBR', nationalities: ['GBR'], residenceCountry: c }
      expect(await provisionForVerifiedIdentity(PROFILE), c).toEqual({ wallet: 'skipped_ineligible' })
    }
  })

  it('⛔ a provider FAILURE keeps its cause, not just the word "failed"', async () => {
    // The bare `catch {}` dropped the error, and review.ts's outer logError can never fire because
    // this function guarantees it will not — so the first real failure logged nothing diagnosable.
    h.identity = { nationalities: { get length() { throw new Error('provider exploded') } } }
    expect(await provisionWithinBudget(PROFILE)).toEqual({ wallet: 'failed' })
    expect(h.errors.some((e) => String(e).includes('provider exploded'))).toBe(true)
  })

  it('⛔ a barred RESIDENCE settles it even when the nationality is unreadable', async () => {
    /**
     * ⛔ THE OTHER HALF OF "PROHIBITION OUTRANKS UNREADABLE", applied to nationality and not to
     * residence. A stateless traveller (`XXA`) living in Vietnam on a TRC was escalated to counsel
     * as an open question, when their residence already bars them and no ruling on `XXA` could
     * reopen it. Plausible person, and the queue they landed in is the one for real decisions.
     */
    h.identity = { ...h.identity, nationality: 'XXA', nationalities: ['XXA'], residenceCountry: 'VNM' }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'skipped_ineligible' })

    h.identity = { ...h.identity, nationality: 'GBR', nationalities: ['GBR', 'GBN'], residenceCountry: 'VNM' }
    expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'skipped_ineligible' })
  })

  describe('⛔ why the rail is closed — the taxonomy, in the states no ordering got right', () => {
    /**
     * ⛔ EVERY CASE HERE WAS A REAL DEFECT IN SOME ROUND. The block started as a sequence of probes
     * and each reordering fixed one row of this table while breaking another; all three reviewer
     * families landed on the same diff at once. It is now a classification, so these are simply
     * enumerable rather than order-dependent.
     */
    const cases: Array<[string, Record<string, unknown>, string, string]> = [
      ['barred nationality, unopened residence', { nationalities: ['VNM'], residenceCountry: 'NLD' },
        'skipped_ineligible', 'was awaiting_jurisdiction — a VN passport enqueued for retry forever'],
      ['sanctioned nationality, unopened residence', { nationalities: ['IRN'], residenceCountry: 'NLD' },
        'skipped_ineligible', 'same shape, sanctioned instead of Vietnamese'],
      ['lawful but unopened RESIDENCE', { nationalities: ['NLD'], residenceCountry: 'NLD' },
        'awaiting_jurisdiction', 'was skipped_ineligible — couldBeAllowListed was applied nowhere'],
      ['lawful unopened nationality, no residence yet', { nationalities: ['NLD'], residenceCountry: null },
        'awaiting_residence', 'was skipped_ineligible — never reached the residence branch'],
      ['NO nationality on record', { nationalities: [], residenceCountry: 'GBR' },
        'unmappable_nationality', 'fell through to "barred by law"; identity.test.ts built this state, this file never did'],
      ['unreadable nationality, barred residence', { nationalities: ['XXA'], residenceCountry: 'VNM' },
        'skipped_ineligible', 'was escalated to counsel though residence already settles it'],
      ['barred + unreadable together', { nationalities: ['VNM', 'GBN'], residenceCountry: null },
        'skipped_ineligible', 'the prohibition outranks the open question'],
      ['readable and lawful, waiting on the provider', { nationalities: ['GBR'], residenceCountry: null },
        'awaiting_residence', 'the ordinary state of essentially every real expat at approval time'],
    ]

    for (const [name, over, expected, why] of cases) {
      it(`${name} → ${expected}`, async () => {
        h.identity = { ...h.identity, nationality: (over.nationalities as string[])[0] ?? null, ...over }
        expect(await provisionForVerifiedIdentity(PROFILE), why).toEqual({ wallet: expected })
      })
    }

    it('a foreign national resident in an OPENED country is simply eligible', async () => {
      // ⚠️ MEASURED, NOT ASSUMED. A reviewer reported this as wrongly refused; the gate checks the
      // allow-list for RESIDENCE and asks only that nationality be known, ISO and not Vietnamese or
      // sanctioned. A Dutch national living in Britain never reaches the diagnosis at all.
      h.identity = { ...h.identity, nationality: 'NLD', nationalities: ['NLD'], residenceCountry: 'GBR' }
      expect(await provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'created' })
    })

    it('⛔ and with NO list configured, a BARRED user is still barred — not "awaiting"', async () => {
      // The empty-list branch returned before any prohibition was consulted, so in the live
      // configuration every Vietnamese and sanctioned national was queued for retry.
      vi.unstubAllEnvs()
      for (const n of ['VNM', 'IRN']) {
        h.identity = { ...h.identity, nationality: n, nationalities: [n], residenceCountry: null }
        expect(await provisionForVerifiedIdentity(PROFILE), n).toEqual({ wallet: 'skipped_ineligible' })
      }
    })
  })

  it('⛔ a THROWING logger cannot break the never-throws contract', async () => {
    // ⛔ REPLACES A VACUOUS IDEMPOTENCY TEST. A reviewer pointed out that asserting "the same call
    // twice gives the same answer" proves nothing while the function returns a constant — it would
    // pass just as well for an implementation that created two wallets. This asserts something the
    // code can actually get wrong: the round-three fix moved the logging INSIDE a try, and without
    // a test it could be hoisted back out and stay green.
    h.throwOnLog = true
    await expect(provisionWithinBudget(PROFILE)).resolves.toEqual({ wallet: 'created' })
  })
})

describe('⛔ the marketplace edition provisions nothing at all', () => {
  it('⛔ stops BEFORE reading the identity, let alone creating a wallet', async () => {
    /**
     * ⛔ THE ROUND-THREE DEFECT, FOUND BY TWO REVIEWERS INDEPENDENTLY. Round two put every
     * settlement CAPABILITY behind IS_SERVICES and left this write path open, so eno.vn — which is
     * deliberately paymentless and legally may not carry PayPal — still ran the whole wallet path
     * on every KYC approval. It was harmless only because the adapter does not exist yet.
     */
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.resetModules()
    const fresh = await import('./on-verified')
    expect(await fresh.provisionForVerifiedIdentity(PROFILE)).toEqual({ wallet: 'skipped_edition' })
    expect(h.readCalls, 'must not even read the identity').toBe(0)
    /**
     * ⛔ AND NOT THE WALLET TABLE EITHER. A reviewer claimed twice that `IS_SERVICES` was imported
     * but never checked, so eno.vn would adopt a forum wallet out of the SHARED database. It is
     * checked, first — but "the identity was not read" did not say so about custody, and the two
     * editions really do share one database, so the claim deserved a direct answer rather than an
     * adjacent one.
     */
    expect(h.lookups, 'must not touch the custody table').toBe(0)
    expect(h.createCalls, 'must not reach the provider').toEqual([])
  })
})

describe('provisionWithinBudget — the approval must survive the provider', () => {
  it('⛔ a HANGING provider resolves to timed_out instead of holding the admin request', async () => {
    // ⛔ WHAT try/catch COULD NOT DO, and all three reviewers found it. A throw is caught; a promise
    // that never settles is not. Unbounded, this would hold the approval request open until the
    // gateway gave up — showing the admin a 504 on a case that IS verified, whose retry then
    // returns `not_pending`. The approval looks failed when only the side effect failed.
    vi.useFakeTimers()
    h.hang = true
    const p = provisionWithinBudget(PROFILE)
    await vi.advanceTimersByTimeAsync(PROVISION_BUDGET_MS + 1)
    expect(await p).toEqual({ wallet: 'timed_out' })
  })

  it('⛔ never throws, whatever the provider does', async () => {
    h.identity = { nationalities: { get length() { throw new Error('provider exploded') } } }
    await expect(provisionWithinBudget(PROFILE)).resolves.toEqual({ wallet: 'failed' })
  })

  it('passes a fast answer straight through', async () => {
    h.identity = null
    expect(await provisionWithinBudget(PROFILE)).toEqual({ wallet: 'skipped_unverified' })
  })

  it('⛔ every outcome leaves a log line, or nothing can enumerate the failures', async () => {
    // ⛔ THE ROUND-TWO FIX HAD NO TEST, so a reviewer pointed out both log lines could be deleted
    // and the suite would stay green — re-creating the very defect they were added for.
    h.identity = null
    await provisionWithinBudget(PROFILE)
    expect(h.logs.map((l) => l[0])).toEqual(['info'])

    h.logs = []
    vi.useFakeTimers()
    h.hang = true
    const p = provisionWithinBudget(PROFILE)
    await vi.advanceTimersByTimeAsync(PROVISION_BUDGET_MS + 1)
    await p
    expect(h.logs[0]?.[0], 'a timeout must WARN, not whisper').toBe('warn')
    expect(JSON.stringify(h.logs[0])).toContain('timed_out')
  })

  it('⛔ leaves no pending timer behind on the fast path', async () => {
    // An 8s timer left armed keeps the event loop busy after the request is done — billed time and
    // a held-open invocation in a serverless runtime.
    vi.useFakeTimers()
    h.identity = null
    await provisionWithinBudget(PROFILE)
    expect(vi.getTimerCount()).toBe(0)
  })
})
