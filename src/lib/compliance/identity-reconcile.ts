import 'server-only'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
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

/**
 * ⚠️ THE COUNTS LEAD, IN THIS ORDER: the route spreads this into its body and eno-cron.sh keeps only the first 200 bytes
 * of the response in the journal — `checked` and `failed` must be among them. The dry run's extras come after.
 */
export type IdentityReconcileResult = {
  /** Distinct profiles with at least one identity row. */
  checked: number
  /** Profiles recomputeVerification ran for (0 on a dry run). */
  recomputed: number
  /** Cache writes (RecomputeResult.changed). */
  changed: number
  /** A recompute that threw, or whose effects did not complete. Any → the route answers 500. */
  failed: number
  /** Cache moves refused as impossible (reported, never failed). A dry run: the moves a real run would refuse. */
  illegal: number
  /** Profiles whose persisted trust score moved. */
  trustMoved: number
  /** Teacher accounts whose pages were purged. */
  purged: number
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
  const out: IdentityReconcileResult = { checked: ids.length, recomputed: 0, changed: 0, failed: 0, illegal: 0, trustMoved: 0, purged: 0 }
  if (!ids.length) return opts.dryRun ? { ...out, dryRun: true, mismatched: 0, teachers: 0, profiles: [] } : out

  if (opts.dryRun) return preview(ids, now, out)

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
    } catch (e) {
      out.failed++
      try { logError(e, { op: 'identity.reconcile', profileId }) } catch { /* the logger never throws; belt and braces */ }
    }
  }
  return out
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
