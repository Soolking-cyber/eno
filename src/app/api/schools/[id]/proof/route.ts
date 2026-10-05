// /api/schools/[id]/proof — the caller's PRIVATE proof that they worked at this school (2026-10-05).
//   GET  → { proof, open } — their own proof's state, never anyone else's; open = proofs can be taken (the key is set)
//   POST → { action: 'linkedin', url, consent } · { action: 'withdraw' }
//
// A review is published only with a VERIFIED proof (src/lib/schools/queries.ts reviewAuthorSql), and stays
// anonymous: the public sees "Employment checked", never the profile. The proof is a LinkedIn profile a
// moderator checks (src/lib/schools/employment.ts says why there is no work-email route).
// ⛔ NOTHING HERE TELLS ONE TEACHER ABOUT ANOTHER: a profile someone else submitted or proved is flagged to the
// moderator and never mentioned to the caller — otherwise a manager could test each colleague's profile.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { writeEligibility } from '@/lib/schools/queries'
import { EXPIRED_PROOF_REASON, PROOFS_PENDING_MAX, REVIEWS_NEED_PROOF } from '@/lib/schools/constants'
import { PENDING_MAX_DAYS, newChallenge, normaliseLinkedIn, proofConfigured, proofHash, proofKeyMatches, proofKeyMayMatch } from '@/lib/schools/employment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OWN = { id: true, method: true, status: true, linkedinUrl: true, challenge: true, rejectReason: true, updatedAt: true, purgeAt: true } as const
type Own = { id: string; method: string; status: string; linkedinUrl: string | null; challenge: string | null; rejectReason: string | null; updatedAt: Date; purgeAt: Date | null }

/**
 * What the caller may see of their own proof (never a hash, never a flag). ⚠️ A waiting proof past its date is shown
 * as what the nightly sweep will make it — closed, "not checked in time" — never as still waiting (diff review: the
 * page said "waiting" and hid the resend form while every server rule already treated it as no proof).
 */
const view = (p: Own | null) => {
  if (!p) return null
  const expired = p.status === 'pending' && (!p.purgeAt || p.purgeAt <= new Date())
  return {
    method: p.method, status: expired ? 'rejected' : p.status, linkedinUrl: expired ? null : p.linkedinUrl, challenge: expired ? null : p.challenge,
    rejectReason: expired ? EXPIRED_PROOF_REASON : p.status === 'rejected' ? p.rejectReason : null,
  }
}

// ANY status: a teacher can always see and withdraw their proof, even after the school was hidden (diff review) —
// otherwise unhiding it would bring back a review its writer had wanted down. Proving needs an active school.
async function school(id: string) {
  return db.school.findUnique({ where: { id }, select: { id: true, slug: true, status: true, seller: { select: { ownerId: true } } } })
}

type Locked = { id: string; status: string; linkedinUrl: string | null; challenge: string | null; purgeAt: Date | null }
/**
 * ⛔ EVERY WRITE DECIDES ON THE ROW AS IT IS NOW, UNDER ITS LOCK (diff review): a moderator's verification or a
 * withdrawal landing at the same moment waits instead of being overwritten by a decision made from a copy read
 * earlier. `for update` on a missing row locks nothing; the (profileId, schoolId) unique key then turns a racing
 * second create into a P2002, answered as "changed, reload".
 */
async function lockRow(tx: Pick<typeof db, '$queryRaw'>, profileId: string, schoolId: string): Promise<Locked | null> {
  const [row] = await tx.$queryRaw<Locked[]>`
    select id, status, "linkedinUrl", challenge, "purgeAt"
      from "SchoolEmployment" where "profileId" = ${profileId}::uuid and "schoolId" = ${schoolId} for update`
  return row ?? null
}

const revalidate = (slug: string) => { revalidatePublicPath('/schools'); revalidatePublicPath(`/schools/${slug}`) }

export const GET = route({ auth: 'profile' }, async ({ profile, params }) => {
  const s = await school(params.id)
  if (!s) throw new ApiError('not_found', 404)
  const p = await db.schoolEmployment.findUnique({ where: { profileId_schoolId: { profileId: profile.id, schoolId: s.id } }, select: OWN })
  // `open` is read before the teacher fills anything in (diff review: they learned only after ticking consent) —
  // read-only: the POST is what records a first fingerprint.
  return { proof: view(p), open: proofConfigured() && (await proofKeyMayMatch()) }
})

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('linkedin'), url: z.string().trim().min(10).max(300), consent: z.literal(true) }),
  z.object({ action: z.literal('withdraw') }),
])

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'school-proof', limit: 30, window: '1 h', strict: true }, body: Body },
  async ({ profile, params, body }) => {
    const s = await school(params.id)
    if (!s) throw new ApiError('not_found', 404)
    const where = { profileId_schoolId: { profileId: profile.id, schoolId: s.id } }
    // ⛔ NO NEW PROOFS WHILE THEY ARE NOT REQUIRED (constants.ts REVIEWS_NEED_PROOF, off since 2026-10-06 — diff review):
    // the page no longer asks for one or describes how it is kept, so no LinkedIn URL is collected. Withdrawing one
    // already held still works, so anyone can take theirs back.
    if (!REVIEWS_NEED_PROOF && body.action !== 'withdraw') throw new ApiError('not_found', 404)

    if (body.action === 'withdraw') {
      // The hash stays (a profile cannot be cycled through a fresh account); what identifies the person in readable
      // form goes now. Their review stops showing at once (read-time rule); proving again sends it back to the
      // moderators (below).
      const p = await db.$transaction(async (tx) => {
        const row = await lockRow(tx, profile.id, s.id)
        if (!row) return null
        if (row.status === 'withdrawn') return tx.schoolEmployment.findUnique({ where, select: OWN })
        // A REJECTED proof is not live already: withdrawing it only erases what is readable now, and leaves its
        // decision (and the 60-day clock on a review it cannot publish) where it was (diff review).
        if (row.status === 'rejected') return tx.schoolEmployment.update({ where, select: OWN, data: { linkedinUrl: null, challenge: null } })
        return tx.schoolEmployment.update({ where, select: OWN, data: { status: 'withdrawn', linkedinUrl: null, challenge: null, decidedAt: new Date(), decidedBy: 'self' } })
      })
      revalidate(s.slug)
      return { proof: view(p) }
    }

    if (s.status !== 'active') throw new ApiError('not_found', 404)
    // ⛔ No dedicated, never-rotated key, no proof (employment.ts key()) — and not one that differs from the key the
    // other edition already hashes with (employment.ts proofKeyMatches).
    if (!proofConfigured() || !(await proofKeyMatches())) throw new ApiError('not_configured', 503)
    // The same who-may-write rule as votes and reviews; the school's own shop owner can never prove employment.
    const gate = writeEligibility(profile)
    if (!gate.ok) {
      // Each code spelled out as a literal: errors.test.ts harvests the wire vocabulary from literals.
      if (gate.code === 'business_account') throw new ApiError('business_account', 403)
      if (gate.code === 'phone_required') throw new ApiError('phone_required', 403)
      throw new ApiError('account_restricted', 403)
    }
    if (s.seller?.ownerId === profile.id) throw new ApiError('forbidden', 403)

    const li = normaliseLinkedIn(body.url)
    if (!li) throw new ApiError('linkedin_url_invalid', 400)
    // A few waiting at once per account (diff review): the moderators' queue is shared, and a flood of proofs must
    // not bury real ones. (Counted outside the lock: two at the very same moment may make one more — the hourly
    // rate limit bounds it.)
    const waitingElsewhere = await db.schoolEmployment.count({ where: { profileId: profile.id, status: 'pending', purgeAt: { gt: new Date() }, NOT: { schoolId: s.id } } })
    if (waitingElsewhere >= PROOFS_PENDING_MAX) throw new ApiError('too_many_pending_proofs', 429)
    const linkedinHash = proofHash('linkedin', li.slug)
    // (Read outside the row lock: two submitters racing can each miss the flag. The flag is advice to the moderator;
    // the ledger is what refuses, at verify, under its own key.)
    // One LinkedIn profile URL ↔ one eno account. Someone else already submitted or PROVED it (the ledger keeps a
    // proved profile for good, even after a withdrawal or an erasure), or a moderator revoked it: FLAGGED for the
    // moderator, not refused — refusing would tell the caller who has been here (see the file header).
    const [pendingElsewhere, owner, provedOther, revokedBefore] = await Promise.all([
      // LIVE proofs only (diff review): a long-dead attempt by someone else — a fraudster's rejected submission of
      // this profile, say — must not flag its real owner forever. Proved ones are covered by the ledger below.
      db.schoolEmployment.findFirst({ where: { linkedinHash, NOT: { profileId: profile.id }, status: { in: ['pending', 'verified'] } }, select: { id: true } }),
      db.schoolProofKey.findUnique({ where: { kind_hash: { kind: 'linkedin', hash: linkedinHash } }, select: { profileId: true, rejectedAt: true } }),
      // This account proved employment before with ANOTHER profile (diff review: a swap is worth a second look).
      db.schoolProofKey.findFirst({ where: { kind: 'linkedin', profileId: profile.id, NOT: { hash: linkedinHash } }, select: { hash: true } }),
      // …and a moderator revoked a proof of this account's before (diff review: a new profile after a revocation).
      db.schoolProofKey.findFirst({ where: { kind: 'linkedin', profileId: profile.id, rejectedAt: { not: null } }, select: { hash: true } }),
    ])
    const flags = [
      ...(pendingElsewhere || (owner && owner.profileId !== profile.id) ? ['linkedin_shared'] : []),
      ...(provedOther ? ['linkedin_changed'] : []),
      ...(revokedBefore ? ['account_revoked'] : []),
      ...(owner?.rejectedAt ? ['linkedin_revoked'] : []),
    ]
    try {
      const p = await db.$transaction(async (tx) => {
        const row = await lockRow(tx, profile.id, s.id)
        if (row?.status === 'verified') throw new ApiError('proof_already_verified', 409)
        // ⛔ A REVIEW COMES BACK ONLY THROUGH A MODERATOR (diff review): proving again after a withdrawal or a rejection
        // sends this teacher's published review back to the queue — the new proof may be another profile, and the
        // moderator who checks it must read the review it would bring back.
        if (row && (row.status === 'withdrawn' || row.status === 'rejected')) {
          await tx.schoolReview.updateMany({ where: { profileId: profile.id, schoolId: s.id, status: 'published' }, data: { status: 'pending', moderatedAt: null, moderatedBy: null } })
        }
        // ⛔ POSTING THE SAME PROFILE AGAIN WHILE IT WAITS CHANGES NOTHING (diff review): no new 60-day clock (a proof
        // nobody decides is closed at 60 days, whatever the teacher re-sends) and no bumped row under a moderator's open
        // Verify card. A DIFFERENT profile while waiting replaces it, on the same clock.
        // (A waiting proof past its date is not "waiting" any more: sending it again opens a new one — diff review.)
        const waiting = row?.status === 'pending' && !!row.purgeAt && row.purgeAt > new Date()
        if (waiting && row.linkedinUrl === li.url) return tx.schoolEmployment.findUniqueOrThrow({ where, select: OWN })
        // A corrected URL keeps its code only when it is the same profile.
        const challenge = row?.challenge && row.linkedinUrl === li.url ? row.challenge : newChallenge()
        const data = {
          method: 'linkedin', status: 'pending', linkedinUrl: li.url, linkedinHash, challenge, flags,
          // Nothing is kept indefinitely: an undecided proof is closed and erased after PENDING_MAX_DAYS.
          decidedAt: null, decidedBy: null, rejectReason: null,
          purgeAt: waiting && row?.purgeAt ? row.purgeAt : new Date(Date.now() + PENDING_MAX_DAYS * 86_400_000),
        }
        return tx.schoolEmployment.upsert({ where, select: OWN, create: { schoolId: s.id, profileId: profile.id, ...data }, update: data })
      })
      return { proof: view(p) }
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') throw new ApiError('review_changed_reload', 409)
      throw e
    }
  },
)
