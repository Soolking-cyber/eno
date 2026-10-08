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
  }
}

/**
 * THE INTRO VIDEO, SENT ON REQUEST (owner, 2026-10-07) — its OWN grant (TeacherVideoShare), never the contact one.
 * One derivation for the routes (teacherThread) and the thread payload (api/conversations/[id]), so the strip never
 * offers what a route then refuses.
 * ⛔ A request alone unlocks nothing: shared means `sharedAt` set and not revoked (review, 2026-10-07 — the contact
 * idiom `row && !revokedAt` would have let a school's own request open the video).
 */
export function teacherVideoState(
  vs: { requestedAt: Date | null; sharedAt: Date | null; revokedAt: Date | null } | null | undefined,
  tp: { videoOnRequest?: boolean | null; private?: { videoPath: string | null } | null },
  profileLive: boolean,
) {
  /** A private intro video exists, the teacher keeps it on request, and the profile is live. */
  const available = profileLive && tp.videoOnRequest === true && !!tp.private?.videoPath
  /** The teacher's own grant in this thread, whatever the profile's state — what Send / Stop toggles. */
  const shareOn = !!vs?.sharedAt && !vs.revokedAt
  return {
    available,
    shareOn,
    /** What the school may watch now. */
    shared: shareOn && available,
    /** The school asked, and has not been answered by a revoke since. */
    requested: !!vs?.requestedAt && (!vs.revokedAt || vs.requestedAt > vs.revokedAt),
    requestedAt: vs?.requestedAt ?? null,
  }
}
