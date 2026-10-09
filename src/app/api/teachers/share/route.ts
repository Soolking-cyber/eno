// The teacher's "Share my phone, email & CV" in one conversation — and its revocation (2026-09-30). Body:
// { conversationId, share: boolean, phone?: boolean } — `phone: true` when the tapped label named the phone; the answer
// { ok, shared, phoneShared } is the share as it now stands (TeacherContactShare.phoneShared, gate review 2026-10-09).
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { logError } from '@/lib/log'
import { teacherThread } from '@/lib/teachers/share'
import { conversationGate } from '@/lib/enforcement'
import { isBlockedBetween } from '@/lib/user-blocks'

export const runtime = 'nodejs'

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-share', limit: 10, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const body = (await req.json().catch(() => null)) as { conversationId?: unknown; share?: unknown; phone?: unknown; addPhone?: unknown } | null
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    // FAIL CLOSED (gate review, 2026-10-07): only a literal `true` sends and a literal `false` stops — a missing field or
    // the string "false" must never hand anything over.
    if (!conversationId || typeof body?.share !== 'boolean') throw new ApiError('bad_request', 400)
    const share = body.share
    // ⛔ THE PHONE ONLY WHEN THE TAPPED BUTTON NAMED IT (gate review, 2026-10-09): `phone: true` comes only from "Share my
    // phone, email & CV" or "Share my phone too". The tap is the consent, and its label is read off the thread payload —
    // so a tab loaded before a phone was added still says "Share my email & CV", and that tap must not hand one over.
    // Fail closed like `share`: only a literal true (a client that sends none shares email and CV, and its line says so).
    const wantsPhone = body.phone === true
    const t = await teacherThread(conversationId)
    // Only the teacher of THIS thread may share or revoke. Anyone else: it does not exist.
    if (!t || t.teacherUserId !== profile.id) throw new ApiError('not_found', 404)
    // A suspended teacher posts nothing (sharing announces itself as a message).
    if ((await conversationGate(profile.id))?.error === 'account_suspended') throw new ApiError('account_suspended', 403)
    // Sharing from a hidden or pulled profile would announce details the recruiter cannot get.
    if (share && !t.profileLive) throw new ApiError('profile_hidden', 409)
    // App Store gate `ugc-safety` (R3): no contact handover across a block (unsharing still works).
    if (share && await isBlockedBetween(t.convo.buyerProfileId, t.convo.sellerProfileId)) throw new ApiError('blocked', 403)
    // ⛔ "SHARE MY PHONE TOO" ONLY ADDS TO A STANDING SHARE (commit gate, 2026-10-09 — Opus). It re-shares under the hood, so
    // a stale tab still offering it after "Stop sharing" (another device) re-granted phone, email AND CV — everything the
    // teacher had just withdrawn. Its tap says `addPhone`: on a stopped share it changes nothing and answers the share as it
    // stands (the strip then offers Share again).
    if (share && body.addPhone === true && !t.shareOn) return { ok: true, shared: false, phoneShared: false }
    // What this tap hands over: the phone when the tap named it AND one is on file now (one removed since is not promised).
    const phoneShared = share && wantsPhone && t.hasPhone === true
    // ⚠️ AGAINST THE TEACHER'S OWN CHOICE (`shareOn`), NOT `shared`: on a hidden profile `shared` is
    // false, so "Stop sharing" was a no-op there and the share came back on un-hide (Opus, gate 09-30).
    // A standing share is a no-op — EXCEPT a tap that adds the phone to one made without it ("Share my phone too", once a
    // phone was added — gate review, 2026-10-09): that re-shares, re-stamping `phoneShared`, with its own line. Nothing here
    // takes the phone back off a standing share (a stale "Share my email & CV" tap changes nothing): only Stop withdraws.
    const addsPhone = share && t.shareOn && phoneShared && !t.phoneShared
    if (share === t.shareOn && !addsPhone) return { ok: true, shared: t.shareOn, phoneShared: t.phoneShared }
    // A line in the thread, as the teacher, so the recruiter is told (realtime + unread) — the same
    // way an accepted offer announces itself. Bilingual, like the offer lines.
    const convo = { id: t.convo.id, buyerProfileId: t.convo.buyerProfileId, sellerProfileId: t.convo.sellerProfileId, listingId: t.convo.listingId, sellerId: t.convo.sellerId }
    const now = new Date()
    if (share) {
      // ⛔ A SHARE COMMITS WITH ITS LINE OR NOT AT ALL (SendOpts.alongside, 2026-10-07). Written in two steps, a failed or
      // interrupted line left a grant the recruiter was never told about, and the no-op above then swallowed every retry
      // (the gap the intro-video review found here).
      // ⚠️ IT SAYS WHAT IS HANDED OVER (A3, owner 2026-10-08): the phone is optional now, and a line promising one the
      // school then cannot see is a broken promise. Read off the very flag /api/teachers/contact serves the phone by, so
      // the line and what the school sees never disagree (gate review, 2026-10-09). An added phone re-announces in full.
      const line = phoneShared
        ? '📇 Đã chia sẻ số điện thoại, email và CV · Shared my phone, email and CV'
        : '📇 Đã chia sẻ email và CV · Shared my email and CV'
      // ⛔ `phoneShared` ON BOTH create AND update: a re-share re-stamps what ITS tap handed over — never a row's leftover.
      await insertMessage(convo, profile.id, line, {
        alongside: [db.teacherContactShare.upsert({ where: { conversationId }, create: { conversationId, sharedAt: now, revokedAt: null, phoneShared }, update: { sharedAt: now, revokedAt: null, phoneShared } })],
      })
    } else {
      // ⛔ A REVOKE NEVER DEPENDS ON ITS LINE: it commits first, on its own; the line is best-effort (gate review, 2026-10-07).
      // A row it creates says "no phone", never the column's backfill default (TRUE); a re-share re-stamps it anyway.
      await db.teacherContactShare.upsert({ where: { conversationId }, create: { conversationId, sharedAt: now, revokedAt: now, phoneShared: false }, update: { revokedAt: now } })
      await insertMessage(convo, profile.id, '🔒 Đã ngừng chia sẻ liên hệ · Stopped sharing my contact details')
        .catch((err) => logError(err, { op: 'teachers.contact_revoke_line' }))
    }
    return { ok: true, shared: share, phoneShared }
  },
)
