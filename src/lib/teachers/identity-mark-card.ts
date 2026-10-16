import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { LISTING_REMOVED } from '@/lib/listing-removed'
import { IDENTITY_MARK_NOTICE_VERSION } from '@/lib/teachers/constants'
import { IDENTITY_MARK_TP_SELECT, identityMarkHidden, identityMarkState, type IdentityMarkReason } from '@/lib/teachers/identity-mark'
import { districtPagesOf } from '@/lib/teachers/revalidate'

// ── THE CARD'S "IDENTITY VERIFIED" TICK — ITS DISPLAY CACHE AND ITS ONE WRITER (owner, 2026-10-15; AUTOMATIC 2026-10-16) ─
//
// A card in a list cannot afford a live identity read per row (a feed page is dozens of cards), so the card reads
// Listing.identityMarkNotice: the IDENTITY_MARK_NOTICE_VERSION — the rule's version — under which this file last computed
// the mark SHOWN, or NULL. A card shows the tick only while that equals today's constant (the card serializer compares —
// plan C6), so a bump takes the tick off every card at once, with no data migration; the card passes then re-derive
// every value (they select every identity holder — identity-reconcile.ts). The opt-in's value ('2026-10-16') is such an
// older value since the mark became automatic ('2026-10-16-auto').
// The public surfaces that hold this value with the row they already read (the profile page, the chat chip) let it SKIP
// their live read (identity-mark.ts identityMarkShownOnCard) — it never decides a tick there either.
//
// ⛔ THIS FILE IS THE ONLY WRITER OF A NON-NULL VALUE (src/lib/compliance/public-state-writes.test.ts MARK_WRITERS
// counts it). Every input that can move the mark re-derives it through here: the teacher's own hide and show-again
// (publish.ts saveTeacherIdentityMark), every profile save — a first Publish, which gives the tick to a teacher verified
// before they had a profile, and a rename (publish.ts saveTeacherProfile) — every identity recompute — a KYC submission,
// decision (an approval turns it on: nothing to switch), revocation — (src/lib/compliance/identity-effects.ts), and the
// card pass of src/lib/compliance/identity-reconcile.ts, the backstop for any of those that failed. A profile delete
// clears it (publish.ts deleteTeacherProfile — no profile, no mark), as does a tombstone's scrub.
// ⛔ AND THE ONE INPUT NO WRITER MOVES — THE CLOCK. A document lapses at 00:00 ICT the day after its expiry date, with no
// event to re-derive anything, and the cache holds only a version: it cannot lapse on its own. So the card pass runs ALONE
// at 00:05 ICT (/api/cron/identity-marks, its own SAFE timer — review, 2026-10-16) as well as after the 09:05 reconcile;
// without it every card would keep the tick for nine hours after each lapse.
// ⛔ RAW SQL, NEVER tx.listing.update: a display cache is not an edit, and Listing.updatedAt is @updatedAt — Prisma
// would restamp it, and things read updatedAt (src/lib/trust.ts cascadeSellerTrustScore says what that once cost).
// IS DISTINCT FROM keeps an in-sync row write-free, and its count is what `changed` reports.
// ⛔ THESE NEVER PURGE: the callers do (revalidateTeacherPages), once the write has committed — whether to purge is the
// caller's decision (a save always purges; the card pass purges when the cache changed, for every identity holder who has
// not hidden the mark, and for a recent hide), and a purge must announce committed state, never a write that can still
// roll back.

/**
 * Write the card cache for one teacher listing: today's IDENTITY_MARK_NOTICE_VERSION while the mark is shown, NULL
 * otherwise. Returns whether the stored value changed. Inside the caller's transaction (a save writes it with its own
 * change).
 * ⛔ A VALUE NEVER LANDS ON A TOMBSTONE (status LISTING_REMOVED): deleting a teacher profile tombstones its listing and
 * blanks the person off it (listing-tombstone.ts PERSONAL_SCRUB_DATA clears this column too) WITHOUT the teacher lock,
 * so a sync that read the profile just before could otherwise write the claim back onto the erasure record. Clearing
 * (NULL) is always allowed.
 */
export async function writeIdentityMarkCard(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, listingId: string, shown: boolean): Promise<boolean> {
  const value = shown ? IDENTITY_MARK_NOTICE_VERSION : null
  const n = await tx.$executeRaw(
    Prisma.sql`UPDATE "Listing" SET "identityMarkNotice" = ${value}::text WHERE "id" = ${listingId} AND "identityMarkNotice" IS DISTINCT FROM ${value}::text AND (${value}::text IS NULL OR "status" <> ${LISTING_REMOVED})`,
  )
  return n > 0
}

/** What a sync found and did — server-only: `reason` and `hidden` go to the caller's own decisions, never to a page. */
export type IdentityMarkCardSync = {
  listingId: string
  /** The district pages the row is on (revalidate.ts districtPagesOf) — what the caller purges with the listing. */
  districts: (string | null)[]
  /** The card cache was written (it disagreed with the mark). */
  changed: boolean
  shown: boolean
  reason: IdentityMarkReason | null
  /** The teacher has HIDDEN the mark, as stored under the lock (identity-mark.ts identityMarkHidden). */
  hidden: boolean
}

/**
 * Re-derive one teacher's card cache from the stored hide, the stored name and the LIVE identity. Null when the
 * account has no TeacherProfile, or one with no listing (nothing to write). ⛔ NEVER PURGES — the caller does.
 *
 * ⛔ THE LOCK FIRST, AND IT IS THE TEACHER SAVES' OWN KEY (publish.ts: pg_advisory_xact_lock(hashtext('teacher:'+id))).
 * So a sync and a save of the same teacher never interleave, and each judges the other's committed input: a revocation
 * commits its identity rows BEFORE its recompute runs this, so a save racing it either committed first (and this sync,
 * waiting on the lock, reads its name and hide) or waits for this sync and then judges the revoked rows itself — the
 * tick can never be left on by the race. The identity read is on the same transaction, after the lock.
 * ⚠️ Called by no one inside a teacher-lock transaction (each caller runs it after its own commit) — it opens its own,
 * and the same key taken twice from two connections would wait on itself.
 */
export async function syncIdentityMarkCard(profileId: string, now: Date = new Date()): Promise<IdentityMarkCardSync | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
    const tp = await tx.teacherProfile.findUnique({
      where: { profileId },
      select: { ...IDENTITY_MARK_TP_SELECT, listingId: true, currentDistrictKey: true, currentDistrict: true },
    })
    if (!tp?.listingId) return null
    const state = await identityMarkState(tp, now, tx)
    const changed = await writeIdentityMarkCard(tx, tp.listingId, state.shown)
    return { listingId: tp.listingId, districts: districtPagesOf(tp), changed, shown: state.shown, reason: state.reason, hidden: identityMarkHidden(tp) }
  })
}

/**
 * ⚖️ ORPHANED CACHES ARE NULLED (commit gate, 2026-10-16): a teacher listing deleted outside the teacher form — the
 * dashboard Delete, /api/v1, MCP, all deleteListingCore — can be HIDDEN instead of scrubbed while a report is open, and
 * no pass that starts from TeacherProfile reaches it again. Any listing still carrying a value with no TeacherProfile
 * behind it is cleared here, in one guarded write (a NULL write — the MARK_WRITERS tripwire allows it anywhere), and its
 * id returned for the caller to purge. Run by the card passes (compliance/identity-reconcile.ts); never purges itself.
 * ⛔ RAW SQL, like the writer above: a display cache is not an edit — @updatedAt must not move.
 */
export async function clearOrphanIdentityMarks(): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "Listing" SET "identityMarkNotice" = NULL
    WHERE "identityMarkNotice" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "TeacherProfile" tp WHERE tp."listingId" = "Listing"."id")
    RETURNING "id"`)
  return rows.map((r) => r.id)
}

/** The dry run's view of clearOrphanIdentityMarks — the same predicate, READ ONLY: how many it would clear. */
export async function countOrphanIdentityMarks(): Promise<number> {
  const rows = await db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int AS n FROM "Listing"
    WHERE "identityMarkNotice" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "TeacherProfile" tp WHERE tp."listingId" = "Listing"."id")`)
  return rows[0]?.n ?? 0
}
