import { db } from '@/lib/db'

/**
 * Swap one hotel on a saved itinerary for another. The ONLY write this feature has.
 *
 * ⚠️ REPLACE ONLY — no delete, no reorder, and that is a design decision rather than an unfinished
 * one. `@@unique([itineraryId, position])` means removing a stay either leaves a hole or renumbers
 * the rest, and neither is worth building for a shortlist a traveller reads top to bottom; more to
 * the point, a trip with no accommodation is a worse artefact than a trip with a hotel the traveller
 * has not chosen yet. Swapping keeps `position` untouched, so the list cannot lose a row or reorder
 * itself under the reader. If deletion is ever wanted, it needs its own decision about the hole.
 */

export type StayReplacement = {
  name: string
  area: string
  note: string | null
  estimatedNightly: number | null
}

export type StayEditError = 'not_found' | 'stale' | 'update_failed'
export type StayEditResult = { ok: true } | { ok: false; error: StayEditError }

/**
 * The row's mutable columns — the CAS predicate, and the reason this type exists.
 *
 * ⚠️ EVERY MUTABLE FIELD, BECAUSE THERE IS NOTHING BETTER TO COMPARE. `ItineraryStay` has no
 * `updatedAt` and no version column, so an adversarial review of the plan killed the obvious
 * shortcut of comparing `name` alone: A→B→A between our read and our write is invisible to a
 * name-only predicate, and we would overwrite a hotel the traveller had picked in another tab
 * believing nothing had moved. Comparing them all means the only change this can miss is one that
 * put every column back exactly as it was — which is byte-identical to no change at all.
 *
 * ⚠️ `position` IS IN HERE, and it is in here because a review of the finished diff caught it
 * missing. Nothing in the app writes it today (stays are created with their position and never
 * reordered), so the omission was invisible — which is exactly the problem: the guarantee this
 * predicate is supposed to give was "any concurrent change loses", and the first reordering feature
 * anyone adds would have silently made that false. A CAS that is complete only by coincidence is not
 * complete. Every column of the model is now compared except three, each for a stated reason:
 *   · `id` and `itineraryId` — already pinned in the WHERE below, so comparing them again is noise.
 *   · `createdAt` — immutable by construction (`@default(now())`, no `@updatedAt`, no writer). It is
 *     also the one column that could make this predicate WRONG rather than merely strict: Postgres
 *     stores microseconds where a JS Date carries milliseconds, so a value that failed to round-trip
 *     would fail every comparison and break swapping outright.
 *
 * Adding a version column would be stronger and cheaper to read, but `prisma/schema.prisma` changes
 * here need the drop-FK → db push → re-add-FK ritual; the full-row predicate buys the same guarantee
 * with no migration. If a `version` column ever arrives for another reason, collapse this onto it.
 */
type StaySnapshot = {
  position: number
  name: string
  nameVi: string | null
  area: string
  areaVi: string | null
  note: string | null
  noteVi: string | null
  estimatedNightly: number | null
  currency: string
}

const SNAPSHOT_SELECT = {
  position: true,
  name: true,
  nameVi: true,
  area: true,
  areaVi: true,
  note: true,
  noteVi: true,
  estimatedNightly: true,
  currency: true,
} as const

export async function replaceStay(input: {
  itineraryId: string
  stayId: string
  profileId: string
  replacement: StayReplacement
}): Promise<StayEditResult> {
  try {
    /**
     * ⚠️ NO TRANSACTION, DELIBERATELY. There is exactly one write, so a transaction would add no
     * atomicity — it would only look like it did, and a guard that reads as protection without being
     * protection is worse than none (this codebase has already removed one fake advisory lock for
     * that reason). What makes the read-then-write safe is that the write re-checks everything the
     * read saw.
     */
    const current = await db.itineraryStay.findFirst({
      // Ownership through the JOIN, with the itinerary from the PATH in the predicate: a stayId is
      // guessable. Missing and not-yours are the same answer, so this cannot be used to discover
      // which stays exist.
      //
      // ⚠️ WHAT THIS DOES NOT COVER, stated because the diff review would not let the absolute claim
      // stand: the relation filter is evaluated against the statement's snapshot and takes no lock on
      // the parent row, so an itinerary that changed HANDS between this read and the write below
      // could still be written through. Nothing in the app transfers a trip — `Itinerary.profileId`
      // is written once at creation and the only update archives a trip — so today the race has no
      // trigger. If trip ownership ever becomes mutable, this needs the parent locked or versioned;
      // do not read the CAS below as covering it, because it compares the STAY's columns, not the
      // itinerary's.
      where: { id: input.stayId, itineraryId: input.itineraryId, itinerary: { profileId: input.profileId } },
      select: SNAPSHOT_SELECT,
    })
    if (!current) return { ok: false, error: 'not_found' }

    const snapshot: StaySnapshot = current
    const written = await db.itineraryStay.updateMany({
      /**
       * ⚠️ THE OWNERSHIP CHECK IS IN THE MUTATION, NOT ONLY IN THE READ ABOVE, and this is the fix
       * for a TOCTOU an adversarial review of the plan caught: "check the itinerary is yours, then
       * update by stay id" is two statements, and a stay that moved to another itinerary between
       * them would be written on the strength of a check that no longer applied. One UPDATE whose
       * WHERE carries the profile, the itinerary and the full snapshot cannot be raced apart —
       * either every clause still holds at write time or nothing is written.
       *
       * The snapshot spread is the compare-and-set; `null` in a Prisma where becomes `IS NULL`, so a
       * column that was empty must still be empty.
       *
       * ⚠️ MEASURED, not assumed: `tsc` only proves the generated types allow a relation filter in an
       * `updateMany` where — it says nothing about whether the query builder emits valid SQL for one.
       * Probed against the real database on 2026-07-30 (an id that cannot match, inside a transaction
       * that always rolls back): accepted, count 0, nothing written. If a Prisma upgrade ever breaks
       * this it fails loudly at runtime rather than silently dropping the clause, because a rejected
       * query throws — but re-probe rather than trusting the types after a major bump.
       */
      where: {
        id: input.stayId,
        itineraryId: input.itineraryId,
        itinerary: { profileId: input.profileId },
        ...snapshot,
      },
      data: {
        name: input.replacement.name,
        area: input.replacement.area,
        note: input.replacement.note,
        estimatedNightly: input.replacement.estimatedNightly,
        /**
         * ⚠️ THE VIETNAMESE COLUMNS ARE CLEARED, NOT LEFT ALONE — the subtlest bug in this feature.
         * `nameVi`/`areaVi`/`noteVi` describe the OLD hotel. Leaving them means a Vietnamese reader
         * sees the previous hotel's name against the new one's price, indefinitely, while an English
         * reader sees the correct row — a discrepancy nobody would think to look for. The UI's `loc`
         * helper falls back to the English column when the Vi one is null, so clearing is the
         * honest state: untranslated, never mistranslated.
         */
        nameVi: null,
        areaVi: null,
        noteVi: null,
        // Forced, never taken from the request: the nightly figure is validated as VND at the route
        // boundary, so a body that claimed USD would relabel a đồng amount as dollars.
        currency: 'VND',
      },
    })
    // 0 means the row moved under us — a second tab swapped this hotel, or the trip changed hands.
    // The client re-reads rather than retrying: retrying would overwrite whatever it just lost to.
    if (written.count !== 1) return { ok: false, error: 'stale' }

    return { ok: true }
  } catch (e) {
    console.error('[itinerary-stays] replace failed', (e as Error)?.message?.slice(0, 200))
    return { ok: false, error: 'update_failed' }
  }
}
