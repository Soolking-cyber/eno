// A recruiter downloads the teacher's CV — same share gate as the contact details (2026-09-30).
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { teacherThread } from '@/lib/teachers/share'
import { conversationGate } from '@/lib/enforcement'
import { isBlockedBetween } from '@/lib/user-blocks'
import { signTeacherCv } from '@/lib/teachers/cv-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-cv-download', limit: 30, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const conversationId = new URL(req.url).searchParams.get('conversationId') ?? ''
    const t = conversationId ? await teacherThread(conversationId) : null
    if (!t || t.recruiterUserId !== profile.id) throw new ApiError('not_found', 404)
    if (profile.accountType !== 'business') throw new ApiError('business_only', 403)
    // A recruiter suspended after the teacher shared reads nothing more.
    if ((await conversationGate(profile.id))?.error === 'account_suspended') throw new ApiError('account_suspended', 403)
    if (!t.shared) throw new ApiError('share_required', 403)
    // App Store gate `ugc-safety`: a block also closes a share made BEFORE it — the teacher who blocks a
    // recruiter must not keep handing them a phone, email or CV (share/route.ts only stops NEW shares).
    // Either direction, like every block. Off ⇒ no query.
    if (await isBlockedBetween(t.recruiterUserId, t.teacherUserId)) throw new ApiError('blocked', 403)
    const priv = await db.teacherPrivate.findUnique({ where: { teacherProfileId: t.teacherProfileId }, select: { cvPath: true, cvFileName: true } })
    if (!priv?.cvPath) throw new ApiError('cv_missing', 404)
    const url = await signTeacherCv(priv.cvPath, priv.cvFileName ?? 'cv.pdf')
    if (!url) throw new ApiError('cv_store_failed', 502)
    // ⚠️ `format=json` is the NATIVE SHELL's path (teacher-thread-strip.tsx): there a target=_blank link goes to
    // Safari, which holds no eno session (401), and a same-window GET would start a main-frame navigation that
    // resets Capacitor's bridge (CapacitorBridge.reset → every plugin listener dropped) — so the app fetches the
    // signed URL and opens it in the in-app browser itself. The web keeps the plain 302.
    if (new URL(req.url).searchParams.get('format') === 'json') {
      const json = NextResponse.json({ url })
      json.headers.set('Cache-Control', 'private, no-store')
      return json
    }
    // 10-minute link, never cached anywhere on the way.
    const res = NextResponse.redirect(url, 302)
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  },
)
