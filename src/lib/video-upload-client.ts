import type { VideoUploadKind } from '@/lib/video-length'

/**
 * PUT ONE LISTING CLIP IN THE `listing-videos` BUCKET AND RETURN ITS PUBLIC URL.
 *
 * ⛔ EXTRACTED FROM `use-post-media.ts`, NOT COPIED, AND THAT DISTINCTION IS THE POINT. Bulk import
 * needed the same four-step sequence — sign, upload to the signed URL, complete, transcode — and a
 * second copy of it would have been sixty lines of security-relevant, retry-shaped code drifting
 * quietly from the original. The wizard now calls this too, so there is one implementation of the
 * HEVC rule, one poll deadline and one set of error codes.
 *
 * ⚠️ THE ERROR CODES ARE PART OF THE CONTRACT: it throws `Error('video')` or `Error('video_hevc')`,
 * which the wizard's submit catch already maps to user-facing copy — and, for a teacher's intro video
 * only, `Error('video_too_long')`: a clip whose length the browser could not read turned out longer
 * than its kind keeps (the server refuses it rather than cutting it) — and `Error('video_busy')`: this
 * account tried too often this hour, or the server asked it to try again (try again later). Do not
 * "improve" them into messages — the caller decides the wording, in two languages.
 */

/**
 * ⚠️ MIRRORS THE SERVER'S `VIDEO_MAX_BYTES` (core/media.ts, server-only) AND THE BUCKET LIMIT
 * (scripts/setup-storage.mjs) — 50MB is the Supabase PROJECT-WIDE upload ceiling, probed, and
 * owner-raisable only in the dashboard. Keep the three in lockstep.
 */
export const VIDEO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024

/**
 * HEVC (H.265) detector, lifted out of the post wizard so BULK IMPORT ENFORCES THE SAME RULE.
 *
 * ⛔ WITHOUT IT, BULK TELLS THE SERVER "H.264" FOR EVERY CLIP. iPhones capture .mov/.mp4 in
 * High-Efficiency HEVC by default, and the transcode route falls OPEN for H.264 — so an unchecked
 * bulk import would publish clips that play as a black box for the mid-range Android majority, and
 * the seller would never know. A reviewer caught exactly this: the detection lived in the wizard's
 * picker, and bulk had no picker.
 *
 * The `hvc1`/`hev1` codec fourcc lives in the moov box, which sits at the START (faststart) or END
 * of the file — scan both edges. H.264 (`avc1`) passes. Heuristic by design: a false negative just
 * means the clip uploads as-is; the sniff costs two 2MB slices, no full read.
 *
 * ⚠️ ALWAYS slice — never pass the whole File. Blob.slice caps the read at EDGE bytes even when
 * WKWebView misreports f.size (a real iOS quirk); a `size ≤ 4MB → whole file` branch once
 * materialized a multi-hundred-MB ArrayBuffer on exactly those picks and jetsam killed the app.
 */
export async function hasHevcTrack(f: Blob): Promise<boolean> {
  const EDGE = 2 * 1024 * 1024
  const edges = [f.slice(0, EDGE), f.slice(Math.max(0, f.size - EDGE))]
  for (const part of edges) {
    const arr = new Uint8Array(await part.arrayBuffer())
    for (let i = 0; i < arr.length - 3; i++) {
      // 'hvc1' = 104, 118, 99, 49  ·  'hev1' = 104, 101, 118, 49
      if (arr[i] === 104) {
        if (arr[i + 1] === 118 && arr[i + 2] === 99 && arr[i + 3] === 49) return true
        if (arr[i + 1] === 101 && arr[i + 2] === 118 && arr[i + 3] === 49) return true
      }
    }
  }
  return false
}

/**
 * How long the client waits for the server's encode, by kind: its wall plus two minutes for the download and the upload
 * (src/lib/core/video-transcode.ts TRANSCODE_PLAN) — and, for an intro video, past the route's lease (wall + 150 s), so a
 * job that died answers 404 before the client stops asking. Pinned against both in src/lib/video-length.test.ts.
 */
export const TRANSCODE_WAIT_MS: Record<VideoUploadKind, number> = { listing: 330_000, teacher_intro: 720_000 }

export type VideoUploadOptions = {
  /** True when the source is HEVC, which fails CLOSED — see the transcode note below. */
  hevc?: boolean
  /**
   * How long to wait for the server-side encode. The wizard gives it the full 330s; a bulk import
   * passes something smaller, because a row that cannot produce a clip must not hold up 199 others.
   * A teacher's intro video waits 720s by default: its encode may run 540s (src/lib/core/video-transcode.ts).
   */
  deadlineMs?: number
  /**
   * Which clip this is — what the server's transcode keeps of it (src/lib/video-length.ts): a listing's
   * minute (the default) or a teacher's five-minute intro video. Client-supplied, and that is enough:
   * the cut only shortens what an honest client already gated; see the transcode route.
   */
  kind?: VideoUploadKind
}

export async function uploadListingVideo(file: File, opts: VideoUploadOptions = {}): Promise<string | null> {
  const kind: VideoUploadKind = opts.kind ?? 'listing'
  // An intro video's upload and encode can take minutes: the screen is held on meanwhile where the browser allows (a
  // locked phone suspends the page, and its upload with it) — and held again when the page comes back, since a browser
  // drops the lock whenever the page is hidden (gate review, 2026-10-18). Best effort — never a failed upload.
  if (kind !== 'teacher_intro' || typeof document === 'undefined') return upload(file, opts, kind)
  let done = false
  let lock = await requestScreenLock()
  const relock = () => {
    if (document.visibilityState !== 'visible') return
    void requestScreenLock().then((next) => {
      if (!next) return
      if (done) { void next.release().catch(() => undefined); return }
      // The one it replaces is let go — never two held (gate review); the browser has usually released it on hide already.
      if (lock && lock !== next) void lock.release().catch(() => undefined)
      lock = next
    })
  }
  document.addEventListener('visibilitychange', relock)
  try {
    return await upload(file, opts, kind)
  } finally {
    done = true
    document.removeEventListener('visibilitychange', relock)
    void lock?.release().catch(() => undefined)
  }
}

async function requestScreenLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const wake = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    return (await wake?.request('screen')) ?? null
  } catch {
    return null
  }
}

async function upload(file: File, opts: VideoUploadOptions, kind: VideoUploadKind): Promise<string | null> {
  const long = kind === 'teacher_intro'
  const deadlineMs = opts.deadlineMs ?? TRANSCODE_WAIT_MS[kind]
  // A long encode is polled less often: 144 polls at worst instead of 240, inside the poll limit (600/h).
  const pollMs = long ? 5_000 : 3_000
  // Loaded on demand: only a caller that actually has a CLIP needs supabase-js, so it must not sit
  // in /post's first-load bundle for the photo-only majority. Fetched BEFORE the signing call on
  // purpose — the signed token is short-lived, and downloading ~242 kB after minting it would burn
  // part of that window on a slow connection (codex).
  const { createSupabaseBrowser } = await import('@/lib/supabase/browser')
  const sig = await fetch('/api/upload/video/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: file.type, size: file.size }),
  })
  if (!sig.ok) throw new Error('video')
  const { path, token } = (await sig.json()) as { path: string; token: string }
  const { error: upErr } = await createSupabaseBrowser()
    .storage.from('listing-videos')
    .uploadToSignedUrl(path, token, file, { contentType: file.type, cacheControl: '31536000' })
  if (upErr) throw new Error('video')
  const done = await fetch('/api/upload/video/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!done.ok) throw new Error('video')

  // Transcode — submit-then-poll: POST claims the job and returns 202 while the encode runs
  // server-side (a synchronous ~210s response would be severed by Cloudflare's ~100s proxy budget
  // once eno.vn fronts Cloud Run); we then poll GET ?path= every 3s. Semantics preserved
  // server-side: H.264 falls open to the raw clip ({fallback}); HEVC fails closed (422 /
  // status:'failed') — a raw HEVC clip plays black on most Android buyers, so we surface a retry
  // rather than publish a broken video.
  const xc = await fetch('/api/upload/video/transcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, hevc: opts.hevc === true, kind }),
  })
  if (xc.status === 422) {
    // A listing's 422 is the HEVC clip failing closed; an intro video fails closed whatever its codec, so its own is 'video'.
    const failed = (await xc.json().catch(() => ({}))) as { error?: string }
    throw new Error(failed.error === 'video_too_long' ? 'video_too_long' : long ? 'video' : 'video_hevc')
  }
  // A listing's clip keeps its old code for these ('video'); an intro video says why.
  if (long && (xc.status === 429 || xc.status === 503)) throw new Error('video_busy')
  if (!xc.ok && xc.status !== 202) throw new Error('video')
  let xj = (await xc.json()) as { url?: string; status?: string }
  if (!xj.url && xj.status === 'running') {
    const deadline = Date.now() + deadlineMs
    const poll = async () => {
      try {
        const st = await fetch(`/api/upload/video/transcode?path=${encodeURIComponent(path)}`, {
          signal: AbortSignal.timeout(10_000),
        })
        if (!st.ok) {
          if (st.status === 404) throw new Error(opts.hevc ? 'video_hevc' : 'video') // job lost
          return // transient (429/5xx) — keep polling until the deadline
        }
        const sj = (await st.json()) as { status?: string; url?: string; reason?: string }
        if (sj.status === 'failed') throw new Error(sj.reason === 'too_long' ? 'video_too_long' : opts.hevc ? 'video_hevc' : 'video')
        if (sj.status === 'done' && sj.url) xj = sj
      } catch (err) {
        if (err instanceof Error && ['video', 'video_hevc', 'video_too_long', 'video_busy'].includes(err.message)) throw err
        // network blip / poll timeout — keep polling until the deadline
      }
    }
    while (Date.now() < deadline && !xj.url) {
      await new Promise((r) => setTimeout(r, pollMs))
      await poll()
    }
    // An intro video is asked once more past the deadline (gate review, 2026-10-18): a phone that slept through its long wait
    // wakes with the loop over, and the encode may well have finished meanwhile. A listing's clip ends as it always did.
    if (!xj.url && long) await poll()
  }
  return xj.url ?? null
}
