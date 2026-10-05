// POST /api/admin/schools — moderation for /schools (2026-10-04). Admin only (getAdmin, re-checked here).
// Actions: approve / reject a pending review, publish the school's reply under a review, resolve a report
// or a school complaint, hide / show a school, verify / reject a teacher's proof of employment, and add / match /
// reject a teacher's suggestion of a school (2026-10-05).
// Every change purges the school's page and the list.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { SCHOOL_KINDS } from '@/lib/schools/constants'
import { PURGE_AFTER_DAYS, claimProofKey } from '@/lib/schools/employment'
import { checkSuggestion } from '@/lib/schools/suggest'
import { finaliseAwards } from '@/lib/schools/awards'
import { AWARDS_PATH } from '@/lib/schools/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⛔ `seenUpdatedAt` IS THE VERSION THE MODERATOR READ (diff review, codex + Opus), on approve AND reject:
// without it, a teacher who edits between the moderator opening the queue and clicking would get text no
// moderator saw published (or rejected with a reason about other text). A mismatch answers 409.
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), reviewId: z.string().max(40), seenUpdatedAt: z.string().datetime() }),
  z.object({ action: z.literal('reject'), reviewId: z.string().max(40), reason: z.string().trim().min(3).max(500), seenUpdatedAt: z.string().datetime() }),
  z.object({ action: z.literal('reply'), reviewId: z.string().max(40), text: z.string().trim().max(2000), seenUpdatedAt: z.string().datetime() }),
  z.object({ action: z.literal('resolve'), reportId: z.string().max(40), status: z.enum(['resolved', 'dismissed']) }),
  z.object({ action: z.literal('school_status'), schoolId: z.string().max(40), status: z.enum(['active', 'hidden']) }),
  z.object({ action: z.literal('proof_verify'), proofId: z.string().max(40), seenUpdatedAt: z.string().datetime() }),
  z.object({ action: z.literal('proof_reject'), proofId: z.string().max(40), reason: z.string().trim().min(3).max(500), seenUpdatedAt: z.string().datetime() }),
  // A VERIFIED proof taken back (a borrowed profile, a moderator's mistake): every proof made with that profile goes,
  // and the reviews they backed are unpublished.
  z.object({ action: z.literal('proof_revoke'), proofId: z.string().max(40), reason: z.string().trim().min(3).max(500) }),
  // A teacher's suggestion (2026-10-05): ADD it as a school — the moderator may correct its facts first — say it is
  // ALREADY LISTED as another school, or REJECT it with a reason the teacher sees.
  z.object({
    action: z.literal('suggestion_add'), suggestionId: z.string().max(40),
    name: z.string().trim().min(2).max(120), kind: z.enum(SCHOOL_KINDS), website: z.string().trim().max(300).nullish(), districts: z.array(z.string().max(60)).max(30),
  }),
  z.object({ action: z.literal('suggestion_duplicate'), suggestionId: z.string().max(40), schoolSlug: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('suggestion_reject'), suggestionId: z.string().max(40), reason: z.string().trim().min(3).max(500) }),
  // Teachers' Choice: close a year that has ended, if the daily cron has not already (src/lib/schools/awards.ts).
  z.object({ action: z.literal('awards_finalise'), year: z.number().int() }),
])

const PURGE_AFTER_MS = PURGE_AFTER_DAYS * 86_400_000

function purge(slug: string) {
  revalidatePublicPath('/schools')
  revalidatePublicPath(`/schools/${slug}`)
}

export const POST = route({ auth: 'admin', body: Body }, async ({ admin, body }) => {
  switch (body.action) {
    case 'approve':
    case 'reject': {
      const r = await db.schoolReview.findUnique({ where: { id: body.reviewId }, select: { id: true, status: true, profileId: true, schoolId: true, school: { select: { slug: true } } } })
      if (!r || r.status === 'removed') throw new ApiError('not_found', 404)
      // THE STATE MACHINE: approve only what is waiting; reject (or unpublish) only what is waiting or live.
      const from = body.action === 'approve' ? ['pending'] : ['pending', 'published']
      const write = (tx: Pick<typeof db, 'schoolReview'>) => tx.schoolReview.updateMany({
        where: { id: r.id, status: { in: from }, updatedAt: new Date(body.seenUpdatedAt) },
        data: body.action === 'approve'
          ? { status: 'published', moderatedAt: new Date(), moderatedBy: admin, rejectReason: null }
          : { status: 'rejected', moderatedAt: new Date(), moderatedBy: admin, rejectReason: body.reason },
      })
      // ⛔ APPROVE ONLY WITH A VERIFIED PROOF OF EMPLOYMENT, read under a row lock in the SAME transaction as the
      // compare-and-set (plan review): a proof rejected or withdrawn while the moderator had this card open
      // must not let the review go live. (The public read rule requires it too; this keeps the status honest.)
      const done = body.action === 'approve'
        ? await db.$transaction(async (tx) => {
            const proof = await tx.$queryRaw<{ status: string }[]>`
              select status from "SchoolEmployment" where "profileId" = ${r.profileId}::uuid and "schoolId" = ${r.schoolId} for update`
            if (proof[0]?.status !== 'verified') throw new ApiError('proof_not_verified', 409)
            return write(tx)
          })
        : await write(db)
      if (done.count === 0) {
        if (!from.includes(r.status)) throw new ApiError('invalid_status_transition', 409)
        throw new ApiError('review_changed_reload', 409)
      }
      purge(r.school.slug)
      return { ok: true }
    }
    case 'reply': {
      const r = await db.schoolReview.findUnique({ where: { id: body.reviewId }, select: { id: true, school: { select: { slug: true } } } })
      if (!r) throw new ApiError('not_found', 404)
      // A response only ever sits under the PUBLISHED text it answers (a teacher's edit clears it).
      // …and the version the moderator was looking at: a reply must never land under text it did not answer.
      const done = await db.schoolReview.updateMany({ where: { id: r.id, status: 'published', updatedAt: new Date(body.seenUpdatedAt) }, data: body.text ? { replyText: body.text, replyAt: new Date() } : { replyText: null, replyAt: null } })
      if (done.count === 0) {
        const now = await db.schoolReview.findUnique({ where: { id: r.id }, select: { status: true } })
        throw new ApiError(now?.status === 'published' ? 'review_changed_reload' : 'invalid_status_transition', 409)
      }
      purge(r.school.slug)
      return { ok: true }
    }
    case 'resolve': {
      const rep = await db.schoolReport.findUnique({ where: { id: body.reportId }, select: { id: true } })
      if (!rep) throw new ApiError('not_found', 404)
      // Only an OPEN report: two moderators on stale views must not overwrite each other's decision.
      const done = await db.schoolReport.updateMany({ where: { id: rep.id, status: 'open' }, data: { status: body.status, resolvedBy: admin, resolvedAt: new Date() } })
      if (done.count === 0) throw new ApiError('already_resolved', 409)
      return { ok: true }
    }
    case 'proof_verify':
    case 'proof_reject': {
      const p = await db.schoolEmployment.findUnique({ where: { id: body.proofId }, select: { id: true, status: true, profileId: true, linkedinHash: true, purgeAt: true, school: { select: { slug: true } } } })
      if (!p) throw new ApiError('not_found', 404)
      const verify = body.action === 'proof_verify'
      if (verify && !p.linkedinHash) throw new ApiError('invalid_status_transition', 409)
      const now = new Date()
      await db.$transaction(async (tx) => {
        // The compare-and-set FIRST, and a miss THROWS inside the transaction (diff review): otherwise a stale card
        // could still claim the key below — an attacker who swapped in a victim's profile after the moderator
        // opened the card would own the victim's LinkedIn for good.
        const done = await tx.schoolEmployment.updateMany({
          // …and only inside its date (diff review): past it the teacher already sees it closed, "not checked in time".
          where: { id: p.id, status: 'pending', updatedAt: new Date(body.seenUpdatedAt), purgeAt: { gt: now } },
          data: verify
            // Flags are KEPT (diff review): they are the record that a flagged proof was verified knowingly.
            ? { status: 'verified', decidedAt: now, decidedBy: admin, rejectReason: null, purgeAt: new Date(now.getTime() + PURGE_AFTER_MS) }
            : { status: 'rejected', decidedAt: now, decidedBy: admin, rejectReason: body.reason, purgeAt: new Date(now.getTime() + PURGE_AFTER_MS) },
        })
        if (done.count === 0) throw new ApiError(p.status === 'pending' && p.purgeAt && p.purgeAt > now ? 'review_changed_reload' : 'invalid_status_transition', 409)
        // ⛔ A LinkedIn profile proves employment for ONE account, for good (SchoolProofKey): verifying it for a
        // second account is refused, and the refusal rolls the verification above back. (A REJECTED proof may be
        // fixed and sent again — it never verifies without a moderator.)
        if (verify && p.linkedinHash) {
          const claim = await claimProofKey(tx, p.linkedinHash, p.profileId)
          if (claim === 'taken') throw new ApiError('linkedin_already_used', 409)
          if (claim === 'rejected') throw new ApiError('proof_rejected', 409)
        }
      }).catch(async (e: unknown) => {
        // Two verifications claiming one profile at the same moment: the ledger's primary key refuses the second (no
        // 500). Whose it now is decides the answer (diff review): another account's → already used; this account's
        // own (its proofs at two schools at once) → changed, reload — and the retry verifies.
        if ((e as { code?: string })?.code !== 'P2002' || !p.linkedinHash) throw e
        const owner = await db.schoolProofKey.findUnique({ where: { kind_hash: { kind: 'linkedin', hash: p.linkedinHash } }, select: { profileId: true } })
        throw new ApiError(owner && owner.profileId !== p.profileId ? 'linkedin_already_used' : 'review_changed_reload', 409)
      })
      purge(p.school.slug)
      return { ok: true }
    }
    case 'proof_revoke': {
      const p = await db.schoolEmployment.findUnique({ where: { id: body.proofId }, select: { id: true, profileId: true, schoolId: true, linkedinHash: true } })
      if (!p) throw new ApiError('not_found', 404)
      const now = new Date()
      const decided = { status: 'rejected', decidedAt: now, decidedBy: admin, rejectReason: body.reason, purgeAt: new Date(now.getTime() + PURGE_AFTER_MS) }
      const slugs = await db.$transaction(async (tx) => {
        // ⛔ A REVOCATION IS ABOUT THE ACCOUNT'S PROVED PROFILES, NOT ONE ROW (diff review). A row keeps only the latest
        // profile, so withdrawing — or swapping in another profile — must not be a way out: every LinkedIn profile this
        // account has ever proved with (the ledger keys it owns, claimed only on verify) is burnt, and the proof can be
        // revoked while verified, withdrawn or waiting, as long as the account has proved with some profile.
        const owned = await tx.schoolProofKey.findMany({ where: { kind: 'linkedin', profileId: p.profileId }, select: { hash: true, rejectedAt: true } })
        // …in ANY state while one of those keys is still live — a rejected row too (diff review: prove A, swap to B, get
        // B rejected — A must still be revocable from this card).
        const live = owned.some((k) => !k.rejectedAt)
        // A row already withdrawn or rejected keeps WHEN that happened (diff review): its 60-day clock, and the review's,
        // must not restart because a moderator revoked it later — only who decided and why change.
        const done = await tx.schoolEmployment.updateMany({ where: { id: p.id, status: { in: live ? ['verified', 'pending'] : ['verified'] } }, data: decided })
        const closed = live && done.count === 0
          ? await tx.schoolEmployment.updateMany({ where: { id: p.id, status: { in: ['withdrawn', 'rejected'] } }, data: { status: 'rejected', decidedBy: admin, rejectReason: body.reason } })
          : { count: 0 }
        if (done.count + closed.count === 0) throw new ApiError('invalid_status_transition', 409)
        // ⛔ ONLY KEYS THIS ACCOUNT OWNS (diff review): the row's current profile may be someone else's — a fraudster's
        // submission of a victim's URL — and burning it would lock the victim out for good.
        const burnt = owned.map((k) => k.hash)
        // ⛔ EVERY LIVE PROOF THIS ACCOUNT MADE WITH THOSE PROFILES GOES WITH IT: a borrowed profile caught at one school
        // must not keep vouching at another. ⛔ NEVER ANOTHER ACCOUNT'S (diff review): closing it would tell that account —
        // a manager who submitted a colleague's profile, say — that this proof was found out. Another account's proof
        // of a burnt profile can never verify anyway (verify answers proof_rejected); a moderator rejects it in words.
        const siblings = burnt.length
          ? await tx.schoolEmployment.findMany({ where: { linkedinHash: { in: burnt }, profileId: p.profileId, status: { in: ['pending', 'verified'] } }, select: { id: true, profileId: true, schoolId: true } })
          : []
        if (siblings.length) await tx.schoolEmployment.updateMany({ where: { id: { in: siblings.map((x) => x.id) } }, data: decided })
        // …those profiles can never prove employment again, for anyone…
        if (burnt.length) await tx.schoolProofKey.updateMany({ where: { kind: 'linkedin', hash: { in: burnt }, profileId: p.profileId }, data: { rejectedAt: now } })
        // …and every review those proofs backed is UNPUBLISHED, not just hidden (diff review): a later proof must not
        // bring one back without a moderator reading it again.
        const pairs = [{ profileId: p.profileId, schoolId: p.schoolId }, ...siblings.map((x) => ({ profileId: x.profileId, schoolId: x.schoolId }))]
        await tx.schoolReview.updateMany({
          where: { OR: pairs, status: { in: ['pending', 'published'] } },
          data: { status: 'rejected', moderatedAt: now, moderatedBy: admin, rejectReason: body.reason },
        })
        const schools = await tx.school.findMany({ where: { id: { in: [...new Set(pairs.map((x) => x.schoolId))] } }, select: { slug: true } })
        return schools.map((x) => x.slug)
      })
      for (const slug of slugs) purge(slug)
      return { ok: true }
    }
    case 'suggestion_add': {
      // The row passes the importer's own validation (src/lib/schools/suggest.ts → import-entries.ts clean()).
      const c = checkSuggestion({ name: body.name, kind: body.kind, website: body.website ?? null, districts: body.districts, note: '' })
      if (!c.ok) {
        // Each code spelled out as a literal: errors.test.ts harvests the wire vocabulary from literals.
        if (c.code === 'website_invalid') throw new ApiError('website_invalid', 400)
        if (c.code === 'district_invalid') throw new ApiError('district_invalid', 400)
        if (c.code === 'contact_in_text') throw new ApiError('contact_in_text', 400)
        if (c.code === 'banned_words') throw new ApiError('banned_words', 400)
        throw new ApiError('school_name_invalid', 400)
      }
      const { row } = c.value
      const now = new Date()
      try {
        const slug = await db.$transaction(async (tx) => {
          const sug = await tx.schoolSuggestion.findUnique({ where: { id: body.suggestionId }, select: { nameKey: true } })
          const done = await tx.schoolSuggestion.updateMany({ where: { id: body.suggestionId, status: 'pending' }, data: { status: 'added', decidedAt: now, decidedBy: admin } })
          if (done.count === 0 || !sug) throw new ApiError('already_resolved', 409)
          // ⛔ AN ALIAS NEVER MOVES (scripts/import-schools.ts): it is how job ads find their school, so a name another
          // school already answers to means this IS that school — the card shows which; mark it a duplicate instead.
          if (await tx.schoolAlias.findFirst({ where: { alias: { in: row.aliases } }, select: { alias: true } })) throw new ApiError('alias_taken', 409)
          let slug = row.slug
          for (let i = 2; await tx.school.findUnique({ where: { slug }, select: { id: true } }); i++) {
            if (i > 20) throw new ApiError('school_name_invalid', 400)
            slug = `${row.slug.slice(0, 76).replace(/-+$/, '')}-${i}` // never "foo--2", which clean() refuses (diff review)
          }
          const school = await tx.school.create({ data: { slug, name: row.name, kind: row.kind, website: row.website ?? null, districts: row.districts ?? [], status: 'active' }, select: { id: true } })
          await tx.schoolAlias.createMany({ data: row.aliases.map((alias) => ({ alias, schoolId: school.id })) })
          // This suggestion, and every other one still waiting under one of the school's names, now has its answer.
          await tx.schoolSuggestion.updateMany({
            // …by the school's names AND the name as suggested (diff review: a moderator's correction must not strand
            // the others who suggested it the same way).
            where: { OR: [{ id: body.suggestionId }, { status: 'pending', nameKey: { in: [...row.aliases, sug.nameKey] } }] },
            data: { status: 'added', schoolId: school.id, decidedAt: now, decidedBy: admin },
          })
          return slug
        })
        purge(slug)
        return { ok: true, slug }
      } catch (e) {
        // Two moderators adding the same name at once: the alias or slug key refuses the second.
        if ((e as { code?: string })?.code === 'P2002') throw new ApiError('alias_taken', 409)
        throw e
      }
    }
    case 'suggestion_duplicate': {
      const school = await db.school.findUnique({ where: { slug: body.schoolSlug }, select: { id: true } })
      if (!school) throw new ApiError('not_found', 404)
      const now = new Date()
      await db.$transaction(async (tx) => {
        const sug = await tx.schoolSuggestion.findUnique({ where: { id: body.suggestionId }, select: { nameKey: true } })
        // This one, and every other suggestion of the same name still waiting — as Add does (diff review).
        const done = await tx.schoolSuggestion.updateMany({ where: { id: body.suggestionId, status: 'pending' }, data: { status: 'duplicate', schoolId: school.id, decidedAt: now, decidedBy: admin } })
        if (done.count === 0 || !sug) throw new ApiError('already_resolved', 409)
        await tx.schoolSuggestion.updateMany({ where: { status: 'pending', nameKey: sug.nameKey }, data: { status: 'duplicate', schoolId: school.id, decidedAt: now, decidedBy: admin } })
      })
      return { ok: true }
    }
    case 'suggestion_reject': {
      const done = await db.schoolSuggestion.updateMany({ where: { id: body.suggestionId, status: 'pending' }, data: { status: 'rejected', rejectReason: body.reason, decidedAt: new Date(), decidedBy: admin } })
      if (done.count === 0) throw new ApiError('already_resolved', 409)
      return { ok: true }
    }
    case 'awards_finalise': {
      const r = await finaliseAwards(body.year, admin)
      if (!r.ok) {
        if (r.code === 'award_year_open') throw new ApiError('award_year_open', 409)
        if (r.code === 'award_reviews_pending') throw new ApiError('award_reviews_pending', 409)
        throw new ApiError('award_year_invalid', 400)
      }
      revalidatePublicPath('/schools')
      revalidatePublicPath(`${AWARDS_PATH}/[year]`, 'page')
      for (const slug of r.slugs) revalidatePublicPath(`/schools/${slug}`)
      return { ok: true, already: r.already, places: r.places }
    }
    case 'school_status': {
      const s = await db.school.findUnique({ where: { id: body.schoolId }, select: { id: true, slug: true } })
      if (!s) throw new ApiError('not_found', 404)
      await db.school.update({ where: { id: s.id }, data: { status: body.status } })
      purge(s.slug)
      // The awards pages name and link schools too (the open year's qualifiers, a closed year's places).
      revalidatePublicPath(`${AWARDS_PATH}/[year]`, 'page')
      return { ok: true }
    }
  }
})
