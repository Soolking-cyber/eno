// /api/schools/[id]/review — the caller's own review of one school (2026-10-04).
//   GET    → the caller's review (any status) for the edit form, or { review: null }
//   POST   → create or edit; EVERY write lands as `pending` (reviews are pre-moderated)
//   DELETE → the caller withdraws it: the row is DELETED — text, pay and all (a reviewer's "take it down"
//            must not leave their words and pay stored); helpful votes go with it, reports keep their row
//
// ⛔ A REVIEW NEEDS A PROOF OF EMPLOYMENT (2026-10-05, see POST) and is published only once that proof is verified.
// ⛔ PRE-MODERATION IS THE LEGAL SAFEGUARD (plan review 2026-10-04: Vietnam's reputation/defamation rules
// apply to anonymous employer reviews). Nothing a teacher writes is public until a moderator approves it.
// ⛔ PAY NEVER COMES BACK OUT except to its author: public pages only ever see the k≥5 aggregate.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { assertCleanTexts, PublishBlockedError } from '@/lib/publish-guard'
import { writeEligibility } from '@/lib/schools/queries'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { payInBand, screenReviewText, toVnd } from '@/lib/schools/logic'
import {
  BAD_TAGS, EMPLOYMENTS, GOOD_TAGS, HCMC_AREAS, REVIEW_ADVICE_MAX, REVIEW_TEXT_MAX, REVIEW_TEXT_MIN, ROLES, TENURES, REVIEWS_NEED_PROOF,
} from '@/lib/schools/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MINE = {
  id: true, current: true, tenure: true, leftYear: true, showLeftYear: true, role: true, employment: true, district: true,
  pros: true, cons: true, advice: true, goodTags: true, badTags: true, payAmount: true, payCurrency: true, payPeriod: true,
  status: true, rejectReason: true, updatedAt: true,
} as const

export const GET = route({ auth: 'profile' }, async ({ profile, params }) => {
  const review = await db.schoolReview.findUnique({ where: { schoolId_profileId: { schoolId: params.id, profileId: profile.id } }, select: MINE })
  return { review: review && review.status !== 'removed' ? review : null }
})

const Body = z.object({
  confirm: z.literal(true), // "I worked here" — required
  current: z.boolean(),
  tenure: z.enum(TENURES),
  // Checked per request, not at module load: a process started in December must accept January's year.
  leftYear: z.number().int().min(1990).refine((y) => y <= new Date().getFullYear()).nullable().optional(),
  showLeftYear: z.boolean().optional(),
  role: z.enum(ROLES),
  employment: z.enum(EMPLOYMENTS),
  district: z.enum(HCMC_AREAS).nullable().optional(),
  // The MINIMUM in characters, as Postgres counts them (SchoolReview_text_check): `.length` counts UTF-16
  // units, so an emoji-padded text could pass a .min() here and fail the database with a 500. The .max()
  // stays in UTF-16 units — stricter than the database, never looser.
  pros: z.string().trim().max(REVIEW_TEXT_MAX).refine((v) => [...v].length >= REVIEW_TEXT_MIN),
  cons: z.string().trim().max(REVIEW_TEXT_MAX).refine((v) => [...v].length >= REVIEW_TEXT_MIN),
  advice: z.string().trim().max(REVIEW_ADVICE_MAX).nullable().optional(),
  goodTags: z.array(z.enum(GOOD_TAGS)).max(GOOD_TAGS.length).optional(),
  badTags: z.array(z.enum(BAD_TAGS)).max(BAD_TAGS.length).optional(),
  pay: z.object({ amount: z.number().positive().max(1_000_000_000), currency: z.enum(['VND', 'USD']), period: z.enum(['hour', 'month']) }).nullable().optional(),
})

/**
 * VND per 1 USD from the same free source /api/fx uses. null = unavailable (→ 503, "enter VND instead").
 * ⚠️ NOT a `next: { revalidate }` fetch: Next would cache an ERROR reply for the whole window and refuse
 * every USD entry for hours; USD pay is rare, so one live call with a 5 s timeout is the honest cost.
 */
async function vndPerUsd(): Promise<number | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/VND', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const d = await res.json()
    const usdPerVnd = d?.result === 'success' ? Number(d?.rates?.USD) : NaN
    return Number.isFinite(usdPerVnd) && usdPerVnd > 0 ? Math.round(1 / usdPerVnd) : null
  } catch {
    return null
  }
}

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'school-review', limit: 10, window: '1 h', strict: true }, body: Body },
  async ({ profile, body, params }) => {
    const school = await db.school.findFirst({ where: { id: params.id, status: 'active' }, select: { id: true, seller: { select: { ownerId: true } } } })
    if (!school) throw new ApiError('not_found', 404)
    const gate = writeEligibility(profile)
    if (!gate.ok) {
      // Each code spelled out as a literal: errors.test.ts harvests the wire vocabulary from literals.
      if (gate.code === 'business_account') throw new ApiError('business_account', 403)
      if (gate.code === 'phone_required') throw new ApiError('phone_required', 403)
      throw new ApiError('account_restricted', 403)
    }
    // The school's own shop owner does not review it.
    if (school.seller?.ownerId === profile.id) throw new ApiError('forbidden', 403)
    // ⛔ PROOF OF EMPLOYMENT FIRST (owner, 2026-10-05): a review is written only with a private proof that the
    // writer worked here (/api/schools/[id]/proof) — pending is enough to write, verified is needed to publish
    // (the moderator's approve checks it, and the public read rule requires it).
    // ⛔ ONLY WHILE REVIEWS_NEED_PROOF (constants.ts): since 2026-10-06 any signed-in account may write one (owner).
    const proof = REVIEWS_NEED_PROOF ? await db.schoolEmployment.findUnique({ where: { profileId_schoolId: { profileId: profile.id, schoolId: school.id } }, select: { status: true, purgeAt: true } }) : null
    // A waiting proof past its date is no proof (diff review): the queue no longer shows it, so a review written on it
    // would wait where no moderator looks. The same rule as the queue (queries.ts QUEUED).
    const live = proof && (proof.status === 'verified' || (proof.status === 'pending' && !!proof.purgeAt && proof.purgeAt > new Date()))
    if (REVIEWS_NEED_PROOF && !live) throw new ApiError('proof_required', 409)

    const texts = [body.pros, body.cons, body.advice ?? null]
    // Links first: the contact screen below also catches a URL, but its message ("remove phone numbers,
    // emails…") would not tell the teacher what to change.
    const screen = screenReviewText(texts)
    if (!screen.ok) throw new ApiError('links_not_allowed', 422)
    try {
      assertCleanTexts(texts) // banned words + contact details, the same screen listings get
    } catch (e) {
      if (e instanceof PublishBlockedError) throw new ApiError(e.code, 422)
      throw e
    }

    let pay: { payAmount: number; payCurrency: string; payPeriod: string; payVnd: number; fxRate: number | null; fxDate: Date | null } | null = null
    if (body.pay) {
      const rate = body.pay.currency === 'USD' ? await vndPerUsd() : null
      if (body.pay.currency === 'USD' && !rate) throw new ApiError('fx_unavailable', 503)
      // Whole units, and payVnd from the SAME rounded amount: the database checks payVnd = amount (VND)
      // or round(amount × rate) (USD), so the stored pair can never disagree.
      const amount = Math.round(body.pay.amount)
      const vnd = toVnd(amount, body.pay.currency, rate)
      if (!vnd || !payInBand(vnd, body.pay.period)) throw new ApiError('pay_out_of_range', 422)
      pay = {
        payAmount: amount, payCurrency: body.pay.currency, payPeriod: body.pay.period, payVnd: vnd,
        fxRate: rate, fxDate: rate ? new Date() : null,
      }
    }

    const data = {
      current: body.current,
      tenure: body.tenure,
      leftYear: body.current ? null : body.leftYear ?? null,
      showLeftYear: body.current ? false : !!body.showLeftYear,
      role: body.role,
      employment: body.employment,
      district: body.district ?? null,
      pros: body.pros,
      cons: body.cons,
      advice: body.advice || null,
      goodTags: [...new Set(body.goodTags ?? [])],
      badTags: [...new Set(body.badTags ?? [])],
      payAmount: pay?.payAmount ?? null, payCurrency: pay?.payCurrency ?? null, payPeriod: pay?.payPeriod ?? null,
      payVnd: pay?.payVnd ?? null, fxRate: pay?.fxRate ?? null, fxDate: pay?.fxDate ?? null,
      // every write is re-moderated, edits included, and restates when it was submitted
      status: 'pending', flags: screen.flags, moderatedAt: null, moderatedBy: null, rejectReason: null, submittedAt: new Date(),
      // ⛔ The school's response answered the OLD text: it must not reappear under the new one (diff review).
      replyText: null, replyAt: null,
    }
    const before = await db.schoolReview.findUnique({ where: { schoolId_profileId: { schoolId: school.id, profileId: profile.id } }, select: { status: true } })
    // ONE transaction: the new text and the reset of its helpful votes land together or not at all.
    const review = await db.$transaction(async (tx) => {
      const saved = await tx.schoolReview.upsert({
        where: { schoolId_profileId: { schoolId: school.id, profileId: profile.id } },
        create: { schoolId: school.id, profileId: profile.id, ...data },
        update: data,
        select: MINE,
      })
      // ⛔ Helpful votes judged the OLD text, like the school's reply: a rewrite starts from zero (diff review).
      if (before) await tx.schoolReviewVote.deleteMany({ where: { reviewId: saved.id } })
      return saved
    })
    // An edit sends the review back to pending: purge so the old text leaves the cached page now. Any prior
    // row, not only a published one — a moderator may have approved it between the read above and the write.
    if (before) {
      const slug = (await db.school.findUnique({ where: { id: school.id }, select: { slug: true } }))?.slug
      if (slug) { revalidatePublicPath('/schools'); revalidatePublicPath(`/schools/${slug}`) }
    }
    return { ok: true, review, countsNow: gate.countsNow }
  },
)

export const DELETE = route({ auth: 'profile', rateLimit: { bucket: 'school-review', limit: 10, window: '1 h' } }, async ({ profile, params }) => {
  const found = await db.schoolReview.findUnique({ where: { schoolId_profileId: { schoolId: params.id, profileId: profile.id } }, select: { id: true, status: true, school: { select: { slug: true } } } })
  if (!found) throw new ApiError('not_found', 404)
  await db.schoolReview.delete({ where: { id: found.id } })
  // Always purge: a moderator may publish it between the read above and this write (diff review), and a
  // withdrawn review must leave the cached page now, not at the next revalidation.
  revalidatePublicPath('/schools'); revalidatePublicPath(`/schools/${found.school.slug}`)
  return { ok: true }
})
