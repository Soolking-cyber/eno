import 'server-only'
import { readVerifiedIdentity, railsFor, isoNationality, type VerifiedIdentity } from './identity'
import { logError, logInfo, logWarn } from '@/lib/log'
import { db } from '@/lib/db'
import { createWallet, crossmintConfig, configState, type CrossmintConfig } from '@/lib/payments/crossmint'
import { settlementAllowedCountries, couldBeAllowListed } from '@/lib/payments/eligibility'
import { IS_SERVICES } from '@/lib/edition'

/**
 * WHAT HAPPENS THE MOMENT SOMEONE BECOMES VERIFIED.
 *
 * Owner, 2026-08-30: *"once we get kyc from user it should auto create wallet"*. A user who has
 * just proved who they are should not then have to go and ask for the thing the proof was for.
 *
 * ⛔ IT NEVER FAILS THE REVIEW. Everything here is best-effort and runs AFTER the verification is
 * written: an admin approving a case must not see it fail because a wallet provider timed out, and
 * a user must not end up rejected because of a network blip on a side effect. The approval is the
 * durable fact; provisioning is a consequence that can be retried.
 *
 * ⚠️ SO IT MUST BE IDEMPOTENT AND RE-RUNNABLE. A retry, a second approval of a re-submitted case,
 * or a backfill over existing verified users all call this and must converge on the same state
 * rather than creating a second wallet. That is why each step asks "does this already exist" first
 * and why nothing here writes the verification row.
 */

export type ProvisionOutcome = {
  wallet:
    | 'created'
    | 'existing'
    /** Verified, but the country rules do not allow this party on the wallet rail. */
    | 'skipped_ineligible'
    /** This build is the marketplace, which has no settlement layer at all. */
    | 'skipped_edition'
    /**
     * ⛔ THIS PROFILE ALREADY HOLDS A WALLET ON ANOTHER CHAIN — typically a staging wallet met by a
     * production deploy, which is reachable because both editions share one database. `profileId`
     * is unique, so a second row cannot be created; this needs a human, not a retry.
     */
    | 'wrong_chain'
    /**
     * ⚠️ THIS PERSON'S COUNTRY IS LAWFUL BUT NOT YET OPENED — again our configuration, not them.
     * A reviewer found the empty-list fix left the same defect one level deeper: a verified Dutch
     * national resident in NLD, with the list set to `GBR,DEU`, was reported as `skipped_ineligible`
     * — "the law says no, never re-drive" — when the truth is that counsel simply has not added
     * NLD. The day they do, a backfill keyed on outcomes would skip exactly those users.
     */
    | 'awaiting_jurisdiction'
    /**
     * ⚠️ NO JURISDICTION IS OPEN YET — our configuration, not this person's circumstances.
     * `PAYMENTS_SETTLEMENT_COUNTRIES` is empty until counsel supplies a list, which is the live
     * state today, so this is what essentially every approval returns right now. Distinct from
     * `skipped_ineligible` because that one means "settled, never re-drive" and this one means
     * "ask again the day the list lands".
     */
    | 'awaiting_allowlist'
    /**
     * ⛔ NOBODY HAS VERIFIED WHERE THIS PERSON LIVES YET — the ordinary state, not a refusal, and
     * NOT `skipped_ineligible`. A reviewer traced the circularity: `residenceCountry`'s only
     * trusted writer is the payment provider's own KYC, which runs LATER than the desk approval
     * this hook fires on. So at approval time the column is null for essentially every real expat,
     * and reporting that as "the law says no" would bury the entire user base under the outcome
     * reserved for people who are genuinely barred.
     */
    | 'awaiting_residence'
    /**
     * ⚠️ A NATIONALITY WE CANNOT ASSESS, NOT A LAW THAT SAYS NO. Distinguished from
     * `skipped_ineligible` because the two need opposite responses: one is settled, the other is a
     * person waiting on a decision nobody knows they need to make.
     */
    | 'unmappable_nationality'
    /** No live verification — nothing to provision against. */
    | 'skipped_unverified'
    /**
     * ⚠️ ELIGIBLE, AND THE PROVIDER IS NOT CONFIGURED HERE — not an error and not a skip. The
     * adapter exists now, but an environment without `CROSSMINT_SERVER_SIDE_API_KEY` and a signer
     * secret cannot create anything. Reporting `failed` would send an eligible user to a retry that
     * cannot succeed; reporting `skipped_ineligible` would be false about the law.
     */
    | 'pending_provider'
    /** The provider did not answer inside the approval's budget — see provisionWithinBudget. */
    | 'timed_out'
    | 'failed'
}

/**
 * WHY THE RAIL IS CLOSED — a diagnosis, run only after `railsFor` has already said no.
 *
 * ⛔ THE OUTCOME IS NOT COSMETIC: `skipped_ineligible` is documented "settled, never re-drive" and
 * every `awaiting_*` means "come back to this person later". Getting one wrong either strands
 * somebody permanently or puts a legally barred user into a retry queue forever.
 *
 * ⛔ AND IT IS A CLASSIFICATION, NOT A SEQUENCE OF PROBES — THAT SHAPE WAS THE BUG. Four review
 * rounds were spent moving checks in front of one another, and each reordering created the next
 * defect: a barred nationality reported as awaiting configuration, a lawful-but-unopened country
 * reported as forbidden, an empty nationality list falling through to "barred". All three families
 * landed on the same diff at once. Asking three INDEPENDENT questions and combining them by
 * severity has no order to get wrong.
 *
 * ⚠️ IT STILL OWNS NO RULES. "Lawful" is `couldBeAllowListed`, extracted from the same filter
 * `settlementAllowedCountries()` applies; "readable" is the ISO mapping; the GATE itself remains
 * `railsFor`. This only explains an answer eligibility.ts already gave.
 */
function whyClosed(identity: VerifiedIdentity): ProvisionOutcome['wallet'] {
  const nationalities = identity.nationalities
  const iso = nationalities.map((n) => isoNationality(n))

  // ⛔ BARRED BEATS EVERYTHING. A readable country that could never be allow-listed is Vietnam or a
  // sanctioned jurisdiction — settled, and no later configuration change reopens it.
  const barredNationality = iso.some((n) => n !== null && !couldBeAllowListed(n))
  const barredResidence = identity.residenceCountry !== null && !couldBeAllowListed(identity.residenceCountry)
  if (barredNationality || barredResidence) return 'skipped_ineligible'

  // ⛔ THEN UNREADABLE, which is an open question for counsel rather than a decision. `nationalities`
  // being EMPTY counts: a party with no nationality on record cannot be assessed either, and that
  // state fell through to "barred by law" until a reviewer built it.
  if (nationalities.length === 0 || iso.some((n) => n === null)) return 'unmappable_nationality'

  // ⚠️ EVERYTHING BELOW IS US, NOT THEM — each is re-drivable the day the blocking fact changes.
  if (identity.residenceCountry === null) return 'awaiting_residence'
  const open = settlementAllowedCountries()
  if (open.size === 0) return 'awaiting_allowlist'
  /**
   * ⚠️ RESIDENCE ONLY — NATIONALITY IS NOT ALLOW-LIST GATED, AND MODELLING IT AS IF IT WERE WAS A
   * BUG THIS FUNCTION BRIEFLY CARRIED. A reviewer reported a Dutch national resident in an opened
   * country as wrongly refused; measuring it showed the opposite — `isSettlementEligibleParty`
   * checks the list for `residence` and asks only that `nationality` be known, ISO and not
   * Vietnamese or sanctioned. So that person is eligible and never reaches this function, and the
   * extra clause added to "fix" them was dead code asserting a rule that does not exist. Explaining
   * a gate means reading the gate, not the report of it.
   */
  if (!open.has(identity.residenceCountry)) return 'awaiting_jurisdiction'

  /**
   * ⚠️ UNREACHABLE VIA `railsFor` TODAY, AND REPORTED AS SETTLED RATHER THAN GUESSED AT. Reaching
   * here means eligibility.ts refused for a reason this function does not model — a rule added
   * there without a matching case here. Defaulting to an `awaiting_*` would quietly enqueue people
   * against a rule nobody has read.
   */
  return 'skipped_ineligible'
}

/**
 * Provision everything a fresh verification unlocks.
 *
 * ⚠️ CALLED WITH THE PROFILE, NOT THE CASE. The consumer of a verification is the PERSON; a case is
 * how they proved it. Passing the case id would tie provisioning to one review and make the
 * backfill path different from the live one.
 */
/**
 * ⛔ EVERY QUESTION THAT MUST BE ANSWERED *BEFORE* A WALLET IS CREATED — edition, verification,
 * country, provider config, and whether a row already exists. Extracted so the READ path and the
 * WRITE path cannot answer them differently.
 *
 * ⚠️ THIS EXTRACTION IS THE FIX FOR A REVIEWER FINDING, NOT A TIDY-UP. The wallet page needs to
 * tell a user WHY they have no wallet, and the only function that knew was the one that also
 * CREATES one — so a GET would either have had a side effect or have re-implemented the ladder
 * beside it. codex, reviewing the plan: exporting the classifier is right "provided GET obtains the
 * same authoritative identity data and preserves the classifier's precedence rules". One function,
 * called by both, is the only version of that which cannot drift.
 *
 * `blocked: null` means "eligible, verified, configured, and no wallet exists yet" — the single
 * state in which creating one is correct.
 */
export type WalletGate =
  | { blocked: ProvisionOutcome['wallet']; cfg: null }
  | { blocked: null; cfg: CrossmintConfig }

export async function walletGate(profileId: string): Promise<WalletGate> {
  // ⛔ THE UNCACHED READ. This runs milliseconds after the approval wrote `verified`, and the
  // request may already have cached the pre-approval answer — see readVerifiedIdentity.
  /**
   * ⛔ THE MARKETPLACE HAS NO SETTLEMENT LAYER, SO IT PROVISIONS NOTHING — AND THIS GATE WAS THE
   * ROUND-THREE DEFECT. Round two moved every settlement CAPABILITY behind `IS_SERVICES` and left
   * this, the WRITE path, ungated: on eno.vn an admin approving a KYC case still ran the whole
   * wallet path. It returned a harmless `pending_provider` only because the adapter does not exist
   * — and this file says the provider call "drops in exactly here", so the day it lands, a licensed
   * sàn TMĐT starts auto-creating settlement wallets. Two reviewers found it independently.
   * ⚠️ THE READ MODEL AND THIS PATH MUST ASK THE SAME TWO QUESTIONS, edition AND country. Asking
   * one in each place is exactly the drift the shared predicate was supposed to end.
   */
  if (!IS_SERVICES) return { blocked: 'skipped_edition', cfg: null }

  const identity = await readVerifiedIdentity(profileId)
  if (!identity) return { blocked: 'skipped_unverified', cfg: null }

  /**
   * ⛔ A WALLET IS ONLY CREATED WHERE IT COULD LAWFULLY BE USED. Holding stablecoins is legal in
   * Vietnam since the DTI Law; PAYING with them is not. Provisioning a settlement wallet for a
   * Vietnamese party would therefore be legal in itself and an invitation to the one thing that is
   * not — so the same gate that decides whether the rail may settle decides whether the wallet is
   * created at all. One predicate, asked twice, rather than two rules that can drift apart.
   *
   * ⚠️ THE PARTY IS CHECKED AGAINST ITSELF because `railAllowed` reasons about a TRADE and this is
   * a single person. Both sides being the same identity is the honest way to ask "could this party
   * ever be on this rail", and it costs nothing.
   */
  // ⛔ THE SAME PREDICATE THE READ MODEL USES, asked the same way — every nationality on record, not
  // a summary of them. See partiesFor: squeezing a dual national into one value was round five's
  // defect, and asking here differently from identityCapabilities is how the two would drift.
  if (!railsFor(identity).includes('crossmint')) return { blocked: whyClosed(identity), cfg: null }

  /**
   * ⛔ THE EXISTING ROW IS CHECKED FIRST, AND THAT IS WHAT MAKES THIS SAFE TO RE-RUN. A second
   * approval, a retry after a timeout, or a backfill over already-verified users all reach here;
   * without this they would ask the provider for another wallet each time. Crossmint is idempotent
   * by owner as well, so the two guards overlap on purpose — the row can be MISSING while the
   * wallet exists (a crash between the provider call and the insert), and that case has to
   * converge rather than duplicate.
   */
  /**
   * ⛔ THE CONFIG IS RESOLVED BEFORE THE ROW IS TRUSTED. A reviewer found the chain check silently
   * skipped whenever `crossmintConfig()` returned null: an environment with missing or broken
   * credentials would answer `existing` for a wallet it had no way to validate — possibly on
   * another chain, possibly from another provider. Without a config we cannot provision and cannot
   * check, so the honest answer is the one the createWallet path would have given anyway.
   */
  const state = configState()
  // ⚠️ `absent` AND `broken` ARE DIFFERENT ANSWERS, and mapping them the same here contradicted the
  // mapping a few lines below. `configState` exists so there is only one of them.
  if (state === 'absent') return { blocked: 'pending_provider', cfg: null }
  if (state === 'broken') {
    warn('crossmint is configured but unusable — an eligible user is blocked on a broken deploy', {
      at: 'kyc.provision.config', profileId,
    })
    return { blocked: 'failed', cfg: null }
  }
  const cfg = crossmintConfig()!

  try {
    const existing = await db.custodyWallet.findUnique({
      where: { profileId }, select: { chain: true, provider: true, address: true },
    })
    if (existing) {
      /**
       * ⛔ ADOPTED ONLY IF IT IS ON THE CHAIN WE ARE ACTUALLY SETTLING ON. This matched by
       * `profileId` alone, and a reviewer traced what that costs given two facts this codebase
       * already states: the chain is part of a wallet's identity, and BOTH EDITIONS SHARE ONE
       * DATABASE. A profile provisioned while the deploy carried staging keys — which `stagingFund`
       * exists to make easy — would answer `existing` forever once production keys landed. The user
       * reads as provisioned; their wallet is on a testnet nobody can pay them through.
       * ⚠️ IT CANNOT BE FIXED BY CREATING A SECOND ROW: `profileId` is unique, deliberately. So the
       * honest answer is a distinct outcome that says so loudly rather than a silent `existing`.
       */
      if (existing.chain !== cfg.chain || existing.provider !== 'crossmint') {
        warn('profile holds a wallet on a different chain — it cannot settle here', {
          at: 'kyc.provision.chain', profileId, held: existing.chain, expected: cfg.chain,
          provider: existing.provider,
        })
        return { blocked: 'wrong_chain', cfg: null }
      }
      return { blocked: 'existing', cfg: null }
    }
  } catch (e) {
    /**
     * ⛔ THE ONE DATABASE READ WAS THE ONE UNGUARDED STATEMENT, and two reviewers found it. This
     * function's contract is that it never propagates — the caller is an admin approving a case —
     * and a transient DB error here would have rejected straight out of it. `provisionWithinBudget`
     * and review.ts both catch as well, so the approval survived either way; what did not survive
     * was the contract this file states about itself, and a future backfill calling
     * `provisionForVerifiedIdentity` directly would have inherited the throw.
     */
    warn('could not check for an existing wallet', {
      at: 'kyc.provision.lookup', profileId, code: (e as { code?: string })?.code,
    })
    return { blocked: 'failed', cfg: null }
  }

  return { blocked: null, cfg }
}

export async function provisionForVerifiedIdentity(profileId: string): Promise<ProvisionOutcome> {
  const gate = await walletGate(profileId)
  if (gate.blocked) return { wallet: gate.blocked }
  // ⚠️ CARRIED OUT OF THE GATE, NOT RE-RESOLVED. The race branch below compares the winning row's
  // chain against the one we settle on, and reading the config a second time would let an env
  // change between the two reads answer that comparison against a chain we never created on.
  const cfg = gate.cfg

  const created = await createWallet(profileId)
  if (!created.ok) {
    /**
     * ⚠️ THE PROVIDER'S REFUSAL IS TRANSLATED, NOT PASSED THROUGH. `not_configured` is the ordinary
     * state of an environment without keys and must not read as a failure someone should chase;
     * everything else is a real failure worth a warning. The adapter never throws, so there is
     * nothing to catch here — a network error already arrived as `provider_unreachable`.
     */
    if (created.reason === 'not_configured') return { wallet: 'pending_provider' }
    if (created.reason === 'wrong_edition') return { wallet: 'skipped_edition' }
    warn('wallet provider refused', { at: 'kyc.provision.create', profileId, reason: created.reason, detail: created.detail })
    return { wallet: 'failed' }
  }

  /**
   * ⛔ THE WALLET EXISTS AT THE PROVIDER BEFORE THIS ROW EXISTS HERE, and the failure that matters
   * is losing the pointer to it. That is `failed`, logged with the address so it can be reconciled
   * by hand.
   * ✅ AND THE RETRY GENUINELY RECOVERS — MEASURED, NOT ASSUMED. Creating twice for the same owner
   * on Crossmint staging returned 201 then 200 with the SAME address, so a crash between the
   * provider call and this insert is repaired by simply running provisioning again. A reviewer was
   * right to challenge the claim; the check is what turned it from an assumption into a fact.
   */
  /**
   * ⛔ LOWERCASED BEFORE STORAGE, because the unique index is case-SENSITIVE and an EVM address is
   * not. Crossmint returns EIP-55 checksummed mixed case (measured: `0x89DD714793278cA2FA8D477…`);
   * if it ever answered the same address in another casing, `(provider, chain, address)` would see
   * two different values and the same wallet could be recorded against two profiles. A reviewer
   * found the tests only ever used lowercase. The checksum is a typo guard, not identity — the
   * adapter has already validated the shape.
   */
  const address = created.value.address.toLowerCase()

  try {
    await db.custodyWallet.create({
      data: { profileId, provider: created.value.provider, chain: created.value.chain, address },
    })
    return { wallet: 'created' }
  } catch (e) {
    const err = e as { code?: string; meta?: { target?: unknown } }
    /**
     * ⛔ WHICH UNIQUE CONSTRAINT FIRED MATTERS — AND THE ANSWER COMES FROM THE DATABASE, NOT FROM
     * PARSING THE ERROR. `CustodyWallet` has two: `profileId`, and `(provider, chain, address)`. A
     * `profileId` collision is benign, a concurrent approval that Crossmint answered with the same
     * address (measured: 201 then 200, same address). A collision on the ADDRESS means the provider
     * handed us a wallet already recorded against a DIFFERENT profile — an anomaly that must not be
     * reported as this user having a wallet.
     *
     * ⚠️ TWO ATTEMPTS TO READ IT OFF `meta.target` WERE BOTH WRONG, which is why this asks instead.
     * First it assumed an array of field names; then, told a string is possible, it wrapped the
     * string and matched exactly — but under `@prisma/adapter-pg` the value can be the CONSTRAINT
     * NAME (`CustodyWallet_profileId_key`, which fails `includes('profileId')`) or absent entirely,
     * so the ordinary race would have taken the cross-account branch. A reviewer found the second
     * version still broken. Re-reading answers the only question that actually matters — does THIS
     * profile have a row now — for every driver, every target shape, and no string handling at all.
     */
    if (err.code === 'P2002') {
      const settled = await db.custodyWallet
        .findUnique({ where: { profileId }, select: { chain: true, provider: true, address: true } })
        .catch(() => null)
      /**
       * ⚠️ THE RE-READ GETS THE SAME CHAIN CHECK AS ADOPTION, or it quietly defeats it. A reviewer
       * spotted that the winner of a staging/production race could leave the loser reporting
       * `existing` over a wrong-chain row — the exact state `wrong_chain` was added to surface,
       * reachable through the recovery path that was meant to be the safe one.
       */
      if (settled) {
        /**
         * ⛔ THE ADDRESS IS COMPARED TOO. A reviewer spotted the re-read selecting only chain and
         * provider: if the winning row pointed at a DIFFERENT address, this call's freshly created
         * provider wallet would be orphaned while we reported `existing`. Crossmint is idempotent
         * by owner, so the addresses SHOULD match — which is exactly why a mismatch is worth
         * shouting about rather than assuming away.
         */
        // ⚠️ BOTH SIDES LOWERCASED. New rows are written lowercase, but a row that predates that —
        // or one inserted by hand — would otherwise fail this comparison on casing alone and turn a
        // benign race into a `failed`.
        if (settled.address.toLowerCase() !== address) {
          warn('the winning row of a provisioning race holds a DIFFERENT address', {
            at: 'kyc.provision.race-address', profileId, held: settled.address, created: address,
          })
          return { wallet: 'failed' }
        }
        if (settled.chain !== cfg.chain || settled.provider !== 'crossmint') {
          warn('the winning row of a provisioning race is on a different chain', {
            at: 'kyc.provision.race-chain', profileId, held: settled.chain, expected: cfg.chain,
          })
          return { wallet: 'wrong_chain' }
        }
        return { wallet: 'existing' }
      }
      warn('wallet address already recorded against another profile — do not retry blindly', {
        at: 'kyc.provision.collision', profileId, address, target: err.meta?.target,
      })
      return { wallet: 'failed' }
    }
    warn('wallet created at provider but NOT recorded — reconcile by address', {
      at: 'kyc.provision.record', profileId, address, chain: created.value.chain, code: err.code,
    })
    return { wallet: 'failed' }
  }
}

/**
 * ⛔ THE BOUND ON THE PROVIDER, AND IT IS NOT OPTIONAL. All three reviewers found the same hole:
 * `try/catch` stops a THROW, but nothing stops a HANG — and this runs inside the admin's approval
 * request. A wallet provider that never answers would hold that request open until the gateway
 * gives up, showing the admin a 504 on a case that IS verified, whose retry then returns
 * `not_pending`. The approval looks like it failed and cannot be re-driven; only the side effect
 * actually failed.
 *
 * ⚠️ SO THE TIMEOUT PROTECTS THE APPROVAL, NOT THE WALLET. Losing the race means the user has no
 * wallet yet and `provisionForVerifiedIdentity` is re-runnable — it is idempotent precisely so this
 * is recoverable. Losing the approval would mean an admin re-reviewing a decided case.
 */
/**
 * ⚠️ A LOG IN A RECOVERY BRANCH MUST NOT BE ABLE TO UNDO THE RECOVERY. `provisionWithinBudget`
 * already wrapped its own logging after a reviewer pointed out the irony; the same reviewer then
 * found every `logWarn` inside `provisionForVerifiedIdentity`'s catch branches still bare, so a
 * database outage PLUS a broken log transport threw out of the function that exists to swallow it.
 */
function warn(message: string, ctx: Record<string, unknown>): void {
  try { logWarn(message, ctx) } catch { /* a lost log line must never cost more than itself */ }
}

export const PROVISION_BUDGET_MS = 8_000

export async function provisionWithinBudget(profileId: string): Promise<ProvisionOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let outcome: ProvisionOutcome
  try {
    outcome = await Promise.race([
      provisionForVerifiedIdentity(profileId),
      new Promise<ProvisionOutcome>((resolve) => {
        timer = setTimeout(() => resolve({ wallet: 'timed_out' }), PROVISION_BUDGET_MS)
      }),
    ])
  } catch (e) {
    // ⚠️ SWALLOWED HERE, NOT AT THE CALL SITE, so every caller — the review path and any future
    // backfill — gets the same never-throws contract rather than each remembering to wrap it.
    // ⛔ BUT THE CAUSE IS KEPT. A reviewer noticed the bare `catch {}` dropped the error entirely,
    // and review.ts's outer `logError` can never fire precisely because this one guarantees it —
    // so the first real provider failure would have logged the word "failed" and nothing else.
    try { logError(e, { at: 'kyc.provision', profileId }) } catch { /* a lost log must not cost more */ }
    outcome = { wallet: 'failed' }
  } finally {
    // ⚠️ ALWAYS CLEARED. An 8s timer left pending keeps the process's event loop busy after the
    // request is done, which in a serverless runtime is billed time and a held-open invocation.
    if (timer) clearTimeout(timer)
  }

  /**
   * ⛔ THE OUTCOME LEAVES A MARK, BECAUSE OTHERWISE THE RETRY STORY IS FICTION. A reviewer put it
   * exactly: this file says "idempotent, so a retry or a backfill converges" while `review.ts`
   * awaited the result and threw it away — so a `timed_out` or `failed` user was indistinguishable
   * from a provisioned one and there was nothing for a backfill to enumerate.
   * ⚠️ A LOG LINE, NOT A TABLE, AND DELIBERATELY SO. An outcome table for a provider that does not
   * exist yet would be schema invented ahead of its first real requirement; a structured line is
   * findable today and is what the adapter will replace when it knows what it needs to record.
   */
  /**
   * ⚠️ AND THE LOGGING ITSELF CANNOT BREAK THE CONTRACT. A reviewer caught this sitting outside the
   * try: `review.ts` relies on this function never throwing, and a logger that throws — a broken
   * transport, a serialisation failure — would have taken the admin's approval response down with
   * it. The whole point of the budget is that a side effect cannot damage the decision.
   */
  try {
    const detail = { at: 'kyc.provision', profileId, wallet: outcome.wallet }
    // ⚠️ THE THREE `awaiting_*` OUTCOMES ARE NOT HERE ON PURPOSE — each is an ordinary state of a
    // user waiting on US, and warning on them would make the channel useless by volume.
    const needsAttention = ['timed_out', 'failed', 'unmappable_nationality']
    if (needsAttention.includes(outcome.wallet)) warn('wallet provisioning did not complete', detail)
    else logInfo('wallet provisioning outcome', detail)
  } catch { /* a lost log line must never cost an approval */ }
  return outcome
}
