import 'server-only'
import { db } from '@/lib/db'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'

/**
 * The share gate (owner, 2026-09-30): a teacher's phone, email and CV reach a recruiter ONLY after
 * the teacher taps "Share" in THAT conversation, and stop the moment they revoke it.
 *
 * ⛔ Every check is re-derived from the conversation row, never from the client:
 *   · the thread's CURRENT listing is a teacher listing (a thread retargeted to another listing of the
 *     same storefront carries no teacher contact, even if a share row survives on it);
 *   · the teacher is that listing's TeacherProfile owner and the thread's seller side;
 *   · the recruiter is the thread's buyer and still a business account.
 */
export async function teacherThread(conversationId: string) {
  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true, buyerProfileId: true, sellerProfileId: true, listingId: true, sellerId: true,
      listing: { select: { id: true, listingType: true, status: true, verified: true, teacherProfile: { select: { id: true, profileId: true, fullName: true, status: true, videoOnRequest: true, private: { select: { videoPath: true } } } } } },
      teacherContactShare: { select: { sharedAt: true, revokedAt: true } },
      teacherVideoShare: { select: { requestedAt: true, sharedAt: true, revokedAt: true } },
      // The thread's buyer side — whether the intro video can reach it at all (teacherVideoState `forBusiness`).
      buyer: { select: { accountType: true } },
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
  // `buyer` is a required relation (Conversation.buyerProfileId, onDelete: Cascade): a thread without one does not exist.
  const video = teacherVideoState(convo.teacherVideoShare, tp, profileLive, convo.buyer.accountType === 'business')
  return {
    convo,
    teacherProfileId: tp.id,
    teacherUserId: tp.profileId,
    teacherName: tp.fullName,
    recruiterUserId: convo.buyerProfileId,
    shared: profileLive && !!share && !share.revokedAt,
    /** The teacher's own choice, whatever the profile's state — what Share / Stop sharing toggles. */
    shareOn: !!share && !share.revokedAt,
    profileLive,
    /**
     * The private video's path AS READ WITH THE GRANT. ⛔ The watch route signs THIS path, never a second read: a
     * replacement landing between two reads would hand a school granted v1 the v2 video, whose save revoked that very
     * grant (gate review, 2026-10-07). Server-only — never in a response.
     */
    privateVideoPath: tp.private?.videoPath ?? null,
    videoAvailable: video.available,
    videoShareOn: video.shareOn,
    videoShared: video.shared,
    videoRequested: video.requested,
    videoRequestedAt: video.requestedAt,
    videoAskAgain: video.askAgain,
    videoForBusiness: video.forBusiness,
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
 * ⛔ BUSINESS-ONLY (gate review, 2026-10-08): only a school or company may ask for, be sent, or watch the video. The
 * flags ignored the BUYER's account type, so a parent writing to a teacher was offered "Ask for their intro video" and
 * then refused, and a teacher could send to an account that can never watch. `forBusiness` = the thread's buyer is a
 * business account; `available` deliberately does NOT carry it, so the teacher's "profile hidden" copy stays true.
 * ⚠️ A buyer that is no longer a business PAUSES a grant already sent: `shareOn` stays, so the teacher still sees it and
 * keeps Stop, and it plays again if the account becomes a business again — exactly as the contact share pauses while
 * the profile is hidden and resumes on un-hide. Deliberate, not dangling: the teacher sent it to this account.
 */
export function teacherVideoState(
  vs: { requestedAt: Date | null; sharedAt: Date | null; revokedAt: Date | null } | null | undefined,
  tp: { videoOnRequest?: boolean | null; private?: { videoPath: string | null } | null },
  profileLive: boolean,
  forBusiness: boolean,
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
    /** What the school may watch now. */
    shared: shareOn && available && forBusiness,
    requested,
    requestedAt,
    /**
     * The ask stands but is old enough to repeat. video-request takes a repeat ask exactly when this holds (its
     * `askedRecently` IS `requested && !askAgain`). Without it `requested` never expired and the school's row sat on
     * "You asked…" for good, while the route would have taken a fresh ask (gate review, 2026-10-08).
     */
    askAgain: requested && requestedAt !== null && now - requestedAt.getTime() >= ASK_AGAIN_MS,
    forBusiness,
  }
}
