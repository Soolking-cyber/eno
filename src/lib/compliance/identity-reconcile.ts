import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { IDENTITY_MARK_NOTICE_VERSION } from '@/lib/teachers/constants'
import { IDENTITY_MARK_TP_SELECT, identityMarkHidden, identityMarkState } from '@/lib/teachers/identity-mark'
import { clearOrphanIdentityMarks, countOrphanIdentityMarks, syncIdentityMarkCard } from '@/lib/teachers/identity-mark-card'
import { revalidateTeacherPages } from '@/lib/teachers/revalidate'
import { canTransition, type VerificationStatus } from './account-state'
import { asStatus, deriveVerification } from './derive-verification'
import { recomputeVerification } from './recompute-verification'

// ── THE NIGHTLY IDENTITY RECONCILE (owner, 2026-10-15; plan review R3/R4) ───────────────────────────────────────────
//
// Every profile that has ANY identity_verifications row is recomputed, every night, one at a time:
// recomputeVerification — the Profile.verification* cache, the identity-hold release, and the identity effects (trust,
// enforcement, a teacher's pages — identity-effects.ts). Idempotent: a profile already in sync costs its reads.
// Run by /api/cron/identity-reconcile at 09:05 ICT (its header says why then and not at midnight).
//
// ⛔ EVERY SUCH PROFILE, NOT A WINDOW OF RECENT EXPIRIES. A window only ever revisits what it is shown: a lapse older
// than the window (the timer was down for a week), a REVOKED identity (revokeIdentity rewrites the verified row in place,
// so no expiry query finds it again) and an approval or revocation whose effects failed (its row is not "expiring" at
// all) would each stay wrong for good. Walking all of them is what makes this the backstop for every one-shot effect:
// whatever a decision's own recompute missed is put right within a day. The set is small — 2–3 profiles on 2026-10-15
// — and grows only with KYC submissions.
// ⛔ NO "all" MODE AND NO FLAG: a normal run IS the deploy-day backfill. Every verified identity's +10 lands on its first
// recompute, because recomputeTrust never caps the identity's own step (and caps everything else — trust.ts).
// ⚠️ SEQUENTIAL. Each recompute is a dozen reads plus guarded writes, and its effects may purge pages; a throw is
// counted, logged, and the loop goes on — one bad profile never stops the others' document clocks.
// ⚠️ `illegal` IS REPORTED, NOT FAILED: recomputeVerification refuses an impossible cache move (out of `revoked`, say,
// after a hand-edited row) and leaves the cache as it was — a fact for a person to look at, not this run failing. The
// effects still ran on the derived status. A profile whose effects did not complete IS failed (the unit goes red).
// ⛔ A DRY RUN READS ONLY: it derives each status from the rows, compares the cache, and says which accounts are
// teachers — no recompute, no cache write, no trust or enforcement write, no purge. Its test pins zero writes.
//
// ── AND THE CARD-TICK PASS (C4, owner 2026-10-15 — the teacher card's "Identity verified", identity-mark-card.ts) ────
// AUTOMATIC since 2026-10-16 (identity-mark.ts): the mark shows by itself while the identity check is live and the name
// is within the ID's, unless the teacher hid it. After the loop, the pass syncs once more every teacher who may need it
// — skipping those whose recompute above ran its effects clean (those effects already synced the card and purged the
// pages):
//   · every teacher whose account holds ANY identity row — the mark may have to APPEAR (an approval whose own sync
//     failed, a deploy that changed the rule — the automatic rule's own deploy among them: this IS its backfill);
//   · every teacher whose card cache carries a value — it may have to GO (a lapse, a revocation, a rename, the stale
//     values a bump of IDENTITY_MARK_NOTICE_VERSION leaves — the pass clears them);
//   · every teacher who HID it in the last 7 days (TeacherProfile.identityMarkWithdrawnAt — the purge retry below).
// It is what puts right what no identity recompute ever revisits — a teacher with no identity row whose card still
// carries a value — and any teacher whose recompute threw or whose effects failed tonight. One at a time, each its own
// guard; a failure is counted into the run's `failed` (the unit goes red) and the pass goes on.
// ⚖️ IT PURGES WHEN IT REWROTE THE CACHE, AND EVERY NIGHT FOR EVERY IDENTITY HOLDER WHO HAS NOT HIDDEN THE MARK AND EVERY
// TEACHER WHO HID IT IN THE LAST 7 DAYS (commit gate, 2026-10-16): a purge that threw after its sync committed — a
// lapse's, a revocation's, a hide's own — is otherwise never retried, because the next night finds the cache already
// right, and a 30-day ISR page keeps a claim the cache dropped. ⚠️ "Not hidden", NEVER "shown": after a lapse or a
// revocation the mark is no longer shown, and the cache may already have been NULL (the sync then reports no change) —
// a purge rule on `shown` would never retry exactly the purge that takes the claim off. Bounded by the teachers who hold
// an identity row; a cheap, idempotent revalidation each.
// ⚖️ AND IT CLEARS ORPHANED CACHES: a teacher listing deleted outside the teacher form (the dashboard, /api/v1, MCP — all
// deleteListingCore) can be HIDDEN instead of scrubbed when a report is open, and nothing selected through TeacherProfile
// reaches it again; any cache left on a listing with no TeacherProfile behind it is nulled (and its pages purged), so a
// later relist can never show the tick.
// revalidatePath records the purge in-process, so it has no I/O of its own to fail on; the count keeps a failure loud.
// ⛔ ITS DRY RUN WRITES NOTHING EITHER (plan review codex #5): it judges each selected teacher's mark with the same
// predicate (identityMarkState, read-only) and compares it with the stored cache — no sync, no cache write, no purge —
// over EVERY selected teacher, since no loop ran before it. With every identity holder selected, a deploy-day
// `?dryRun=1` counts the ticks the automatic rule will turn on (`shown`, and `changed` for each card still NULL).
//
// ── AND THE SAME PASS ALONE, AT 00:05 ICT (review, 2026-10-16 — reconcileIdentityMarks, /api/cron/identity-marks) ──────
// A document lapses at 00:00 ICT the day after its expiry date (deriveVerification), and the mark with it: "only while the
// identity check is LIVE" (owner). But a lapse is a CLOCK, not an event — no decision, no save, no recompute happens at
// midnight — and this reconcile runs at 09:05. Left to it, a card would keep "Identity verified" for nine hours after
// every lapse (a day and more when its timer misses a morning: it is not replayed at boot), and so would the profile line
// an ISR page baked in. So the card-tick pass ALSO runs alone, five minutes after midnight, on its own timer: the same
// selection, synced — and purged — exactly as above (nobody is skipped: no loop ran), which also makes it a complete
// backfill on its own. The chat chip needs none of this for a lapse: it judges the live identity on every poll of a
// teacher whose card carries the tick (identity-mark.ts identityMarkShownOnCard).
// ⛔ IT DOES NOTHING ELSE — no recompute, no verification cache, no trust, no enforcement — so it sends nothing in the
// night; the rest of a lapse still lands at 09:05 (the route's header says why then). Idempotent, so it IS replayed at
// boot when its timer was missed (a sync and a purge are silent at any hour).

/** The columns deriveVerification reads — the same selection recompute-verification makes — plus the owner. */
const ROW_SELECT = {
  id: true, profileId: true, tier: true, method: true, status: true,
  decidedAt: true, documentExpiresAt: true, assuranceLevel: true,
} as const

/** One account as a dry run sees it: ids and statuses only — no row's contents leave this module. */
export type IdentityReconcilePreview = {
  profileId: string
  /** What the rows say today (deriveVerification at `now`). */
  derived: VerificationStatus
  /** What Profile.verificationStatus says — the cache a real run writes. */
  cached: VerificationStatus
  /** derived ≠ cached: a real run writes the cache, or reports the move illegal. */
  mismatch: boolean
  /** The cache move a real run would refuse (account-state.ts canTransition). */
  illegal: boolean
  /** The account owns a TeacherProfile: a real run purges its pages. */
  teacher: boolean
}

/** The card-tick pass (C4 — see the header): what it looked at and did. A dry run: what it WOULD do. */
export type IdentityMarkPass = {
  /**
   * Teachers the pass judged: after the reconcile's loop, the selected ones it did not handle cleanly; run alone
   * (reconcileIdentityMarks) or in a dry run, every one selected.
   */
  checked: number
  /** Card caches rewritten (a dry run: that disagree with the mark today). */
  changed: number
  /** Teachers whose pages were purged (a dry run: would be). */
  purged: number
  /** A selection, sync, purge or (dry run) read that threw — logged as identity.reconcile.mark, and counted in the run's `failed`. */
  failed: number
  /** Dry run only: the teacher cards that would show the tick. */
  shown?: number
}

/**
 * ⚠️ THE COUNTS LEAD, IN THIS ORDER: the route spreads this into its body and eno-cron.sh keeps only the first 200 bytes
 * of the response in the journal — `checked` and `failed` must be among them. `marks` comes right after (about 60 bytes);
 * the dry run's extras come after that.
 */
export type IdentityReconcileResult = {
  /** Distinct profiles with at least one identity row. */
  checked: number
  /** Profiles recomputeVerification ran for (0 on a dry run). */
  recomputed: number
  /** Cache writes (RecomputeResult.changed). */
  changed: number
  /** A recompute that threw, or whose effects did not complete — plus the card pass's failures. Any → the route answers 500. */
  failed: number
  /** Cache moves refused as impossible (reported, never failed). A dry run: the moves a real run would refuse. */
  illegal: number
  /** Profiles whose persisted trust score moved. */
  trustMoved: number
  /** Teacher accounts whose pages were purged. */
  purged: number
  /** The card-tick pass (C4). Its failures are already in `failed`. */
  marks: IdentityMarkPass
  dryRun?: true
  /** Dry run: profiles whose cache disagrees with the rows. */
  mismatched?: number
  /** Dry run: profiles that own a TeacherProfile. */
  teachers?: number
  /** Dry run: one line per profile. */
  profiles?: IdentityReconcilePreview[]
}

export async function reconcileIdentities(opts: { now?: Date; dryRun?: boolean } = {}): Promise<IdentityReconcileResult> {
  const now = opts.now ?? new Date()
  // Every distinct owner — erased accounts' rows are kept pseudonymised with profileId NULL (schema.prisma), and there
  // is nobody to recompute for them. Served by the [profileId, status] index.
  const owners = await db.identityVerification.findMany({
    where: { profileId: { not: null } },
    select: { profileId: true },
    distinct: ['profileId'],
    orderBy: { profileId: 'asc' },
  })
  const ids = [...new Set(owners.map((o) => o.profileId).filter((x): x is string => !!x))]
  const out: IdentityReconcileResult = { checked: ids.length, recomputed: 0, changed: 0, failed: 0, illegal: 0, trustMoved: 0, purged: 0, marks: noMarks() }

  if (opts.dryRun) {
    const res = ids.length ? await preview(ids, now, out) : { ...out, dryRun: true as const, mismatched: 0, teachers: 0, profiles: [] }
    res.marks = await markPreview(now)
    res.failed += res.marks.failed
    return res
  }

  // The profiles whose recompute ran its identity effects CLEAN — the card sync and the purge among them. The card pass
  // below skips exactly these; a recompute that threw, or whose effects did not run or failed, gets its own sync there.
  const handled = new Set<string>()
  for (const profileId of ids) {
    try {
      const r = await recomputeVerification(profileId, now)
      out.recomputed++
      if (r.changed) out.changed++
      if (r.illegalTransition) out.illegal++
      if (r.effects?.trustMoved) out.trustMoved++
      if (r.effects?.purged) out.purged++
      // Effects that could not run at all, or a step that threw: the trust / enforcement / purge this profile needed
      // may not have happened. Tomorrow's run retries; today's unit says so.
      if (!r.effects || r.effects.failed) out.failed++
      else handled.add(profileId)
    } catch (e) {
      out.failed++
      try { logError(e, { op: 'identity.reconcile', profileId }) } catch { /* the logger never throws; belt and braces */ }
    }
  }
  out.marks = await markPass(handled, now)
  out.failed += out.marks.failed
  return out
}

/** The card-tick pass run alone (/api/cron/identity-marks): its counts — `failed` among them — and a dry run's extras. */
export type IdentityMarksResult = IdentityMarkPass & { dryRun?: true }

/**
 * THE CARD-TICK PASS ALONE, at 00:05 ICT (the header's last section): the moment a document lapses, every selected
 * teacher's card cache is re-derived from the live identity and their pages purged when it changed — NOTHING else (no
 * recompute, no trust, no enforcement: nothing that can send a notice at night). Never throws; a failure is counted in
 * `failed` (the route answers 500) and the pass goes on. `dryRun`: the same judgement, read only (markPreview).
 */
export async function reconcileIdentityMarks(opts: { now?: Date; dryRun?: boolean } = {}): Promise<IdentityMarksResult> {
  const now = opts.now ?? new Date()
  if (opts.dryRun) return { ...(await markPreview(now)), dryRun: true }
  return markPass(new Set(), now)
}

const noMarks = (): IdentityMarkPass => ({ checked: 0, changed: 0, purged: 0, failed: 0 })

/**
 * The card pass's selection (the header): a teacher whose account holds ANY identity row (the mark may have to appear),
 * whose card cache carries a value (it may have to go), or who hid the mark in the last 7 days (its purge is retried).
 * Anyone else's card is NULL and stays NULL — with no identity row the mark cannot show. A TeacherProfile read, the
 * account's identity rows and the listing reached through their relations; never a read of db.listing.
 */
const WITHDRAWAL_RETRY_DAYS = 7
const recentHideSince = (now: Date) => new Date(now.getTime() - WITHDRAWAL_RETRY_DAYS * 86_400_000)
const markSelection = (now: Date): Prisma.TeacherProfileWhereInput => ({
  OR: [
    // Typed against the generated client: TeacherProfile.profile → Profile.identityVerifications (schema.prisma) — tsc
    // refuses a relation that does not exist, so this arm cannot silently fail to compile into a working query.
    { profile: { is: { identityVerifications: { some: {} } } } },
    { listing: { is: { identityMarkNotice: { not: null } } } },
    // A hide in the last 7 days (the hide's stamp — identity-mark.ts): its pages are purged again each night, in case
    // the save's own purge failed.
    { identityMarkWithdrawnAt: { gte: recentHideSince(now) } },
  ],
})

/**
 * The selected teachers, with what a dry run judges from: the mark's inputs (the hide's two columns among them), the
 * stored cache — and whether the account holds an identity row (one row's id is enough to say so; nothing of it leaves).
 */
function selectMarked(now: Date) {
  return db.teacherProfile.findMany({
    where: markSelection(now),
    select: {
      ...IDENTITY_MARK_TP_SELECT,
      listing: { select: { identityMarkNotice: true, status: true } },
      profile: { select: { identityVerifications: { select: { id: true }, take: 1 } } },
    },
    orderBy: { profileId: 'asc' },
  })
}

/** The account holds an identity row (the selection's first arm) — whatever its status. */
const holdsIdentity = (t: { profile: { identityVerifications: unknown[] } | null }) => (t.profile?.identityVerifications.length ?? 0) > 0

const hidRecently = (t: { identityMarkWithdrawnAt: Date | null }, now: Date) =>
  t.identityMarkWithdrawnAt !== null && t.identityMarkWithdrawnAt >= recentHideSince(now)

const logMark = (e: unknown, profileId?: string) => {
  try { logError(e, { op: 'identity.reconcile.mark', ...(profileId ? { profileId } : {}) }) } catch { /* the logger never throws; belt and braces */ }
}

/**
 * THE CARD-TICK PASS (header): sync each selected teacher the loop did not handle (run alone at 00:05, `handled` is
 * empty), one at a time; purge when the cache changed, when an identity holder has not hidden the mark, or when they hid
 * it in the last 7 days. Never throws — a failure is counted and logged.
 * The sync re-reads the hide, the name and the identity under the teacher lock (syncIdentityMarkCard), so `r.hidden` —
 * not the selection's copy — decides the holder's purge.
 */
async function markPass(handled: ReadonlySet<string>, now: Date): Promise<IdentityMarkPass> {
  const marks = noMarks()
  let teachers: Awaited<ReturnType<typeof selectMarked>>
  try {
    teachers = await selectMarked(now)
  } catch (e) {
    marks.failed++
    logMark(e)
    return marks
  }
  for (const t of teachers) {
    if (handled.has(t.profileId)) continue
    marks.checked++
    try {
      const r = await syncIdentityMarkCard(t.profileId, now)
      if (!r) continue // no profile any more, or no listing: no card to write, no page of its own
      if (r.changed) marks.changed++
      // ⚖️ PURGED WHEN THE CACHE CHANGED, AND EVERY NIGHT FOR AN IDENTITY HOLDER WHO HAS NOT HIDDEN IT (commit gate,
      // 2026-10-16): a purge that threw after its sync committed is otherwise never retried — the next night finds the
      // cache already right — and the 30-day ISR profile page keeps a claim the cache dropped (a lapse, a revocation).
      // ⛔ NOT `r.shown`: a lapsed or revoked mark is not shown, and its cache may already be NULL (`changed` false) —
      // exactly the page whose failed purge must be retried. And a recent hide, for its own failed purge.
      if (r.changed || (holdsIdentity(t) && !r.hidden) || hidRecently(t, now)) {
        revalidateTeacherPages(r.listingId, r.districts)
        marks.purged++
      }
    } catch (e) {
      marks.failed++
      logMark(e, t.profileId)
    }
  }
  // Orphaned caches (header): nulled in one guarded write, then each listing's pages purged — each purge its own guard,
  // so one that throws neither stops the rest nor goes uncounted.
  let orphans: string[] = []
  try {
    orphans = await clearOrphanIdentityMarks()
  } catch (e) {
    marks.failed++
    logMark(e)
  }
  for (const listingId of orphans) {
    marks.changed++
    try {
      revalidateTeacherPages(listingId, [])
      marks.purged++
    } catch (e) {
      marks.failed++
      logMark(e)
    }
  }
  return marks
}

/**
 * The card pass's DRY RUN: the same selection, every teacher in it, judged with the same predicate — READ ONLY (no
 * sync, no cache write, no purge). `changed` counts the caches that disagree with the mark today; `purged`, the purges a
 * real pass would make; `shown`, the cards that would carry the tick.
 */
async function markPreview(now: Date): Promise<IdentityMarkPass> {
  const marks: IdentityMarkPass = { ...noMarks(), shown: 0 }
  let teachers: Awaited<ReturnType<typeof selectMarked>>
  try {
    teachers = await selectMarked(now)
  } catch (e) {
    marks.failed++
    logMark(e)
    return marks
  }
  for (const t of teachers) {
    marks.checked++
    try {
      const state = await identityMarkState(
        { profileId: t.profileId, fullName: t.fullName, identityMarkOn: t.identityMarkOn, identityMarkWithdrawnAt: t.identityMarkWithdrawnAt },
        now,
      )
      if (!t.listing) continue // as the real pass: no listing, nothing to write or purge
      if (state.shown) marks.shown = (marks.shown ?? 0) + 1
      // A removed listing never takes a value (the writer's guard): only clearing one counts as a change there.
      const target = state.shown && t.listing.status !== 'removed' ? IDENTITY_MARK_NOTICE_VERSION : null
      const changed = (t.listing.identityMarkNotice ?? null) !== target
      if (changed) marks.changed++
      // The real pass's rule (markPass), on the selection's copy of the hide.
      if (changed || (holdsIdentity(t) && !identityMarkHidden(t)) || hidRecently(t, now)) marks.purged++
    } catch (e) {
      marks.failed++
      logMark(e, t.profileId)
    }
  }
  // The orphans the real pass would clear and purge — read only (the same predicate as clearOrphanIdentityMarks).
  try {
    const orphans = await countOrphanIdentityMarks()
    marks.changed += orphans
    marks.purged += orphans
  } catch (e) {
    marks.failed++
    logMark(e)
  }
  return marks
}

/** The dry run: three batched reads (rows, cache, teachers), no write of any kind. */
async function preview(ids: string[], now: Date, out: IdentityReconcileResult): Promise<IdentityReconcileResult> {
  const [rows, profiles, teachers] = await Promise.all([
    db.identityVerification.findMany({ where: { profileId: { in: ids } }, select: ROW_SELECT }),
    db.profile.findMany({ where: { id: { in: ids } }, select: { id: true, verificationStatus: true } }),
    db.teacherProfile.findMany({ where: { profileId: { in: ids } }, select: { profileId: true } }),
  ])
  const byProfile = new Map<string, typeof rows>()
  for (const r of rows) if (r.profileId) byProfile.set(r.profileId, [...(byProfile.get(r.profileId) ?? []), r])
  const cacheOf = new Map(profiles.map((p) => [p.id, p.verificationStatus] as const))
  const teacherSet = new Set(teachers.map((t) => t.profileId))
  const lines: IdentityReconcilePreview[] = ids.map((profileId) => {
    const derived = deriveVerification(byProfile.get(profileId) ?? [], now).status
    // The same reading of the cache recomputeVerification makes: absent or unknown is `unverified`.
    const cached = asStatus(cacheOf.get(profileId) ?? 'unverified') ?? 'unverified'
    const mismatch = derived !== cached
    return { profileId, derived, cached, mismatch, illegal: mismatch && !canTransition(cached, derived), teacher: teacherSet.has(profileId) }
  })
  return {
    ...out,
    illegal: lines.filter((l) => l.illegal).length,
    dryRun: true,
    mismatched: lines.filter((l) => l.mismatch).length,
    teachers: lines.filter((l) => l.teacher).length,
    profiles: lines,
  }
}
