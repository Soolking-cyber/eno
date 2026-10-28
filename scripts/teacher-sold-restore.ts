/**
 * One-off (owner, 2026-10-27: "restore for people who ticked and profile disappeared"): put back every teacher profile the
 * goods availability review marked SOLD. The review ("Still available? Tick anything that sold") listed teachers' profiles
 * too, and teachers ticked their own — meaning "yes, available" — which set the listing 'sold' (out of search) while the
 * TeacherProfile stayed 'live'. Measured on prod the same day: 4 such rows, none with a single chat (so the chat's "mark
 * sold" — which setStatusCore refuses for a teacher anyway — was not the way), each after "reminder" bells.
 *
 *   npx tsx scripts/teacher-sold-restore.ts                       # dry run (identity gate read as ON — fail closed)
 *   npx tsx scripts/teacher-sold-restore.ts --gate=on  --apply    # production enforces IDENTITY_GATE_ENFORCED
 *   npx tsx scripts/teacher-sold-restore.ts --gate=off --apply    # production does not
 *
 * ⛔ THE ORDER: --apply RIGHT BEFORE THE DEPLOY that takes teachers out of the review, then THIS DRY RUN ONCE MORE AFTER IT.
 * The deploy starts every page cache cold (ISR is keyed by BUILD_ID, and the deploy purges the edge), so the restored
 * profiles are on every page at once — run after it, the category pages, the home shelf and each profile's own page
 * would keep the sold state for their ISR window (opus, gate). A teacher who ticks the old box again in the minutes
 * between shows up in the second dry run: --apply again (codex's plan-review point — the old door stays open until the
 * deploy). Re-runnable: a run with nothing sold finds nothing. Search reads the row live in production (keyword search);
 * the AI index the sold path dropped them from is touched only where Vertex is configured (listing-index.ts
 * removeFromIndex returns early otherwise), so there is nothing to re-index here. Reads DIRECT_URL / DATABASE_URL (prod: the tunnel). Prints listing ids and counts only.
 *
 * WHAT COMES BACK — the rules setTeacherStatus(…, 'live') applies to a teacher's own "show my profile", re-checked per row
 * under the saves' advisory lock ('teacher:'+profileId):
 *   · the listing is a teacher's, 'sold', verified, not under an identity hold — moderation and holds are never undone;
 *   · the TeacherProfile still says 'live' (the teacher never hid it) and still has something to be found for
 *     (profile.ts hasTeachingGoal: a job type, or cover that is public);
 *   · the account may post: not held or suspended (enforcement-machine.ts blocksPosting), storefront not 'restricted';
 *   · ⚖️ THE SELLER IDENTITY GATE (NĐ 248/2026) says yes — the app's own pure rules (seller-publish-decision.ts over the
 *     identity_verifications derivation), wired as scripts/publish-held.ts wires them. ⛔ THE GATE STATE IS AN ARGUMENT
 *     (--gate=on|off), never this shell's env (publish-held.ts says why); a refused owner's listing is LEFT sold and
 *     counted — never published, never held by this script;
 *   · ⛔ THE LICENCE GUARD is ANDed into the write (licenceClearedWhere, no desk — fail closed), though a teacher's
 *     listing is never in the e-Visa or Legal & permits aisles.
 * The write is the relist setStatusCore makes: status 'active', soldAt cleared. Search results follow at once (they read
 * the row live); category pages and the home shelf within their ISR window.
 */
import { config } from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { blocksPosting, normalizeEnforcementState } from '../src/lib/enforcement-machine'
import { identityGateEnforced } from '../src/lib/compliance/account-state'
import { deriveVerification, type VerificationRow } from '../src/lib/compliance/derive-verification'
import { decideBeforeStatus, decideOwned, type SellerPublishDecision } from '../src/lib/compliance/seller-publish-decision'
import { licenceClearedWhere } from '../src/lib/licence-stamp'
import { hasTeachingGoal } from '../src/lib/teachers/profile'
import { teacherInputOfRow } from '../src/lib/teachers/projection'

config({ quiet: true })
const APPLY = process.argv.includes('--apply')
const GATE_ARG = process.argv.find((a) => a.startsWith('--gate='))?.slice('--gate='.length)
if (GATE_ARG !== undefined && GATE_ARG !== 'on' && GATE_ARG !== 'off') { console.error(`⛔ --gate must be on or off (got "${GATE_ARG}").`); process.exit(2) }
if (APPLY && !GATE_ARG) { console.error('⛔ --apply needs --gate=on or --gate=off: say whether PRODUCTION enforces IDENTITY_GATE_ENFORCED (the box env). This shell cannot tell.'); process.exit(2) }
// ⛔ Fail CLOSED: only an explicit --gate=off skips the gate.
const ENFORCED = GATE_ARG !== 'off'
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL || ''
if (!DB_URL) { console.error('Set DATABASE_URL / DIRECT_URL'); process.exit(1) }
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) })

type Verdict = 'restored' | 'would_restore' | 'moved' | 'profile_hidden' | 'no_goal' | 'account_blocked' | 'identity_refused'

/** One owner's identity decision — the app's rules over the app's derivation (publish-held.ts's wiring). */
async function decide(ownerId: string, now: Date): Promise<SellerPublishDecision> {
  const p = await db.profile.findUnique({ where: { id: ownerId }, select: { createdAt: true } })
  const accountCreatedAt = p?.createdAt ?? null
  const early = decideBeforeStatus({ enforced: ENFORCED, ownerId, accountCreatedAt, now })
  if (early) return early
  const iv = await db.$queryRaw<VerificationRow[]>`SELECT id, tier, method, status, "decidedAt", "documentExpiresAt", "assuranceLevel"
    FROM identity_verifications WHERE "profileId" = ${ownerId}::uuid ORDER BY "submittedAt" DESC`
  return decideOwned(deriveVerification(iv, now).status, accountCreatedAt, now)
}

async function main() {
  const rows = await db.teacherProfile.findMany({
    where: { listing: { is: { listingType: 'teacher', status: 'sold' } } },
    select: { profileId: true, listingId: true },
    orderBy: { createdAt: 'asc' },
  })
  const tally: Record<Verdict, string[]> = { restored: [], would_restore: [], moved: [], profile_hidden: [], no_goal: [], account_blocked: [], identity_refused: [] }
  if (identityGateEnforced() !== ENFORCED) console.warn(`(note: this shell's env reads the gate as ${identityGateEnforced() ? 'ON' : 'off'}; using --gate=${GATE_ARG ?? 'on (default for a dry run)'})`)
  for (const { profileId, listingId } of rows) {
    if (!listingId) continue
    const v: Verdict = await db.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profileId}))`
      const tp = await tx.teacherProfile.findUnique({ where: { profileId } })
      const l = await tx.listing.findUnique({ where: { id: listingId }, select: { status: true, listingType: true, verified: true, identityHold: true, seller: { select: { trustTier: true, owner: { select: { enforcementState: true } } } } } })
      if (!tp || tp.listingId !== listingId || !l || l.listingType !== 'teacher' || l.status !== 'sold' || !l.verified || l.identityHold) return 'moved'
      if (tp.status !== 'live') return 'profile_hidden'
      if (!hasTeachingGoal(teacherInputOfRow(tp))) return 'no_goal'
      if (l.seller.trustTier === 'restricted' || blocksPosting(normalizeEnforcementState(l.seller.owner?.enforcementState))) return 'account_blocked'
      // The identity decision under the lock, at this moment (codex, gate) — the teacher's account owns the storefront.
      if (!(await decide(profileId, new Date())).ok) return 'identity_refused'
      if (!APPLY) return 'would_restore'
      const n = await tx.listing.updateMany({ where: { id: listingId, status: 'sold', verified: true, identityHold: false, seller: { ownerId: profileId }, ...licenceClearedWhere([]) }, data: { status: 'active', soldAt: null } })
      return n.count === 1 ? 'restored' : 'moved'
    })
    tally[v].push(listingId)
  }
  console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — teacher listings marked sold: ${rows.length}`)
  for (const [k, ids] of Object.entries(tally)) if (ids.length) console.log(`  ${k}: ${ids.length}  ${ids.join(' ')}`)
  if (!APPLY && tally.would_restore.length) console.log('Re-run with --apply to put them back.')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => db.$disconnect())
