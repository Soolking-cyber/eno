import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { getSupabaseAdmin, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { looksLikeVideo, VIDEO_PATH_RE } from '@/lib/core/media'
import { cfStreamConfigured, getStreamVideo, deleteStreamVideo } from '@/lib/cf-stream'
import { streamHlsUrl } from '@/lib/stream-url'

export const runtime = 'nodejs'

const STREAM_UID_RE = /^[0-9a-f]{32}$/

// Second half of the direct-upload handshake: after the browser has PUT the clip to its
// signed URL, verify the LANDED object is really a video (magic bytes — a blob merely
// labeled video/mp4 gets deleted, not served) and hand back the public URL the wizard
// puts into the listing payload. The declared content-type was pre-checked at sign time
// and by the bucket's MIME allowlist; this closes the "lying client" gap with the only
// authoritative evidence — the stored bytes themselves.
export async function POST(req: NextRequest) {
  try {
    const profileId = await getCurrentProfileId()
    if (!profileId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
    // Higher cap than sign: Stream mode POLLS this endpoint every ~2s while CF encodes.
    const limit = await rateLimit('upload-video-complete', profileId, 120, '1 h')
    if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

    const body = (await req.json().catch(() => ({}))) as { path?: unknown; uid?: unknown }

    // Cloudflare Stream finalize/poll: given the uid the browser uploaded to, ask CF whether
    // encoding is done. `pending` → the wizard keeps polling; ready → return OUR canonical HLS
    // URL (rebuilt from the uid, not CF's response, so it always matches isStreamVideoUrl).
    if (cfStreamConfigured() && body.uid !== undefined) {
      const uid = String(body.uid)
      if (!STREAM_UID_RE.test(uid)) return NextResponse.json({ error: 'bad_uid' }, { status: 400 })
      const s = await getStreamVideo(uid)
      if (!s) return NextResponse.json({ pending: true, state: 'unknown' }) // transient CF error → keep waiting
      if (s.state === 'error') {
        await deleteStreamVideo(uid) // encode failed (corrupt/unsupported) → don't leave it parked
        return NextResponse.json({ error: 'encode_failed' }, { status: 422 })
      }
      if (!s.ready) return NextResponse.json({ pending: true, state: s.state })
      return NextResponse.json({ url: streamHlsUrl(uid) })
    }

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
    reader.cancel().catch(() => {})
    const head = Buffer.concat(chunks).subarray(0, 16)

    if (!looksLikeVideo(head)) {
      // Not a video container → evict it from the public bucket immediately.
      await admin.storage.from(LISTING_VIDEOS_BUCKET).remove([path]).catch(() => {})
      return NextResponse.json({ error: 'not_a_video' }, { status: 415 })
    }
    return NextResponse.json({ url: publicUrl })
  } catch (e) {
    console.error('[POST /api/upload/video/complete]', e)
    return NextResponse.json({ error: 'complete_failed' }, { status: 500 })
  }
}
