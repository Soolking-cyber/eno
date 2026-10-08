// ── TEACHER INTRO VIDEO: SHOW, OR KEEP PRIVATE AND SEND ON REQUEST (owner, 2026-10-07) ────────────────────────────
// "make it so that they can show their intro video in profile or hide and send upon request".
//
// ⛔ A VIDEO HAS EXACTLY ONE HOME, and every save ends in one of three states:
//   none    → TeacherProfile.videoUrl = Listing.video = null, TeacherPrivate.videoPath = null
//   public  → TeacherProfile.videoUrl = Listing.video = U (a canonical `listing-videos` URL), videoPath = null
//   private → TeacherProfile.videoUrl = Listing.video = null, videoPath = P (an object in the PRIVATE `teacher-videos`)
// A public video is seen by everyone; a private one only by a school the teacher sent it to, through a 10-minute
// signed URL (src/app/api/teachers/video). Uploads always arrive through the public pipeline (sign → transcode), and
// a save MOVES the object when the teacher keeps it private — this file decides the move, video-store.ts performs it.
//
// This file is PURE (no I/O): planVideoChange is the whole state table, so it is unit-tested row by row
// (video.test.ts), and the plan's review history (codex + opus, 2 rounds, 2026-10-07) is in its comments.

/** What a save body says about the video. `videoOnRequest` absent = a client from before this feature. */
export type VideoBody = {
  videoOnRequest?: boolean
  /** The public URL the form holds: the stored public video as loaded, a NEW upload, or null. */
  videoUrl: string | null
  /** The TeacherProfile.videoVersion the form loaded — the stale-window stamp. Absent/null = loaded none. */
  videoBase?: number | null
}

/** The stored state, read under the account lock. */
export type StoredVideo = {
  videoOnRequest: boolean
  /** TeacherProfile.videoUrl — the public home's URL. */
  videoUrl: string | null
  /** TeacherPrivate.videoPath — the private home's object path. */
  videoPath: string | null
  videoVersion: number
}

export type VideoRef = { bucket: 'listing-videos'; url: string } | { bucket: 'teacher-videos'; path: string }

export type VideoPlan =
  | { kind: 'refuse'; code: 'video_changed' | 'video_not_owned' }
  | {
      kind: 'apply'
      /** Anything at all differs from what is stored (choice, home, object). */
      changed: boolean
      /** The teacher's choice as saved. */
      videoOnRequest: boolean
      /**
       * Where the video ends up. `copy` = it must first be copied into the other bucket (video-store.ts); the copy's
       * new address replaces the `pending` marker before anything is written.
       */
      home:
        | { kind: 'none' }
        | { kind: 'public'; url: string; copyFromPrivate?: string }
        | { kind: 'private'; path: string; copyFromPublic?: string }
      /** Objects this save displaces — tombstoned IN the save's transaction, purged after commit. */
      displaced: VideoRef[]
      /** The private video changed or left: every school's grant to it ends (a school sent v1 must not see v2). */
      revokeGrants: boolean
    }

/** Marker for "the path/URL the copy will produce" in a plan, before the copy has run. */
export const PENDING = '<pending>'

/**
 * THE STATE TABLE. `owned(url)` answers whether a NEW public upload is this teacher's own (the upload pipeline
 * records the uploader — video-store.ts `videoOwner`); the stored public video is grandfathered.
 *
 * Rules (each a review finding, 2026-10-07):
 *   · a body that would CHANGE anything must carry the version it loaded (`videoBase`) and it must match — a stale tab,
 *     a draft restore, a crafted link or a pre-feature client can never publish, hide, replace or delete over a newer
 *     choice; a save that leaves the video as stored needs no base;
 *   · a NEW url kept PRIVATE on its first save must be the teacher's own upload (a soft guard against keeping someone
 *     else's video as yours); a new url SHOWN publicly is stored as before this feature. ⛔ Deletion safety is NOT this
 *     check: a URL saved public and then hidden is grandfathered, and it is safe because every listing-videos delete is
 *     reference-checked — the displaced object goes only when no surviving row shows it (gate review, 2026-10-07);
 *   · `videoUrl: null` over a PRIVATE video keeps it (the form never holds a private URL); removing one is its own
 *     call (DELETE /api/teachers/me/video) — over a PUBLIC video, null is the explicit Remove it always was;
 *   · a stored state with BOTH homes (only a deploy window can make one) resolves to private: privacy wins.
 */
export function planVideoChange(row: StoredVideo | null, body: VideoBody, owned: (url: string) => boolean): VideoPlan {
  // No profile yet (a first publish): nothing stored, so nothing a stale window could overwrite — no base needed.
  const stored = row ?? { videoOnRequest: false, videoUrl: null, videoPath: null, videoVersion: 0 }
  const legacy = body.videoOnRequest === undefined
  const choice = legacy ? stored.videoOnRequest : body.videoOnRequest === true
  const U = stored.videoUrl
  const P = stored.videoPath
  // Over a stored private video the form never holds a URL, so the stored public U (a both-homes leftover) is no upload.
  const url = body.videoUrl && !(P && body.videoUrl === U) ? body.videoUrl : null
  const fresh = url !== null && url !== U
  // A soft guard on a FIRST private save: keeping someone else's upload as your own private video. Shown publicly a URL is
  // stored as it always was (no new dependency on the upload record). Deleting the source is safe either way: every
  // listing-videos purge is reference-checked (see the rule list above).
  if (fresh && choice && !owned(url)) return { kind: 'refuse', code: 'video_not_owned' }

  let home: Extract<VideoPlan, { kind: 'apply' }>['home']
  const displaced: VideoRef[] = []
  if (P) {
    if (!url) {
      // Keep it private, or publish it — the choice decides (and the base check below stands guard).
      home = choice ? { kind: 'private', path: P } : { kind: 'public', url: PENDING, copyFromPrivate: P }
      if (!choice) displaced.push({ bucket: 'teacher-videos', path: P })
    } else {
      // A new upload replaces the private video, kept private or shown.
      home = choice ? { kind: 'private', path: PENDING, copyFromPublic: url } : { kind: 'public', url }
      displaced.push({ bucket: 'teacher-videos', path: P })
      if (choice) displaced.push({ bucket: 'listing-videos', url })
    }
    // A both-homes leftover: the public copy goes, whatever else happens.
    if (U && !(home.kind === 'public' && home.url === U)) displaced.push({ bucket: 'listing-videos', url: U })
  } else if (U) {
    if (!url) {
      home = { kind: 'none' } // the explicit Remove
      displaced.push({ bucket: 'listing-videos', url: U })
    } else if (url === U) {
      home = choice ? { kind: 'private', path: PENDING, copyFromPublic: U } : { kind: 'public', url: U }
      if (choice) displaced.push({ bucket: 'listing-videos', url: U })
    } else {
      home = choice ? { kind: 'private', path: PENDING, copyFromPublic: url } : { kind: 'public', url }
      displaced.push({ bucket: 'listing-videos', url: U })
      if (choice) displaced.push({ bucket: 'listing-videos', url })
    }
  } else {
    if (!url) home = { kind: 'none' }
    else {
      home = choice ? { kind: 'private', path: PENDING, copyFromPublic: url } : { kind: 'public', url }
      if (choice) displaced.push({ bucket: 'listing-videos', url })
    }
  }

  const finalUrl = home.kind === 'public' ? home.url : null
  const finalPath = home.kind === 'private' ? home.path : null
  const changed = choice !== stored.videoOnRequest || finalUrl !== U || finalPath !== P
  if (changed && row && (body.videoBase == null || body.videoBase !== row.videoVersion)) return { kind: 'refuse', code: 'video_changed' }
  return {
    kind: 'apply',
    changed,
    videoOnRequest: choice,
    home,
    displaced,
    revokeGrants: !!P && finalPath !== P,
  }
}

/** The version an edit form loads and sends back as `videoBase`. */
export function videoBaseOf(stored: Pick<StoredVideo, 'videoVersion'> | null): number | null {
  return stored ? stored.videoVersion : null
}
