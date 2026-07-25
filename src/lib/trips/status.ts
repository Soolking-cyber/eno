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

/** Is `next` reachable from `from`? Unknown statuses have no exits. */
export function canTransition(from: string, next: string): boolean {
  return (TRIP_TRANSITIONS[from] ?? []).includes(next)
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
