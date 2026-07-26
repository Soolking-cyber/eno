import 'server-only'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'

/**
 * Deterministic stop editing: reorder, swap, delete. No AI anywhere in here — these operate on
 * STRUCTURE, so they work perfectly well while a stop still has no coordinate.
 *
 * ⚠️ THE HARD PART IS `@@unique([dayId, position])`, AND THE OBVIOUS ANSWERS DO NOT WORK. Measured
 * against the production table before any of this was designed:
 *
 *   · Two writes ("move A onto B's slot, then B onto A's") → 23505, unique violation. Expected.
 *   · ONE statement permuting both rows via a VALUES join → 23505 AS WELL. Postgres validates a
 *     unique index per ROW as the statement runs, not at its end, so a permutation collides with
 *     itself mid-statement. This is the assumption worth destroying early — "do it in one
 *     statement" reads like the clever fix and simply fails.
 *   · SET CONSTRAINTS … DEFERRED → rejected, because there IS no constraint: pg_constraint has no
 *     row for it. Prisma's `@@unique` creates a unique INDEX, and Postgres cannot defer an index,
 *     only a constraint. So the textbook answer for permutations is unavailable here without
 *     converting the index — which is a schema change, and prisma/schema.prisma is not in this
 *     task's owned paths.
 *
 * What DOES work, and is what these functions use: stage every affected row into the NEGATIVE
 * range in one statement, then map it back in a second. Positions are always 0..n-1, so negatives
 * are provably unoccupied and no intermediate state can collide with a live row. Both statements
 * run in ONE transaction, so nothing outside it ever observes the staging values.
 *
 * ⚠️ THE COMPARE-AND-SET IS IN THE STAGING WHERE CLAUSE. Each row is matched on (id, expected
 * current position), so a concurrent edit that moved anything means fewer rows match than were
 * asked for, and the whole transaction rolls back with `stale`. That is what makes a second tab
 * lose cleanly instead of interleaving two reorders into an order neither person asked for.
 */

export type StopEditResult =
  | { ok: true; positions: Array<{ id: string; position: number }> }
  | { ok: false; error: StopEditError }
export type StopEditError = 'not_found' | 'forbidden' | 'invalid_order' | 'stale' | 'update_failed'

/**
 * Flatten anything that could render as more than plain text.
 *
 * Markup, link syntax and bare URLs come out; the words stay. Suggested activity text is shown
 * inside the traveller's own itinerary and later exported to Word, so a smuggled anchor is a real
 * (if self-inflicted) phishing surface, and stripping is cheaper than trusting every renderer
 * downstream to escape it forever.
 *
 * ⚠️ ONE definition, deliberately, even though it is text handling in a module about database
 * writes. Both stop routes need it — `suggest` before it DISPLAYS a candidate, `stops` before it
 * WRITES one — and a sanitiser with two copies is a sanitiser where one copy quietly stops matching
 * the other. It lives here because this is the module both of those routes already import.
 *
 * ⚠️ It can return an EMPTY string (input of `**`, or a bare URL and nothing else). Every caller
 * must decide what that means rather than assuming a non-empty result — a field that strips to
 * nothing is dropped, never written blank.
 */
export function stripToPlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')                       // tags
    .replace(/\]\(|\[|\]|[`*_~|]/g, ' ')            // markdown link/emphasis syntax
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')   // URLs
    .replace(/\s+/g, ' ')
    .trim()
}

type StopRow = { id: string; position: number }

/**
 * Prove the day belongs to an itinerary owned by this profile, and return its stops in order.
 *
 * Ownership is proven through the JOIN rather than trusted from the caller: a dayId is guessable,
 * and every operation below writes. Missing and not-yours both answer 'not_found', so a signed-in
 * stranger cannot use these routes to discover which day ids exist.
 */
async function loadOwnedDay(
  tx: Prisma.TransactionClient,
  dayId: string,
  itineraryId: string,
  profileId: string,
): Promise<StopRow[] | null> {
  const day = await tx.itineraryDay.findFirst({
    // The itinerary in the PATH is part of the predicate, not decoration: without it a caller could
    // edit any day they own through any itinerary id, and the route's own URL would be a lie.
    where: { id: dayId, itineraryId, itinerary: { profileId } },
    select: { id: true },
  })
  if (!day) return null
  return tx.itineraryStop.findMany({
    where: { dayId },
    select: { id: true, position: true },
    orderBy: { position: 'asc' },
  })
}

/**
 * Write a complete, gap-free ordering for a day.
 *
 * `expected` is the ordering the caller believes is current — the compare-and-set value. It is the
 * caller's OWN read, passed back, which is what makes this a genuine check rather than a re-read
 * that a concurrent write could have invalidated between the two statements.
 */
async function writeOrder(
  tx: Prisma.TransactionClient,
  dayId: string,
  expected: StopRow[],
  desiredIds: string[],
): Promise<void> {
  // Stage into the negative range. The WHERE carries each row's EXPECTED position, so this is the
  // compare-and-set: a row somebody else moved simply does not match.
  const stagedRows = await tx.$executeRaw`
    update "ItineraryStop" s set position = v.pos
    from (select * from unnest(
      ${expected.map((row) => row.id)}::text[],
      ${expected.map((row) => row.position)}::int[],
      ${expected.map((row) => -(desiredIds.indexOf(row.id) + 1))}::int[]
    ) as t(id, old_pos, pos)) as v
    where s.id = v.id and s."dayId" = ${dayId} and s.position = v.old_pos`
  if (stagedRows !== expected.length) throw new StaleError()

  // Map the staging values onto the real ones. Monotonic and collision-free: every target slot was
  // vacated by the first statement.
  const finalRows = await tx.$executeRaw`
    update "ItineraryStop" set position = (-position) - 1
    where "dayId" = ${dayId} and position < 0`
  if (finalRows !== expected.length) throw new StaleError()
}

class StaleError extends Error {}

/** Move one stop to a new index within its day. Everything else closes up around it. */
export async function reorderStop(input: {
  dayId: string
  itineraryId: string
  stopId: string
  toIndex: number
  profileId: string
}): Promise<StopEditResult> {
  return runEdit(input.dayId, input.itineraryId, input.profileId, (stops) => {
    const from = stops.findIndex((s) => s.id === input.stopId)
    if (from < 0) return null
    if (!Number.isInteger(input.toIndex) || input.toIndex < 0 || input.toIndex >= stops.length) return null
    const ids = stops.map((s) => s.id)
    const [moved] = ids.splice(from, 1)
    ids.splice(input.toIndex, 0, moved)
    return ids
  })
}

/**
 * Exchange two stops. Expressed through the SAME primitive as a reorder rather than as its own
 * write path — three separate implementations of "renumber a day" is three places for the
 * staging trick to be got subtly wrong.
 */
export async function swapStops(input: {
  dayId: string
  itineraryId: string
  stopIdA: string
  stopIdB: string
  profileId: string
}): Promise<StopEditResult> {
  return runEdit(input.dayId, input.itineraryId, input.profileId, (stops) => {
    const a = stops.findIndex((s) => s.id === input.stopIdA)
    const b = stops.findIndex((s) => s.id === input.stopIdB)
    if (a < 0 || b < 0 || a === b) return null
    const ids = stops.map((s) => s.id)
    ;[ids[a], ids[b]] = [ids[b], ids[a]]
    return ids
  })
}

/**
 * Remove a stop and close the gap, so positions stay 0..n-1.
 *
 * Compaction goes through the same staging path: a naive "shift everything down by one" collides
 * with the row below it exactly like a swap does.
 */
export async function deleteStop(input: {
  dayId: string
  itineraryId: string
  stopId: string
  profileId: string
}): Promise<StopEditResult> {
  return runEdit(input.dayId, input.itineraryId, input.profileId, (stops) => {
    if (!stops.some((s) => s.id === input.stopId)) return null
    return stops.filter((s) => s.id !== input.stopId).map((s) => s.id)
  }, input.stopId)
}

/** What a replacement may set. Every field is the traveller's to see — none is derived from money. */
export type StopReplacement = {
  name: string
  place: string
  time: string | null
  details: string | null
  lat: number | null
  lng: number | null
  travelMinutes: number | null
  estimatedCostVnd: number | null
  bookingAdvice: string | null
}

/**
 * Swap a stop's CONTENT for a different activity, leaving the day's order untouched.
 *
 * ⚠️ NOT A REORDER, so it does not go through `runEdit`: nothing about the permutation changes, and
 * `runEdit`'s whole job is computing one. What it shares is the discipline — ownership proven through
 * the itinerary in the PATH, and a compare-and-set so the write cannot land on a row somebody else
 * already moved or deleted.
 *
 * ⚠️ `updateMany`, NOT `update`. `update` throws when the predicate misses, which would surface as
 * update_failed (500) for what is really a lost race (409). The count IS the CAS: 0 means the row is
 * no longer where the caller thought it was, and the honest answer is `stale` so the client reloads
 * rather than retrying a write against a picture that has moved.
 *
 * ⚠️ It returns the day's EXISTING order as `positions`, unchanged. Every action on this endpoint
 * answers the same shape so one client reconcile path serves all of them — a replace that returned
 * nothing would make the caller special-case it, and special cases are where clients drift.
 *
 * ⚠️ NOTHING HERE IS TRUSTED FROM A MODEL. The route validates the replacement through a strict
 * schema before this is called; this function assumes bounded, already-stripped values and writes
 * them verbatim. Do not "helpfully" re-derive or re-format a field here — the validation boundary is
 * the route, and two boundaries mean neither is authoritative.
 */
export async function replaceStop(input: {
  dayId: string
  itineraryId: string
  stopId: string
  profileId: string
  replacement: StopReplacement
}): Promise<StopEditResult> {
  try {
    return await db.$transaction(async (tx) => {
      const stops = await loadOwnedDay(tx, input.dayId, input.itineraryId, input.profileId)
      if (!stops) return { ok: false, error: 'not_found' as const }
      // A stop that is not in THIS day is the same answer as a day that is not yours — see the note
      // on loadOwnedDay. It must not become a probe for which stop ids exist.
      if (!stops.some((s) => s.id === input.stopId)) return { ok: false, error: 'not_found' as const }

      const written = await tx.itineraryStop.updateMany({
        where: { id: input.stopId, dayId: input.dayId },
        data: { ...input.replacement },
      })
      if (written.count !== 1) return { ok: false, error: 'stale' as const }

      return {
        ok: true as const,
        positions: stops.map((s, index) => ({ id: s.id, position: index })),
      }
    })
  } catch (e) {
    if (e instanceof StaleError) return { ok: false, error: 'stale' }
    console.error('[itinerary-stops] replace failed', (e as Error)?.message?.slice(0, 200))
    return { ok: false, error: 'update_failed' }
  }
}

/**
 * The one transaction every edit runs in: prove ownership, compute the desired order, write it.
 *
 * `plan` returns the desired id order, or null when the request does not describe a legal edit —
 * a stop that is not in this day, an index out of range, a swap of a stop with itself.
 */
async function runEdit(
  dayId: string,
  itineraryId: string,
  profileId: string,
  plan: (stops: StopRow[]) => string[] | null,
  deleteStopId?: string,
): Promise<StopEditResult> {
  try {
    return await db.$transaction(async (tx) => {
      const stops = await loadOwnedDay(tx, dayId, itineraryId, profileId)
      if (!stops) return { ok: false, error: 'not_found' as const }
      const desiredIds = plan(stops)
      if (!desiredIds) return { ok: false, error: 'invalid_order' as const }

      if (deleteStopId) {
        // CAS on the row itself: deleting by id alone would succeed against a row somebody else
        // had already moved, and the compaction that follows would then renumber a stale picture.
        const removed = await tx.itineraryStop.deleteMany({ where: { id: deleteStopId, dayId } })
        if (removed.count !== 1) return { ok: false, error: 'stale' as const }
      }

      const remaining = stops.filter((s) => s.id !== deleteStopId)
      await writeOrder(tx, dayId, remaining, desiredIds)
      return {
        ok: true as const,
        positions: desiredIds.map((id, index) => ({ id, position: index })),
      }
    })
  } catch (e) {
    if (e instanceof StaleError) return { ok: false, error: 'stale' }
    console.error('[itinerary-stops] edit failed', (e as Error)?.message?.slice(0, 200))
    return { ok: false, error: 'update_failed' }
  }
}
