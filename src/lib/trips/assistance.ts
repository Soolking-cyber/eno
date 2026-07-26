import 'server-only'
import { db } from '../db'
import { getAdmin, getCurrentProfile } from '../admin'
import { adminCanTake, applyTripTransition, canTransition, openStatuses, type TripActorType } from './status'
// The DM layer. Imported for its two card senders only; it never calls back into this file, so
// the dependency is one-way (assistance -> dm-flow -> dm-thread/messages).
import { announceTripStatus, sendTripQuoteCard } from './dm-flow'

/**
 * The assistance CASE lifecycle: a traveller asks for help on an itinerary, an operator reviews
 * it and types a quote, the traveller accepts or declines.
 *
 * ⚠️ EVERY FUNCTION HERE RESOLVES ITS OWN ACTOR. None of them takes a profile id, an admin
 * email, or any other identity argument. That is deliberate and it is the direct answer to an
 * external review of the previous two commits: the card gate and the thread binder both accept
 * their caller's identity as an ARGUMENT, so what they prove is conditional on every route
 * remembering to pass a session value rather than a body field. Here there is nothing to
 * remember — the identity comes from getCurrentProfile()/getAdmin() inside the function, so a
 * route physically cannot nominate who is acting.
 *
 * ⚠️ WHERE MONEY MAY BE WRITTEN — the whole point of the split below. The visa desk's rule is
 * "no number from a request body reaches the card path" (src/lib/visa/dm-flow.ts:68-72), and it
 * achieves that by DERIVING the price from a listing. Trip assistance cannot: there is no
 * product, an operator types the supplier total and the fee. So the rule is honoured the other
 * way round —
 *   · the traveller-facing functions write NO money and take no amount at all;
 *   · quoteAssistance is the ONLY writer of the two money columns, and it refuses unless
 *     getAdmin() resolves an admin from the session;
 *   · the chat card carries no amount either (see TripQuoteMeta), so nothing downstream can
 *     restate a price.
 * A traveller therefore has no path, at any layer, that reaches a monetary column.
 */

/** Postgres INTEGER. Rejected here with a named error rather than left to a driver-level throw. */
const MAX_VND = 2_147_483_647

export type AssistanceResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { requestId: string } : { requestId: string; data: T }))
  | { ok: false; error: AssistanceError }
export type AssistanceError =
  | 'not_signed_in'
  | 'forbidden'
  // 'itinerary_not_found' REMOVED, not merely unused: while it existed, the create path could
  // distinguish "no such itinerary" from "not yours" and became an enumeration oracle. Deleting
  // the member makes reintroducing that split a type error rather than a judgement call.
  | 'request_not_found'
  | 'invalid_amount'
  | 'invalid_status_transition'
  | 'case_changed_reload'
  | 'update_failed'

/**
 * Open a case on the caller's OWN itinerary, or return the one that is already open.
 *
 * ⚠️ THE DUPLICATE GUARD IS AN ADVISORY LOCK, because the obvious alternatives are both broken.
 *
 * There is no unique index on (itineraryId, open-status) — a partial unique index needs a schema
 * change, outside this task's paths (flagged for Alex). My first attempt therefore did a
 * check-then-insert followed by "convergence": each writer re-read the open cases and cancelled
 * its own row if it found an older one, on the theory that both writers would agree because
 * neither picked by "mine".
 *
 * BOTH external reviewers refuted that independently, with the same MVCC argument, and they were
 * right: under READ COMMITTED an UNCOMMITTED older insert is invisible. Writer B commits and
 * re-reads, sees only its own row, keeps it; writer A then commits, re-reads, sees itself as the
 * oldest, and keeps its row too. Two open cases, and two callers each convinced of a different
 * winner. Convergence cannot work when the thing being converged on isn't visible yet.
 *
 * pg_advisory_xact_lock makes the check and the insert genuinely one critical section, which is
 * the same idiom this repo already uses for exactly this shape of "only one may exist" write
 * (src/lib/dispute.ts:345, src/lib/zalo-zns.ts:154). The lock is held to the end of the
 * transaction and released by the database, so no cleanup path can leak it.
 *
 * hashtext() collisions are harmless here: two unrelated itineraries sharing a lock key only
 * serialise against each other for the length of one insert, and the check inside the lock is
 * still keyed on the real itineraryId.
 */
export async function requestAssistance(input: { itineraryId: string }): Promise<AssistanceResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'not_signed_in' }

  // Ownership of the ITINERARY, proven before a case can name it. An assistance case exposes a
  // trip to an operator, so it may only be opened by the traveller whose trip it is.
  const itinerary = await db.itinerary.findUnique({
    where: { id: input.itineraryId },
    select: { id: true, profileId: true },
  })
  // ⚠️ ONE answer for both "no such itinerary" and "not yours" — codex caught that splitting them
  // made this endpoint an enumeration oracle. Any signed-in user could POST itinerary ids and read
  // 404-vs-403 to learn which ones exist, i.e. confirm another traveller's trip is real. The case
  // route already collapses its two outcomes for exactly this reason; the CREATE path was missed.
  // Both are `forbidden`, matching that precedent: a stranger is told what they may do, never what
  // exists. A traveller who mistypes their own id sees the same thing, which is the price.
  if (!itinerary || itinerary.profileId !== profile.id) return { ok: false, error: 'forbidden' }

  const open = openStatuses()
  let outcome: { id: string; opened: boolean }
  try {
    outcome = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`trip-assist:${itinerary.id}`}))`
      // Inside the lock, so a second caller cannot be between this read and the insert below.
      const existing = await tx.tripAssistanceRequest.findFirst({
        where: { itineraryId: itinerary.id, status: { in: open } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })
      if (existing) return { id: existing.id, opened: false }
      const created = await tx.tripAssistanceRequest.create({
        // status defaults to 'requested'; money stays null. Nothing here is caller-supplied
        // except the itinerary, whose ownership is proven above.
        data: { itineraryId: itinerary.id, profileId: profile.id },
        select: { id: true },
      })
      return { id: created.id, opened: true }
    })
  } catch {
    return { ok: false, error: 'update_failed' }
  }

  // AFTER the transaction, and only for a case this call actually opened. Inside it, a failed
  // event insert would abort the transaction and lose the case — the opposite of the
  // best-effort behaviour every other event append in this feature has.
  if (outcome.opened) await recordEvent(outcome.id, 'traveller', profile.id, 'requested')
  return { ok: true, requestId: outcome.id }
}

/** What a trip card renders. Amounts are null until an operator has quoted. */
export type AssistanceView = {
  requestId: string
  status: string
  supplierTotalVnd: number | null
  feeVnd: number | null
  quotedAt: string | null
  /** True for the traveller whose case it is — the only viewer who may accept or decline. */
  mine: boolean
}

/**
 * Read a case for rendering. This is what makes the quote card a LIVE handle: the message row
 * carries only a requestId, and the numbers come from here on every render, so a re-quote is never
 * contradicted by a stale card sitting in the timeline.
 *
 * Visible to the traveller who owns it and to an admin, and to nobody else. `mine` is computed
 * here rather than by the caller, so a surface cannot accidentally offer the accept button to an
 * operator (who would then be accepting a quote on the traveller's behalf).
 */
export async function viewAssistance(input: { requestId: string }): Promise<{ ok: true; data: AssistanceView } | { ok: false; error: AssistanceError }> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'not_signed_in' }
  const request = await db.tripAssistanceRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, profileId: true, status: true, supplierTotalVnd: true, feeVnd: true, quotedAt: true },
  })
  const mine = request?.profileId === profile.id
  // ⚠️ MISSING AND FORBIDDEN ARE THE SAME ANSWER. Returning 'request_not_found' for an id that
  // does not exist and 'forbidden' for one that does is an EXISTENCE ORACLE: a signed-in stranger
  // enumerates real case ids by comparing 404s to 403s. codex found this, against a comment of
  // mine that claimed the endpoint never confirms which ids are real — it did.
  //
  // The cost is that a traveller whose own case was deleted sees 'forbidden' rather than a precise
  // 404. That is the correct trade: they have one case id, and the difference tells them nothing
  // they need, while the distinction tells an attacker everything.
  if (!request || (!mine && !(await getAdmin()))) return { ok: false, error: 'forbidden' }
  return {
    ok: true,
    data: {
      requestId: request.id,
      status: request.status,
      supplierTotalVnd: request.supplierTotalVnd,
      feeVnd: request.feeVnd,
      quotedAt: request.quotedAt ? request.quotedAt.toISOString() : null,
      mine,
    },
  }
}

/**
 * Move a case as an operator — the GENERIC admin transition.
 *
 * ⚠️ EXISTS TO DELETE A SECOND COPY OF THE ANNOUNCE RULE. The admin queue route (T320) had to
 * compose transition-then-announce itself, including the "only announce a REAL move" rule, because
 * this file's transitionAsAdmin was private and assistance.ts was not in that task's owned paths. I
 * flagged the duplication in the commit and on the board; this is it removed. Two copies of "when
 * does a card get posted" is how a double click starts posting duplicates on one surface and not
 * the other.
 *
 * Resolves its OWN admin, like everything else here — an operator identity is never an argument.
 */
export async function moveAssistanceAsAdmin(input: { requestId: string; next: string }): Promise<AssistanceResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, error: 'forbidden' }
  return transitionAsAdmin(input.requestId, input.next, admin)
}

/** An operator picks the case up: requested → reviewing. A named shorthand for the common first
 *  move; moveAssistanceAsAdmin covers the rest of the machine. */
export async function startReview(input: { requestId: string }): Promise<AssistanceResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, error: 'forbidden' }
  return transitionAsAdmin(input.requestId, 'reviewing', admin)
}

/**
 * THE ONLY WRITER OF THE MONEY COLUMNS.
 *
 * ⚠️ THE AMOUNTS AND THE STATUS MOVE IN ONE STATEMENT. The hazard being avoided is real: two
 * unsynchronised writes (status→quoted, then the numbers) can leave a `quoted` case with no quote
 * in it, which the traveller's card would render as an offer of nothing — and which the DDL's
 * both-or-neither CHECK cannot catch, because both columns are still null together.
 *
 * Be accurate about WHY it is one statement, though (codex refuted the stronger claim I first
 * made): one UPDATE is SUFFICIENT and simplest, not the only atomic option. Two writes wrapped in
 * a transaction would be atomic too. The reason that route is not taken is concrete rather than
 * theoretical — applyTripTransition owns its own `db` handle and accepts no transaction client, so
 * quoting through it would mean refactoring the ONE applier to thread a `tx` through every caller.
 * A single UPDATE gets the same guarantee without touching the shared applier at all.
 *
 * The transition is still validated against the ONE map (canTransition), so this is a second WRITE
 * path, not a second definition of the workflow.
 */
export async function quoteAssistance(input: { requestId: string; supplierTotalVnd: number; feeVnd: number }): Promise<AssistanceResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, error: 'forbidden' }
  const { requestId, supplierTotalVnd, feeVnd } = input
  // Both numbers, or the request is malformed — a quote is never half-typed. The DDL enforces
  // the same invariant at the column level; this is the honest error message for the operator.
  if (!isVnd(supplierTotalVnd) || !isVnd(feeVnd)) return { ok: false, error: 'invalid_amount' }

  const current = await db.tripAssistanceRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  })
  if (!current) return { ok: false, error: 'request_not_found' }
  if (!canTransition(current.status, 'quoted')) return { ok: false, error: 'invalid_status_transition' }

  const now = new Date()
  let claim: { count: number }
  try {
    claim = await db.tripAssistanceRequest.updateMany({
      // The compare-and-set: the status read above is re-asserted, so an operator quoting a case
      // the traveller has since cancelled writes nothing at all — no status, and no numbers.
      where: { id: requestId, status: current.status },
      data: {
        status: 'quoted', supplierTotalVnd, feeVnd, quotedAt: now,
        // Claim-if-unclaimed, matching the visa desk: never a silent re-assignment.
        assignedAdmin: admin,
      },
    })
  } catch {
    return { ok: false, error: 'update_failed' }
  }
  if (claim.count === 0) return { ok: false, error: 'case_changed_reload' }

  // ⚠️ THE AUDIT EVENT RECORDS NO AMOUNT. metaJson is ids and field names only, and this table
  // has no owner column and outlives the case — a fee sitting in it is a money fact in a place
  // nothing governs. The numbers live in the row, where the CHECK constraints apply.
  await recordEvent(requestId, 'admin', admin, 'quoted', { from: current.status, to: 'quoted' })
  // The card follows the money, from HERE rather than from a route, so a quote cannot be written
  // without the traveller being told. Best-effort by construction: dm-flow returns null instead of
  // throwing, because the quote is already committed and reporting it as failed would bait the
  // operator into typing it again.
  await sendTripQuoteCard({ requestId })
  return { ok: true, requestId }
}

/** The traveller accepts the quote: quoted → accepted. Writes no money. */
export async function acceptQuote(input: { requestId: string }): Promise<AssistanceResult> {
  return transitionAsTraveller(input.requestId, 'accepted')
}

/** The traveller declines: quoted → declined. */
export async function declineQuote(input: { requestId: string }): Promise<AssistanceResult> {
  return transitionAsTraveller(input.requestId, 'declined')
}

/** The traveller withdraws. Legal from every non-terminal status per the ONE map. */
export async function cancelAssistance(input: { requestId: string }): Promise<AssistanceResult> {
  return transitionAsTraveller(input.requestId, 'cancelled')
}

// ── internals ───────────────────────────────────────────────────────────────────────────

/**
 * The applier's vocabulary, translated into this module's. Only 'not_found' actually differs —
 * mapped rather than added to AssistanceError so a caller has ONE name for "no such case",
 * whether the row was missing at the read or vanished under the compare-and-set.
 */
function mapTransitionError(error: 'invalid_status_transition' | 'not_found' | 'case_changed_reload' | 'update_failed'): AssistanceError {
  return error === 'not_found' ? 'request_not_found' : error
}

/** A whole, non-negative đồng amount that Postgres INTEGER can actually hold. */
function isVnd(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_VND
}

async function transitionAsTraveller(requestId: string, next: string): Promise<AssistanceResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'not_signed_in' }
  const request = await db.tripAssistanceRequest.findUnique({
    where: { id: requestId },
    select: { status: true, profileId: true },
  })
  // Ownership, proven against the SESSION profile — there is no argument to forge. Missing and
  // not-yours collapse to ONE answer for the same reason as viewAssistance: otherwise the action
  // routes are an existence oracle for any signed-in user (codex).
  if (!request || request.profileId !== profile.id) return { ok: false, error: 'forbidden' }
  const result = await applyTripTransition({
    id: requestId, expectedPrior: request.status, next,
    actorType: 'traveller', actorRef: profile.id,
  })
  if (!result.ok) return { ok: false, error: mapTransitionError(result.error) }
  // ⚠️ ONLY announce a REAL move. applyTripTransition deliberately returns ok for a repeat of the
  // same status — a double-clicked button has not failed at anything — but it also records no
  // audit event for one, and a card must follow the same rule: otherwise the second click posts a
  // duplicate announcement into the traveller's thread. Found by a test asserting the opposite.
  if (request.status !== next) await announceTripStatus({ requestId, status: next })
  return { ok: true, requestId }
}

async function transitionAsAdmin(requestId: string, next: string, admin: string): Promise<AssistanceResult> {
  const request = await db.tripAssistanceRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  })
  if (!request) return { ok: false, error: 'request_not_found' }
  // ⚠️ LEGAL IS NOT THE SAME AS THEIRS TO TAKE, and this gate is the load-bearing half of that fix.
  // Every admin path runs through here — the generic mover and startReview today, anything added
  // later by construction — so an operator cannot reach the money edge (reviewing -> quoted, which
  // belongs to quoteAssistance and would otherwise announce a quote that does not exist and leave
  // the case permanently unquotable) or take the traveller's accept/decline decision for them.
  // Hiding the buttons in the queue is the cosmetic half; this is the half that actually holds,
  // because the route accepts `next` from a request body.
  //
  // ⚠️ A REPEAT IS EXEMPT, and an existing test is what taught me that. The map has no self-edges,
  // so a bare ownership check turned a double-clicked button into a 409 — applyTripTransition
  // deliberately treats "already in that status" as success (it is not a failed move, and it
  // announces nothing), and gating ownership ahead of it silently removed that. A repeat cannot be
  // a privilege escalation: it writes the status the case is already in.
  if (next !== request.status && !adminCanTake(request.status, next)) {
    return { ok: false, error: 'invalid_status_transition' }
  }
  const result = await applyTripTransition({
    id: requestId, expectedPrior: request.status, next,
    actorType: 'admin', actorRef: admin,
  })
  if (!result.ok) return { ok: false, error: mapTransitionError(result.error) }
  // ⚠️ ONLY announce a REAL move. applyTripTransition deliberately returns ok for a repeat of the
  // same status — a double-clicked button has not failed at anything — but it also records no
  // audit event for one, and a card must follow the same rule: otherwise the second click posts a
  // duplicate announcement into the traveller's thread. Found by a test asserting the opposite.
  if (request.status !== next) await announceTripStatus({ requestId, status: next })
  return { ok: true, requestId }
}

/**
 * Append an observability event. Best-effort, exactly like the applier's own: the thing the event
 * describes has already committed, so failing the caller here would report a success as an error.
 */
async function recordEvent(
  requestId: string,
  actorType: TripActorType,
  actorRef: string,
  event: string,
  meta?: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    await db.tripAssistanceEvent.create({
      data: { requestId, actorType, actorRef, event, metaJson: meta ? JSON.stringify(meta) : null },
    })
  } catch {
    /* the state change is committed; an unrecorded event must not fail the caller */
  }
}
