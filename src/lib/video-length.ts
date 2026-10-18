/**
 * THE LONGEST CLIP EACH KIND OF VIDEO UPLOAD KEEPS, IN SECONDS — read from the file in the browser before anything goes up
 * (one second over, for rounding) and enforced again by the server's transcode (src/lib/core/video-transcode.ts). A
 * listing's clip is a minute; a teacher's intro video five (owner, 2026-10-18: "the teacher profile video is at 1 minute
 * now make it 5 but the size limit stays the same so people can upload up to 5 minute long videos") — the 150 MB pick
 * limit and the 50 MB storage ceiling are the same for both.
 */
export const VIDEO_MAX_SECONDS = { listing: 60, teacher_intro: 300 } as const

export type VideoUploadKind = keyof typeof VIDEO_MAX_SECONDS

/**
 * WHERE THE SERVER'S TRANSCODE CUTS EACH KIND (src/lib/core/video-transcode.ts TRANSCODE_PLAN): a listing's clip 2 s past
 * its minute, as always; an intro video half a minute past its five — a compressed recording runs a little longer than its
 * source when playback stalls — and an intro video the cut reaches is refused, so the teacher form refuses a recording that
 * ran past it before uploading it (src/lib/teachers/video-prep.ts).
 */
export const VIDEO_CUT_SECONDS = { listing: VIDEO_MAX_SECONDS.listing + 2, teacher_intro: VIDEO_MAX_SECONDS.teacher_intro + 30 } as const

export const isVideoUploadKind = (v: unknown): v is VideoUploadKind => v === 'listing' || v === 'teacher_intro'
