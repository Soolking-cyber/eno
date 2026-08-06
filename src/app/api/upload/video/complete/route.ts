import { NextResponse } from 'next/server'
import { getSupabaseAdmin, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { looksLikeVideo, VIDEO_PATH_RE } from '@/lib/core/media'
import { logError } from '@/lib/log'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'

// Second half of the direct-upload handshake: after the browser has PUT the clip to its
// signed URL, verify the LANDED object is really a video (magic bytes — a blob merely
// labeled video/mp4 gets deleted, not served) and hand back the public URL the wizard
// puts into the listing payload. The declared content-type was pre-checked at sign time
// and by the bucket's MIME allowlist; this closes the "lying client" gap with the only
// authoritative evidence — the stored bytes themselves.
//
// ⚠️ WS6 MIGRATION — auth AND rate limit both become options, because the old preamble ran in
// exactly the wrapper's order (auth → limit → body) and the profileId was used for nothing but the
// limiter key, which route() keys identically. `auth: 'userId'` is the same getCurrentProfileId()
// this route called. NOT `strict`: the original was fail-open, and the destructive/expensive work is
// gated on the sign + transcode routes (both strict) rather than here.
//
// ⚠️ NO `body:` SCHEMA — `req.json().catch(() => ({}))` means a missing or malformed body currently
// SUCCEEDS into the `bad_path` 400, not a `bad_request` 400. A schema would change that code.
//
// ⚠️ THE try/catch STAYS, AND THAT IS WHY THERE IS NO ApiError BELOW. Every failure in this handler
// answers `complete_failed` 500, not `internal_error` — so the wire is unchanged, but it also means a
// thrown ApiError would be swallowed by this same catch and rewritten to `complete_failed`. Return
// the responses explicitly; do not "tidy" them into throws.
export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'upload-video-complete', limit: 60, window: '1 h' } },
  async ({ req }) => {
    try {
      const body = (await req.json().catch(() => ({}))) as { path?: unknown }
      const path = String(body.path || '')
      // Only the exact object-name shape the sign route mints — never an arbitrary path.
      if (!VIDEO_PATH_RE.test(path)) return NextResponse.json({ error: 'bad_path' }, { status: 400 })

      const admin = getSupabaseAdmin()
      const publicUrl = admin.storage.from(LISTING_VIDEOS_BUCKET).getPublicUrl(path).data.publicUrl
      // RANGED read of the object head — storage.download() would buffer the whole ≤50MB
      // object into this function; 16 bytes decide the verdict. Read via the stream, LOOPING
      // until ≥16 bytes or EOF: a single read() can legally return a short first chunk
      // (chunked/proxy re-framing), and a short head would false-reject — and DELETE — a
      // perfectly valid upload. Cap total reads so an ignored Range can't buffer 50MB either.
      const res = await fetch(publicUrl, { headers: { Range: 'bytes=0-15' } })
      if (!res.ok || !res.body) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let got = 0
      while (got < 16) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(value)
        got += value.length
        if (got > 64 * 1024) break // Range ignored + giant frames — more than enough to decide
      }
      reader.cancel().catch((e) => logError(e, { op: 'complete.cancel' }))
      const head = Buffer.concat(chunks).subarray(0, 16)

      if (!looksLikeVideo(head)) {
        // Not a video container → evict it from the public bucket immediately.
        // ⚠️ CHECK THE RETURNED `error`, DO NOT `.catch()` IT. supabase-js does not reject on an API
        // failure: StorageFileApi.handleOperation catches internally and returns `{ data: null, error }`
        // unless `shouldThrowOnError` is set (verified in
        // node_modules/@supabase/storage-js/dist/index.mjs). So a `.catch()` here is DEAD CODE for the
        // realistic failure — a permissions or bucket error — and an earlier version of this line had
        // exactly that, which is worse than the bare swallow it replaced because it looks handled.
        const { error: rmErr } = await admin.storage.from(LISTING_VIDEOS_BUCKET).remove([path])
        if (rmErr) logError(rmErr, { op: 'upload.evictNonVideo', bucket: LISTING_VIDEOS_BUCKET })
        return NextResponse.json({ error: 'not_a_video' }, { status: 415 })
      }
      return NextResponse.json({ url: publicUrl })
    } catch (e) {
      console.error('[POST /api/upload/video/complete]', e)
      return NextResponse.json({ error: 'complete_failed' }, { status: 500 })
    }
  },
)
