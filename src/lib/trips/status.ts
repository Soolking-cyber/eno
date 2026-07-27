import { db } from '@/lib/db'

/**
 * The trip-assistance status machine — ONE transition map and ONE applier.
 *
 * Ported from the visa desk's workflow (src/lib/visa-admin.ts:158-213) because that shape has
 * already survived contact with two operator surfaces racing the same rows. What is NOT ported is
 * the storage: the visa case lives in raw Supabase tables, an accident of the forum migration, and
 * this lives in Prisma beside Itinerary.
 *
 * ⚠️ THE COMPARE-AND-SET IS THE POINT OF THIS FILE, so be clear about what it is. It is not a
 * Supabase feature — it is an UPDATE whose WHERE clause names the expected PRIOR status, so that a
 * second writer matches zero rows instead of clobbering. Prisma expresses it as
 * `updateMany({ where: { id, status: expectedPrior } })` and a `count === 0` check, exactly as
 * offer accept/decline already does at src/lib/messages.ts:557 and enforcement.ts:158.
 *
 * The reason a plain `update({ where: { id } })` will not do: there is always a read between
 * "what may this case become?" and "make it so". In that window another operator tab, a cron, or
 * the traveller's own cancel can move the row. Validating against a status that is no longer
 * current and then writing anyway is how a cancelled case gets quoted.
 */

/**
 * Legal transitions, keyed by the CURRENT status. Terminal states are listed with an EXPLICIT
 * empty array rather than omitted, so "terminal" is data rather than an absence — and an
 * unrecognised status resolves to `[]` too, which means the machine fails CLOSED.
 *
 * The flow: a traveller requests help on a generated itinerary; an operator picks it up and
 * types a quote in chat; the traveller accepts or declines; an accepted case is arranged and then
 * closed. No status here implies a payment — eno arranges, the traveller pays suppliers directly.
 */
export const TRIP_TRANSITIONS: Record<string, string[]> = {
  requested: ['reviewing', 'cancelled'],
  reviewing: ['quoted', 'declined', 'cancelled'],
  quoted: ['accepted', 'declined', 'cancelled'],
  accepted: ['arranging', 'cancelled'],
  arranging: ['completed', 'cancelled'],
  completed: [],
  declined: [],
  cancelled: [],
}

/**
 * Statuses that end the case, and so stamp `resolvedAt`.
 *
 * DERIVED from the map rather than listed again: a terminal status is exactly one with no legal
 * exits. Writing the three names out a second time is how the two drift — add a terminal status
 * to TRIP_TRANSITIONS with `[]` and forget this line, and the case would never stamp resolvedAt.
 */
const TERMINAL = new Set(
  Object.entries(TRIP_TRANSITIONS).filter(([, next]) => next.length === 0).map(([status]) => status),
)

/** Is this a status the case cannot leave? Unknown statuses are NOT terminal — they are unknown,
 *  and canTransition already refuses every move out of them (the machine fails closed). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status)
}

/** The statuses a case is still live in — the operator queue and the "already open?" check. */
export function openStatuses(): string[] {
  return Object.keys(TRIP_TRANSITIONS).filter((status) => !TERMINAL.has(status))
}

export type TripStatus = keyof typeof TRIP_TRANSITIONS
export type TripActorType = 'traveller' | 'admin' | 'system'

/**
 * ⚠️ EDGES THAT ARE LEGAL BUT ARE NOT THE OPERATOR'S TO TAKE.
 *
 * TRIP_TRANSITIONS says which moves are POSSIBLE. It never said who may make them, and that gap
 * shipped a real defect: the admin queue derives its buttons from the map, so it rendered a button
 * for every legal edge — including the two classes of edge that belong to somebody else.
 *
 *   reviewing -> quoted   is the MONEY path. quoteAssistance is the only writer of
 *                         supplierTotalVnd/feeVnd, and it is the only thing that should ever put a
 *                         case in `quoted`. Reached through the generic mover instead, the case
 *                         lands in `quoted` with both amounts NULL, a "Quote ready" card goes to
 *                         the traveller for a quote that does not exist — and because `quoted` has
 *                         no self-edge and only `requested` leads back to `reviewing`,
 *                         quoteAssistance's own canTransition gate then refuses FOREVER. One click
 *                         and the case can never be quoted. (I did exactly this by hand while
 *                         screenshotting the queue for T320, and did not recognise it.)
 *   quoted -> accepted    is the TRAVELLER's decision, and so is quoted -> declined. An operator
 *   quoted -> declined    who wants out of a quoted case uses `cancelled`, which stays available
 *                         from every open status.
 *
 * ⚠️ AN EXCEPTIONS LIST, NOT A SECOND TABLE. Restating the operator's moves as their own map is
 * what the visa queue does (VISA_ADMIN_ACTIONS), and the two drift the moment somebody adds an
 * edge to one and not the other — avoiding that is the whole reason the queue derives its buttons.
 * Naming only the exceptions keeps ONE authority on legality, and the exhaustiveness test in
 * status.admin-edges.test.ts makes a new edge a BUILD FAILURE until somebody says whose it is.
 *
 * A Set of "from->to", not an object: an object lookup would answer for inherited keys, which is
 * the same trap `nextTripStatuses` had to close with Object.hasOwn.
 */
const NON_ADMIN_EDGES = new Set(['reviewing->quoted', 'quoted->accepted', 'quoted->declined'])

/**
 * WHICH ACTORS may take an edge — a SET, not a single owner.
 *
 * ⚠️ THIS REPLACED A SINGLE-OWNER `edgeOwner`, and the correction matters. Ownership here is not
 * exclusive: **cancel belongs to BOTH sides**. An operator can end a case that is going nowhere,
 * and a traveller must be able to withdraw one they no longer want. The single-owner version
 * answered 'admin' for `quoted->cancelled` — harmless today only because the traveller helper has
 * no ownership gate, and a trap the moment anyone adds the symmetric gate that admin already has:
 * it would silently forbid a traveller from withdrawing, which is the exact defect this pass was
 * opened to fix. A model that is right by accident is not right.
 *
 * `[]` for an edge that is not legal at all, so ownership can never contradict legality.
 */
export function edgeActors(from: string, to: string): TripActorType[] {
  if (!canTransition(from, to)) return []
  // The money edge. quoteAssistance writes the amounts and the status in ONE statement; reaching
  // `quoted` any other way means a quote card with no quote behind it.
  if (from === 'reviewing' && to === 'quoted') return ['system']
  // Accepting or declining a QUOTE is the traveller's decision and nobody else's.
  if (NON_ADMIN_EDGES.has(`${from}->${to}`)) return ['traveller']
  // Ending an open case: either side. See the note above — this is the edge the single-owner
  // model got wrong.
  if (to === 'cancelled') return ['admin', 'traveller']
  return ['admin']
}

/** May an OPERATOR take this edge directly? Legality first, then who it belongs to. */
export function adminCanTake(from: string, to: string): boolean {
  return edgeActors(from, to).includes('admin')
}

/** May the TRAVELLER whose case it is take this edge? */
export function travellerCanTake(from: string, to: string): boolean {
  return edgeActors(from, to).includes('traveller')
}

/**
 * The moves to offer an operator — still DERIVED from the one map, minus the edges that are not
 * theirs. This is what the queue must render; `nextTripStatuses` answers the different question
 * "what is legal from here" and is not an authorisation answer.
 */
export function adminNextStatuses(from: string): string[] {
  return nextTripStatuses(from).filter((to) => adminCanTake(from, to))
}

export type TripTransitionResult =
  | { ok: true; status: string }
  | { ok: false; error: 'invalid_status_transition' | 'not_found' | 'case_changed_reload' | 'update_failed' }

/** Keys and value length allowed into metaJson. Bounded so the "no PII" rule is ENFORCED rather
 *  than merely documented (codex: a comment is not a constraint). A caller that tries to attach a
 *  free-text note gets it truncated; a nested object cannot get in at all, because the parameter
 *  type admits only primitives and anything else is dropped here too. */
const META_MAX_KEYS = 8
const META_MAX_VALUE_LEN = 64

function sanitiseMeta(meta?: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  if (!meta) return {}
  const out: Record<string, string | number | boolean | null> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (Object.keys(out).length >= META_MAX_KEYS) break
    // Field NAMES are the point, so the key itself must look like one.
    if (!/^[A-Za-z0-9_]{1,32}$/.test(k)) continue
    if (v === null || typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue }
    if (typeof v === 'string') { out[k] = v.slice(0, META_MAX_VALUE_LEN); continue }
    // Anything else (object, array, undefined) is dropped rather than stringified.
  }
  return out
}

/**
 * The statuses a case may legally move to — the ONE place an operator surface should ask.
 *
 * ⚠️ EXISTS SO A UI NEVER INDEXES THE MAP DIRECTLY, for two reasons. A hardcoded button list is how
 * an admin UI and its state machine drift (the visa queue keeps a separate VISA_ADMIN_ACTIONS table
 * bound to its map by nothing but a comment). And a bare `TRIP_TRANSITIONS[status]` would answer
 * with Object.prototype members for a status like 'toString' or 'constructor' — the same
 * inherited-key trap the trip_status card schema already had to close with Object.hasOwn.
 *
 * A copy is returned, so a caller cannot mutate the machine by editing what it was handed.
 */
export function nextTripStatuses(from: string): string[] {
  return Object.hasOwn(TRIP_TRANSITIONS, from) ? [...TRIP_TRANSITIONS[from]] : []
}

/**
 * Is `next` reachable from `from`? Unknown statuses have no exits.
 *
 * ⚠️ Object.hasOwn, not `?? []`. This THREW on an inherited key: `TRIP_TRANSITIONS['toString']`
 * resolves to Object.prototype.toString, which is not null or undefined, so `??` passes it through
 * and `.includes` is not a function. The same trap was closed in nextTripStatuses (above) and this
 * sibling was missed — half a fix reads exactly like a whole one. Reaching it needs a `from` that
 * did not come from the status column (the DDL CHECK constrains that), which is why it survived;
 * adminCanTake/edgeOwner now call this with arbitrary strings, so it is reachable for real.
 */
export function canTransition(from: string, next: string): boolean {
  return Object.hasOwn(TRIP_TRANSITIONS, from) && TRIP_TRANSITIONS[from].includes(next)
}

/**
 * Apply ONE transition, atomically, and append an audit event.
 *
 * `expectedPrior` is required rather than re-read here on purpose: the caller has already loaded
 * the case to decide what to offer the operator, and passing that value back in is what makes the
 * check a genuine compare-and-set against the row the caller actually saw.
 *
 * ⚠️ Takes no money and writes none. Quote amounts are set by the operator-only quote path, never
 * by a status change, so no request body can reach a monetary column through here.
 */
export async function applyTripTransition(args: {
  id: string
  expectedPrior: string
  next: string
  actorType: TripActorType
  actorRef: string
  /** ids / step / field names only — ⚠️ never traveller PII. Sanitised before it is stored. */
  meta?: Record<string, string | number | boolean | null>
}): Promise<TripTransitionResult> {
  const { id, expectedPrior, next, actorType, actorRef, meta } = args

  // A repeat of the SAME status is treated as success — an operator double-clicking "reviewing" on
  // a reviewing case has not failed at anything, and an error there teaches them to distrust the
  // button. But it must NOT short-circuit: returning ok without touching the row was a hole in the
  // very guard this file exists for (codex found it), because a caller working from a stale read
  // would be told "yes, still reviewing" about a case that had since been cancelled or deleted.
  // So the claim is still proved against the database — the write is just a self-write, and it is
  // not an auditable event.
  const isRepeat = next === expectedPrior
  if (!isRepeat && !canTransition(expectedPrior, next)) {
    return { ok: false, error: 'invalid_status_transition' }
  }

  const now = new Date()
  const terminal = TERMINAL.has(next)

  let claim: { count: number }
  try {
    // THE COMPARE-AND-SET. `status: expectedPrior` in the WHERE is the whole guard: if anyone
    // moved this row since the caller read it, this matches zero rows and writes NOTHING — no
    // status, no timestamps, and (because the event insert is downstream) no audit event either.
    claim = await db.tripAssistanceRequest.updateMany({
      where: { id, status: expectedPrior },
      data: {
        status: next,
        // Stamped by the machine, never by a caller, so the timeline cannot be back-dated.
        resolvedAt: terminal ? now : null,
        ...(actorType === 'admin' ? { assignedAdmin: actorRef } : {}),
      },
    })
  } catch {
    return { ok: false, error: 'update_failed' }
  }

  if (claim.count === 0) {
    // Zero rows means one of two things, and the caller's move is the same either way: reload.
    // The follow-up read is for the MESSAGE only and is deliberately non-authoritative — the row
    // could be deleted or recreated between the two statements, so this classification is a
    // snapshot, not a guarantee (codex).
    const exists = await db.tripAssistanceRequest.findUnique({ where: { id }, select: { id: true } }).catch(() => null)
    return { ok: false, error: exists ? 'case_changed_reload' : 'not_found' }
  }

  // A repeat is not an auditable event — nothing changed.
  if (isRepeat) return { ok: true, status: next }

  // Observability event, best-effort and AFTER the committed update. If this insert fails the transition
  // still happened, and saying otherwise would bait the operator into re-clicking straight into
  // invalid_status_transition — the exact trap visa-admin.ts:205-213 documents.
  try {
    await db.tripAssistanceEvent.create({
      data: {
        requestId: id,
        actorType,
        actorRef,
        event: 'status_changed',
        // ⚠️ Authoritative from/to go LAST so caller meta can never shadow them. With the
        // spread first, a caller passing { from, to } forged the audit record: an event named
        // 'status_changed' could describe a transition that never happened, on the trail that
        // backs an operator's money quote. Both external reviewers caught this independently.
        metaJson: JSON.stringify({ ...sanitiseMeta(meta), from: expectedPrior, to: next }),
      },
    })
  } catch {
    /* the transition is committed; an unrecorded event must not fail the caller */
  }

  return { ok: true, status: next }
}
