// The signed-in teacher's own profile (2026-09-30): read, create/update, delete.
// The public side is the listing (/listings/<id>); contact data is never in any public payload.
import { after, NextResponse } from 'next/server'
import { pendingOnboardingStep } from '@/lib/auth-policy'
import { afterIndividualOnboarding, individualOnboardingWrite } from '@/lib/core/first-onboarding'
import { route, ApiError } from '@/lib/api/handler'
import { photoOverridden, teacherPhotoKey } from '@/lib/teachers/photo-verdict'
import { db } from '@/lib/db'
import { isCurrentUserAppleLinkedByClaims } from '@/lib/admin'
import { sendMetaCapiEvent, metaUserDataFromHeaders, metaCapiConfigured } from '@/lib/meta-capi'
import { PublishBlockedError } from '@/lib/publish-guard'
import { isListingImageUrl } from '@/lib/listing-image'
import { sellerPublishDecision } from '@/lib/compliance/seller-publish-gate'
import { logError } from '@/lib/log'
import { isLegacyTeacherBody, normalizeTeacherInput } from '@/lib/teachers/profile'
import { TEACHERS_CATEGORY_NAME } from '@/lib/teachers/constants'
import { identityMarkState } from '@/lib/teachers/identity-mark'
import { apexOrigin } from '@/lib/teachers/host'
import { sendTikTokEvent, tiktokConsent, tiktokEventsConfigured, tiktokUserFromHeaders } from '@/lib/tiktok-events'
import { consentRecordNamesTikTok } from '@/lib/tiktok-consent-record'
import {
  saveTeacherProfile, deleteTeacherProfile, TeacherCoverConflictError, TeacherNoticeChangedError, TeacherProfileChangedError,
  TeacherValidationError, TeacherVideoConflictError, TeacherVideoStoreError, TeacherPhotoCheckUnavailableError,
} from '@/lib/teachers/publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — the caller's own profile, or (none yet) what the new form may START from (teacher onboarding redesign,
 * 2026-10-08):
 *   · `publishGate` — whether this account may publish right now (the identity gate, sellerPublishDecision) and the
 *     refusal code, so the Photo & publish step shows an identity check at its top instead of a refusal at the last tap.
 *     ⚠️ ADVISORY, so it never takes the page down (gate review, 2026-10-09): a failed check answers `publishGate: null`
 *     (not known — the form shows no notice) and is logged. The save re-runs the gate itself (assertSellerMayPublish),
 *     so nothing is published on the strength of this answer, while a failure here used to fail the whole edit page;
 *   · `prefill` (no profile only) — the account's display name, its photo only when it is stored on eno.vn (a listing
 *     photo must be), and its phone (Profile.phone is only ever an auth-VERIFIED number). The form offers them; it never
 *     saves them unasked.
 *   · `identityMark` — the "Identity verified" switch's state line (owner, 2026-10-15; src/lib/teachers/identity-mark.ts):
 *     `{ shown, reason }`, judged on the LIVE identity with the stored switch and name — for a new form too (no profile:
 *     never shown; the reason says whether the identity check is the missing step). Only to the teacher themself (auth
 *     'profile'). ⚠️ ADVISORY like publishGate: a failed read answers `identityMark: null` (not known — the form shows no
 *     state line) and is logged; it never takes the page down, and nothing is shown on the strength of this answer;
 *   · `identityMarkStamps` — `{ at, withdrawnAt }`, the switch's consent stamps as stored (ISO, or null — both null with
 *     no profile): what the form sends back as `base` when it switches the mark ON (PUT /api/teachers/me/identity-mark),
 *     so a tab that is no longer current is refused instead of re-granting a withdrawal.
 * ⛔ No runtime adapter (plan review D1): a row the backfill has not migrated comes back as stored (`situationVersion`
 * null, an empty teach-area list) and the edit form asks for what is missing.
 */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const [tp, decision] = await Promise.all([
    db.teacherProfile.findUnique({
      where: { profileId: profile.id },
      include: { private: { select: { phone: true, cvFileName: true, videoPath: true } }, listing: { select: { status: true, verified: true } } },
    }),
    sellerPublishDecision({ ownerId: profile.id }).catch((e: unknown) => {
      logError(e, { op: 'teachers.me.publishGate' })
      return null
    }),
  ])
  const publishGate = !decision ? null : decision.ok ? { ok: true as const, code: null } : { ok: false as const, code: decision.code }
  // After the profile read, because it judges the stored switch and name (one indexed identity read).
  const identityMark = await identityMarkState(
    tp
      ? { profileId: profile.id, fullName: tp.fullName, identityMarkOn: tp.identityMarkOn, identityMarkNoticeVersion: tp.identityMarkNoticeVersion }
      : { profileId: profile.id, fullName: null, identityMarkOn: false, identityMarkNoticeVersion: null },
  ).catch((e: unknown) => {
    logError(e, { op: 'teachers.me.identityMark' })
    return null
  })
  const identityMarkStamps = {
    at: tp?.identityMarkAt ? tp.identityMarkAt.toISOString() : null,
    withdrawnAt: tp?.identityMarkWithdrawnAt ? tp.identityMarkWithdrawnAt.toISOString() : null,
  }
  if (!tp) {
    return {
      teacher: null,
      publishGate,
      identityMark,
      identityMarkStamps,
      prefill: {
        displayName: profile.displayName ?? null,
        avatarUrl: profile.avatarUrl && isListingImageUrl(profile.avatarUrl) ? profile.avatarUrl : null,
        phone: profile.phone ?? null,
      },
    }
  }
  const { private: priv, listing, ...rest } = tp
  // What schools actually see — a moderation pull keeps the listing down whatever `status` says.
  const listingLive = !!listing && listing.status === 'active' && listing.verified
  // The owner's own phone + whether a CV or a private intro video exists — never either path (neither is a URL anyone
  // needs; the private video is watched only through a school's signed link). videoVersion is the form's video base.
  // The saved photo was asked about (Admin's re-check, 2026-10-16 — /api/cron/teacher-photo-recheck) and not approved since:
  // the edit form says why, beside the photo. ADVISORY like publishGate: a failed read is null (no line), never a failed page.
  const photoAsk = await savedPhotoAsk(profile.id, tp.photoUrl).catch((e) => { logError(e, { op: 'teachers.me.photoAsk' }); return null })
  return { teacher: { ...rest, listingLive, phone: priv?.phone ?? '', cvFileName: priv?.cvFileName ?? null, hasPrivateVideo: !!priv?.videoPath }, publishGate, identityMark, identityMarkStamps, photoAsk }
})

/** The reason the saved photo was asked about — none once an admin approved it, or for a photo changed since. */
async function savedPhotoAsk(profileId: string, url: string | null): Promise<{ reason: string } | null> {
  const key = teacherPhotoKey(url)
  if (!key) return null
  const ask = await db.complianceAudit.findFirst({
    where: { action: 'teacher.photo.ask', subjectType: 'profile', subjectId: profileId, detail: { path: ['key'], equals: key } },
    orderBy: { occurredAt: 'desc' },
    select: { detail: true },
  })
  if (!ask || (await photoOverridden(profileId, key))) return null
  const reason = (ask.detail as { reason?: unknown } | null)?.reason
  return typeof reason === 'string' ? { reason } : null
}

export const PUT = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-profile', limit: 30, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
    // ⛔ ONE SHAPE (plan review D2, 2026-10-08): a body with no teach-area list comes from a tab opened before the
    // onboarding redesign. The server never guesses what an old body meant — 409 profile_changed ("reload"), and the
    // reload brings the new form (which maps that tab's sessionStorage draft at its own input boundary). Checked before
    // anything is read, so the old tab writes nothing.
    if (isLegacyTeacherBody(body)) return NextResponse.json({ error: 'profile_changed' }, { status: 409 })
    // ⛔ A SAVE NAMES THE PROFILE IT EDITS, OR CLAIMS THERE IS NONE — NEVER NEITHER (gate review, 2026-10-08). The edit
    // form sends the TeacherProfile id it loaded; a body without one — the join form's `null`, or an edit tab from before
    // the field — may only CREATE, and is refused once the account has a profile. A form opened as one account and still
    // open when the session became another (a sign-in in another tab) must never write that account's profile: its cover
    // and video bases could coincide (gate review, 2026-10-07), and an absent id used to fail OPEN — a pre-deploy edit tab
    // of account A overwrote B's profile. An old tab now gets 409 and a reload fixes it; the join form already sends a
    // teacher who has a profile to Edit.
    // This read is the FAST PATH (it refuses before any bucket copy); the guarantee is the same check under the account
    // lock, in the transaction that writes (publish.ts TeacherProfileChangedError).
    // ⚠️ The form's older calls (hide/show, CV, delete, the cover panel) act on the signed-in account: a tab of this release
    // remounts its form per account, so it shows that account; only a tab opened before it could reach another account,
    // until reloaded — an accepted residual, the same rule is their follow-up.
    const sentId = (body as { teacherProfileId?: unknown } | null)?.teacherProfileId
    const expected = typeof sentId === 'string' ? sentId : null
    const mine = await db.teacherProfile.findUnique({ where: { profileId: profile.id }, select: { id: true } })
    if ((mine?.id ?? null) !== expected) return NextResponse.json({ error: 'profile_changed' }, { status: 409 })
    // ⛔ THE ONE-TIME ACCOUNT STEP, ON THE SERVER (owner, 2026-10-11 — onboarding-gate.ts resumesInPlace; commit gate,
    // codex + opus: never from a possibly stale tab, never skipped while the form's identity was still loading). A new
    // account that signed in on the teacher form was never sent to /onboard, so its FIRST profile records what /onboard
    // records — an individual account and the Terms acceptance — and only when the page SHOWED the Terms line beside
    // Publish (`acceptTerms`, sent with that line on screen). Without it: 409 terms_required, nothing written (fail closed);
    // the form then shows the line and asks for Publish again.
    // ⛔ A PAGE THAT KEEPS ITS PLACE SKIPS ONLY THE ACCOUNT-TYPE CHOOSER (onboarding-gate.ts resumesInPlace). Any other
    // pending step — the phone, once SIGNUP_REQUIRES_PHONE is on — still comes first, and the emailed code finishes on
    // this page without passing finishSignInPath, so the create itself refuses it (commit gate, codex + opus 2026-10-11).
    if (expected === null && pendingOnboardingStep({ accountType: 'individual', phone: profile.phone }) !== null) {
      return NextResponse.json({ error: 'onboarding_required' }, { status: 409 })
    }
    const firstOnboard = expected === null && !profile.accountType
    if (firstOnboard && (body as { acceptTerms?: unknown } | null)?.acceptTerms !== true) {
      return NextResponse.json({ error: 'terms_required' }, { status: 409 })
    }
    // Written in the publish's own transaction (publish.ts `onboard`), so the profile and the account step commit together.
    const onboard = firstOnboard ? individualOnboardingWrite(profile) : null
    // A NEW teacher profile is a listing posted: it sends the Meta conversion a posted listing sends (Lead), and tells
    // TikTok a registration completed (src/lib/tiktok-events.ts) — so an ad for teacher.eno.vn can be measured by the
    // profiles it brought. Whether this request MAY report one, and to whom, is settled HERE, before the save:
    // ⛔ nothing awaited may sit between a committed save and its response (commit gate, 2026-10-11 — a throw there
    // answers 500 for a profile that exists, and the retry is then a 409). Only a create; and per platform, each
    // decided on its own, so a failure deciding one never costs the other:
    //   · Meta — configured, and the visitor's Advertising choice is on;
    //   · TikTok — configured, Advertising on in an answer no older than the day the card named TikTok, AND the
    //     consent RECORDS show Advertising was switched on under a card that named TikTok (tiktok-consent-record.ts):
    //     a "yes" to the words "Meta, Google" never reaches TikTok, whenever it was given or re-saved.
    // Then the Apple answer (the locally verified token), because the email is handed over only WITH it (D14) — and
    // an answer that cannot be read is treated as "linked": the events still go, WITHOUT the email (fail closed on the
    // email alone, the helper's own rule). A failure here never costs the save: null = report nothing.
    let conversion: { appleLinked: boolean; meta: boolean; tiktok: boolean } | null = null
    if (expected === null) {
      let meta = false
      let tiktok = false
      try {
        meta = metaCapiConfigured() && metaUserDataFromHeaders(req.headers).adConsent === true
      } catch (e) {
        logError(e, { op: 'teachers.me.conversion.ask.meta' })
      }
      try {
        tiktok = tiktokEventsConfigured() && tiktokConsent(req.headers) && (await consentRecordNamesTikTok(req.headers))
      } catch (e) {
        logError(e, { op: 'teachers.me.conversion.ask.tiktok' })
      }
      if (meta || tiktok) {
        let appleLinked = true
        try {
          appleLinked = await isCurrentUserAppleLinkedByClaims()
        } catch (e) {
          logError(e, { op: 'teachers.me.conversion.ask.apple' })
        }
        conversion = { appleLinked, meta, tiktok }
      }
    }
    try {
      const saved = await saveTeacherProfile({ id: profile.id, email: profile.email ?? null }, body, {
        expectTeacherProfileId: expected, ...(onboard ? { onboard } : {}),
      })
      // The handle and the first-onboarding effects, once it committed — best-effort, never thrown (so the rule above holds:
      // no throw between the commit and the response). The name the handle is claimed from: the account's own, else the
      // one the save just published (normalized, as it was written).
      if (onboard && saved.onboarded) {
        await afterIndividualOnboarding(req, profile, profile.displayName || normalizeTeacherInput(body).fullName.trim() || null)
      }
      // Only the FIRST save, and only when it left the profile public (`created && live`): an edit is not a new profile
      // and a held one is not posted. Like a job's salary, an hourly rate is not what the lead is worth: value 0.
      // Everything else happens after the response, contained: the two sends run SIDE BY SIDE, each best-effort and
      // logged on its own, so one platform failing — or stalling — never costs the other.
      // ⛔ THE PAGE IS NAMED, NOT READ FROM THE REQUEST: only the join form creates a profile, and its address can carry
      // the campaign that brought the teacher (the teacher.eno.vn hand-off) — /privacy sends a campaign to Meta only
      // when Analytics is on as well. No event id built from the account: its id leaves hashed or not at all.
      if (saved.created && saved.live && conversion) {
        const { appleLinked, meta, tiktok } = conversion
        const listingId = saved.listingId
        // Scheduling it is contained too: after the commit, not even this may reach the save's error handling below.
        try {
          after(async () => {
            // Contained like the sends below: a page that cannot be named costs the page, never the events.
            let page: string | undefined
            try {
              const origin = apexOrigin(process.env.NEXT_PUBLIC_APP_URL)
              page = origin ? `${origin}/teachers/join` : undefined
            } catch (e) {
              logError(e, { op: 'teachers.me.conversion.page' })
            }
            const toMeta = async () => {
              if (!meta) return
              try {
                await sendMetaCapiEvent('Lead', {
                  eventSourceUrl: page,
                  userData: metaUserDataFromHeaders(req.headers, { email: profile.email, phone: profile.phone, externalId: profile.id, appleLinked }),
                  customData: { content_ids: [listingId], content_type: 'product', content_category: TEACHERS_CATEGORY_NAME, value: 0, currency: 'VND' },
                })
              } catch (e) {
                logError(e, { op: 'teachers.me.metaLead.send' })
              }
            }
            const toTikTok = async () => {
              if (!tiktok) return
              try {
                await sendTikTokEvent('CompleteRegistration', {
                  recordNamesTikTok: tiktok, // true only when consentRecordNamesTikTok said so, above
                  pageUrl: page,
                  user: tiktokUserFromHeaders(req.headers, { email: profile.email, phone: profile.phone, externalId: profile.id, appleLinked }),
                  properties: { content_type: 'product', contents: [{ content_id: listingId, content_category: TEACHERS_CATEGORY_NAME }] },
                })
              } catch (e) {
                logError(e, { op: 'teachers.me.tiktok.send' })
              }
            }
            await Promise.all([toMeta(), toTikTok()])
          })
        } catch (e) {
          logError(e, { op: 'teachers.me.conversion.schedule' })
        }
      }
      return saved
    } catch (e) {
      if (e instanceof TeacherValidationError) {
        return NextResponse.json({ error: 'invalid_teacher_profile', fields: e.errors }, { status: 400 })
      }
      // The profile changed between the fast path above and the save's lock (deleted, made, or re-made in another window).
      if (e instanceof TeacherProfileChangedError) return NextResponse.json({ error: 'profile_changed' }, { status: 409 })
      // The page showed an older Publish, cover or AI notice than the one in force ("This page was updated — reload").
      if (e instanceof TeacherNoticeChangedError) return NextResponse.json({ error: 'notice_changed', notice: e.notice }, { status: 409 })
      // The cover state changed in another window since this form loaded it (publish.ts TeacherCoverConflictError).
      if (e instanceof TeacherCoverConflictError) return NextResponse.json({ error: 'cover_changed' }, { status: 409 })
      // The intro video changed in another window since this form loaded it, or a draft/old client tried to change it
      // without the version it loaded (src/lib/teachers/video.ts).
      if (e instanceof TeacherVideoConflictError) return NextResponse.json({ error: 'video_changed' }, { status: 409 })
      // A bucket move failed before anything was written (the copy's tombstone collects any half-made copy).
      if (e instanceof TeacherVideoStoreError) return NextResponse.json({ error: 'video_store_failed' }, { status: 502 })
      // The profile photo check could not run (publish.ts): "try again" — the answers stay in the form.
      if (e instanceof TeacherPhotoCheckUnavailableError) return NextResponse.json({ error: 'photo_check_unavailable' }, { status: 503 })
      // `detail` is the KEY of the refused field ('bio', 'experience.2') — never the word (publish.ts screenTeacherTexts).
      if (e instanceof PublishBlockedError) {
        return NextResponse.json({ error: e.code, detail: e.detail ?? null }, { status: e.code.startsWith('identity_') ? 403 : 422 })
      }
      throw e
    }
  },
)

export const DELETE = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-profile-delete', limit: 10, window: '1 h', strict: true } },
  async ({ profile }) => {
    if (!(await deleteTeacherProfile(profile.id))) throw new ApiError('teacher_profile_missing', 404)
    return { ok: true }
  },
)
