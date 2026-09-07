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
 * which the wizard's submit catch already maps to user-facing copy. Do not "improve" them into
 * messages — the caller decides the wording, in two languages.
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

export type VideoUploadOptions = {
  /** True when the source is HEVC, which fails CLOSED — see the transcode note below. */
  hevc?: boolean
  /**
   * How long to wait for the server-side encode. The wizard gives it the full 330s; a bulk import
   * passes something smaller, because a row that cannot produce a clip must not hold up 199 others.
   */
  deadlineMs?: number
}

export async function uploadListingVideo(file: File, opts: VideoUploadOptions = {}): Promise<string | null> {
  const deadlineMs = opts.deadlineMs ?? 330_000
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
    body: JSON.stringify({ path, hevc: opts.hevc === true }),
  })
  if (xc.status === 422) throw new Error('video_hevc')
  if (!xc.ok && xc.status !== 202) throw new Error('video')
  let xj = (await xc.json()) as { url?: string; status?: string }
  if (!xj.url && xj.status === 'running') {
    const deadline = Date.now() + deadlineMs
    while (Date.now() < deadline && !xj.url) {
      await new Promise((r) => setTimeout(r, 3000))
      try {
        const st = await fetch(`/api/upload/video/transcode?path=${encodeURIComponent(path)}`, {
          signal: AbortSignal.timeout(10_000),
        })
        if (!st.ok) {
          if (st.status === 404) throw new Error(opts.hevc ? 'video_hevc' : 'video') // job lost
          continue // transient (429/5xx) — keep polling until the deadline
        }
        const sj = (await st.json()) as { status?: string; url?: string }
        if (sj.status === 'failed') throw new Error(opts.hevc ? 'video_hevc' : 'video')
        if (sj.status === 'done' && sj.url) xj = sj
      } catch (err) {
        if (err instanceof Error && (err.message === 'video' || err.message === 'video_hevc')) throw err
        // network blip / poll timeout — keep polling until the deadline
      }
    }
  }
  return xj.url ?? null
}
