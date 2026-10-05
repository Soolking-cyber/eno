// /api/schools/suggest — a teacher asks us to add a school (owner, 2026-10-05: "add a place for teachers to add new
// schools"). Plan: ~/.claude/plans/eno-schools-v2-2026-10-05.md §C.
//   GET  → { suggestions } — the caller's own, newest first
//   POST → { name, kind, website?, district?, note?, confirmNew? } →
//          { listed: { slug, name } }    already in the directory — nothing is stored
//          { possible: { slug, name } }  a listed school has the same website — sent again with confirmNew to store
//          { suggestion }                stored, waiting for a moderator
// ⛔ A SUGGESTION IS NEVER A SCHOOL BY ITSELF: a moderator adds it (admin → Suggestions), with the importer's own
// validation (src/lib/schools/suggest.ts).
// ⚠️ A HIDDEN SCHOOL IS NEVER ANSWERED AS "LISTED": hiding it was a moderator's decision, not the public's to
// read. The suggestion is stored and the moderator sees the match.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { SCHOOL_KINDS } from '@/lib/schools/constants'
import { SUGGESTIONS_PENDING_MAX, SUGGESTION_NOTE_MAX, checkSuggestion, websiteKey } from '@/lib/schools/suggest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OWN = { id: true, name: true, kind: true, status: true, rejectReason: true, createdAt: true, school: { select: { slug: true, name: true, status: true } } } as const
type Own = { id: string; name: string; kind: string; status: string; rejectReason: string | null; createdAt: Date; school: { slug: string; name: string; status: string } | null }

/** What the suggester sees: the school only while it is public. */
const view = (s: Own) => ({
  id: s.id, name: s.name, kind: s.kind, status: s.status, createdAt: s.createdAt.toISOString(),
  rejectReason: s.status === 'rejected' ? s.rejectReason : null,
  school: s.school?.status === 'active' ? { slug: s.school.slug, name: s.school.name } : null,
})

export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const rows = await db.schoolSuggestion.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: 'desc' }, take: 20, select: OWN })
  return { suggestions: rows.map(view) }
})

const Body = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(SCHOOL_KINDS),
  website: z.string().trim().max(300).nullish(),
  district: z.string().trim().max(60).nullish(),
  note: z.string().trim().max(SUGGESTION_NOTE_MAX).nullish(),
  confirmNew: z.boolean().optional(),
})

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'school-suggest', limit: 10, window: '1 d', strict: true }, body: Body },
  async ({ profile, body }) => {
    // Anyone in good standing, a school's own account included: a moderator decides every one.
    if (profile.enforcementState !== 'good_standing' || profile.trustTier === 'restricted') throw new ApiError('account_restricted', 403)
    const c = checkSuggestion({ name: body.name, kind: body.kind, website: body.website ?? null, districts: body.district ? [body.district] : [], note: body.note ?? '' })
    if (!c.ok) {
      // Each code spelled out as a literal: errors.test.ts harvests the wire vocabulary from literals.
      if (c.code === 'contact_in_text') throw new ApiError('contact_in_text', 400)
      if (c.code === 'banned_words') throw new ApiError('banned_words', 400)
      if (c.code === 'website_invalid') throw new ApiError('website_invalid', 400)
      if (c.code === 'district_invalid') throw new ApiError('district_invalid', 400)
      throw new ApiError('school_name_invalid', 400)
    }
    const { row, nameKey, host, note } = c.value

    // Already listed under one of its names (the aliases job ads are matched on)?
    const hit = await db.schoolAlias.findFirst({ where: { alias: { in: row.aliases }, school: { status: 'active' } }, select: { school: { select: { slug: true, name: true } } } })
    if (hit) return { listed: hit.school }
    // The same website as a listed school: probably that school under another name — asked, never refused.
    if (host && !body.confirmNew) {
      const sites = await db.school.findMany({ where: { status: 'active', website: { not: null } }, select: { slug: true, name: true, website: true } })
      const same = sites.find((s) => websiteKey(s.website) === host)
      if (same) return { possible: { slug: same.slug, name: same.name } }
    }

    const created = await db.$transaction(async (tx) => {
      // One account's suggestions are decided one at a time, so two at once cannot both pass the limit.
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`school-suggest:${profile.id}`}))`
      const mine = await tx.schoolSuggestion.findMany({ where: { profileId: profile.id, status: 'pending' }, select: { nameKey: true } })
      if (mine.some((m) => m.nameKey === nameKey)) throw new ApiError('already_submitted', 409)
      // Its own code: `too_many` is the services edition's vocabulary (errors-services.ts), unknown on eno.vn.
      if (mine.length >= SUGGESTIONS_PENDING_MAX) throw new ApiError('too_many_suggestions', 429)
      return tx.schoolSuggestion.create({
        data: { profileId: profile.id, name: row.name, kind: row.kind, website: row.website ?? null, districts: row.districts ?? [], note, nameKey, host },
        select: OWN,
      })
    })
    return { suggestion: view(created) }
  },
)
