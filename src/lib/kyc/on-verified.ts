import 'server-only'
import { readVerifiedIdentity, railsFor, isoNationality, type VerifiedIdentity } from './identity'
import { logError, logInfo, logWarn } from '@/lib/log'
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
     * ⚠️ ELIGIBLE, AND WAITING ON THE PROVIDER — not an error and not a skip. The Crossmint adapter
     * and its credentials do not exist in any environment yet, so this is the honest answer for a
     * user who SHOULD get a wallet. Reporting `failed` would send an eligible user to a retry that
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
export async function provisionForVerifiedIdentity(profileId: string): Promise<ProvisionOutcome> {
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
  if (!IS_SERVICES) return { wallet: 'skipped_edition' }

  const identity = await readVerifiedIdentity(profileId)
  if (!identity) return { wallet: 'skipped_unverified' }

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
  if (!railsFor(identity).includes('crossmint')) return { wallet: whyClosed(identity) }

  /**
   * ⛔ THE ADAPTER IS NOT BUILT YET, AND THIS IS DELIBERATELY NOT A STUB THAT PRETENDS OTHERWISE.
   * Creating the wallet needs `@crossmint/wallets-sdk`, a server API key with `wallets.create`
   * scope and a signer secret — none of which exist in any environment yet. Saying
   * `skipped_ineligible` here would be a lie about the law (they ARE eligible) and `created` would
   * be worse. The hook, its gate and its call site are what this file lands; the provider call
   * drops in exactly here.
   *
   * ⚠️ AND THE try/catch THAT WRAPPED THIS IS GONE UNTIL THERE IS SOMETHING TO CATCH — eslint was
   * right that it was unreachable. It comes back WITH the provider call: a network failure there
   * must resolve to `failed` and must never propagate, because the caller in review.ts is an admin
   * approving a case and this is a side effect, not the decision.
   */
  return { wallet: 'pending_provider' }
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
    if (needsAttention.includes(outcome.wallet)) logWarn('wallet provisioning did not complete', detail)
    else logInfo('wallet provisioning outcome', detail)
  } catch { /* a lost log line must never cost an approval */ }
  return outcome
}
