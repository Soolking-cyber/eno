import 'server-only'
import { db } from '@/lib/db'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'

/**
 * The share gate (owner, 2026-09-30): a teacher's phone, email and CV reach a recruiter ONLY after
 * the teacher taps "Share" in THAT conversation, and stop the moment they revoke it — and the phone only when that
 * tap included it (`phoneShared`, gate review 2026-10-09).
 *
 * ⛔ Every check is re-derived from the conversation row, never from the client:
 *   · the thread's CURRENT listing is a teacher listing (a thread retargeted to another listing of the
 *     same storefront carries no teacher contact, even if a share row survives on it);
 *   · the teacher is that listing's TeacherProfile owner and the thread's seller side;
 *   · the other side is the thread's buyer. Any account since the teacher DM ladder (owner, 2026-10-13: "Anyone") —
 *     the teacher's own tap in THAT conversation stays the only key; who may write first is dm-quota.ts's business.
 */
export async function teacherThread(conversationId: string) {
  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true, buyerProfileId: true, sellerProfileId: true, listingId: true, sellerId: true,
      listing: { select: { id: true, listingType: true, status: true, verified: true, teacherProfile: { select: { id: true, profileId: true, fullName: true, status: true, videoOnRequest: true, private: { select: { videoPath: true, phone: true } } } } } },
      teacherContactShare: { select: { sharedAt: true, revokedAt: true, phoneShared: true } },
      teacherVideoShare: { select: { requestedAt: true, sharedAt: true, revokedAt: true } },
    },
  })
  if (!convo?.listing || convo.listing.listingType !== TEACHER_LISTING_TYPE || !convo.listing.teacherProfile) return null
  const tp = convo.listing.teacherProfile
  // The teacher must be the thread's seller side — never trust a profile row that drifted.
  if (convo.sellerProfileId !== tp.profileId) return null
  const share = convo.teacherContactShare
  // ⛔ A share lives only while the profile does: hidden by the teacher, pulled by moderation, or
  // held → nothing more is served, even to a recruiter it was shared with (Opus, commit gate 09-30).
  // (A deleted profile deletes its listing, so its threads fail the listing check above.)
  const profileLive = convo.listing.status === 'active' && convo.listing.verified && tp.status === 'live'
  const video = teacherVideoState(convo.teacherVideoShare, tp, profileLive)
  return {
    convo,
    teacherProfileId: tp.id,
    teacherUserId: tp.profileId,
    teacherName: tp.fullName,
    recruiterUserId: convo.buyerProfileId,
    shared: profileLive && !!share && !share.revokedAt,
    /** The teacher's own choice, whatever the profile's state — what Share / Stop sharing toggles. */
    shareOn: !!share && !share.revokedAt,
    /**
     * ⛔ THE STANDING SHARE INCLUDES THE PHONE (gate review, 2026-10-09) — TeacherContactShare.phoneShared: its tap named
     * the phone and one was on file. /api/teachers/contact hands the phone over ONLY while this holds, so a share made as
     * "email & CV" never picks up a phone added since (that route reads the CURRENT private row); the teacher adds it with
     * "Share my phone too", a re-share. False with no share standing; a row that does not say reads as false.
     */
    phoneShared: !!share && !share.revokedAt && share.phoneShared === true,
    profileLive,
    /**
     * The private video's path AS READ WITH THE GRANT. ⛔ The watch route signs THIS path, never a second read: a
     * replacement landing between two reads would hand a school granted v1 the v2 video, whose save revoked that very
     * grant (gate review, 2026-10-07). Server-only — never in a response.
     */
    privateVideoPath: tp.private?.videoPath ?? null,
    /**
     * Is there a phone to share? Optional since A3 (owner, 2026-10-08 — required only while "Our staff may call me" is
     * on), so a share records (`phoneShared`) and announces only what it hands over. A boolean: the number itself is read
     * only by /api/teachers/contact, for a recruiter the share is for.
     */
    hasPhone: !!tp.private?.phone,
    videoAvailable: video.available,
    videoShareOn: video.shareOn,
    videoShared: video.shared,
    videoRequested: video.requested,
    videoRequestedAt: video.requestedAt,
    videoAskAgain: video.askAgain,
  }
}

/**
 * A school may ask again this long after its last ask (video-request refuses sooner) — and at any time once the teacher
 * stopped sharing since, which ends `requested`. Here, not in the route, so the strip's "Ask again" and the route's
 * acceptance are one derivation (gate review, 2026-10-08).
 */
export const ASK_AGAIN_MS = 24 * 3600 * 1000

/**
 * THE INTRO VIDEO, SENT ON REQUEST (owner, 2026-10-07) — its OWN grant (TeacherVideoShare), never the contact one.
 * One derivation for the routes (teacherThread) and the thread payload (api/conversations/[id]), so the strip never
 * offers what a route then refuses.
 * ⛔ A request alone unlocks nothing: shared means `sharedAt` set and not revoked (review, 2026-10-07 — the contact
 * idiom `row && !revokedAt` would have let a school's own request open the video).
 * ANY ACCOUNT the teacher sends it to (owner, 2026-10-13 — the DM ladder opened teacher chats to every account): the
 * 2026-10-08 business-only rule (`forBusiness`, which paused a grant for a buyer who was not a business) is gone with
 * the rule it served. The teacher's Send in THAT conversation is the only key, as for the contact share. No grant
 * existed in production when it went (measured 2026-10-13: 0 video and 0 contact shares), so none resumed.
 */
export function teacherVideoState(
  vs: { requestedAt: Date | null; sharedAt: Date | null; revokedAt: Date | null } | null | undefined,
  tp: { videoOnRequest?: boolean | null; private?: { videoPath: string | null } | null },
  profileLive: boolean,
  now = Date.now(),
) {
  /** A private intro video exists, the teacher keeps it on request, and the profile is live. */
  const available = profileLive && tp.videoOnRequest === true && !!tp.private?.videoPath
  /** The teacher's own grant in this thread, whatever the profile's state — what Send / Stop toggles. */
  const shareOn = !!vs?.sharedAt && !vs.revokedAt
  /** The school asked, and has not been answered by a revoke since. */
  const requested = !!vs?.requestedAt && (!vs.revokedAt || vs.requestedAt > vs.revokedAt)
  const requestedAt = vs?.requestedAt ?? null
  return {
    available,
    shareOn,
    /** What the other side may watch now. */
    shared: shareOn && available,
    requested,
    requestedAt,
    /**
     * The ask stands but is old enough to repeat. video-request takes a repeat ask exactly when this holds (its
     * `askedRecently` IS `requested && !askAgain`). Without it `requested` never expired and the school's row sat on
     * "You asked…" for good, while the route would have taken a fresh ask (gate review, 2026-10-08).
     */
    askAgain: requested && requestedAt !== null && now - requestedAt.getTime() >= ASK_AGAIN_MS,
  }
}
