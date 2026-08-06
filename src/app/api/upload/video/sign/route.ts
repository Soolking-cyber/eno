import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { getEnforcement, blocksPosting } from '@/lib/enforcement'
import { getSupabaseAdmin, LISTING_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import { VIDEO_ALLOWED, VIDEO_MAX_BYTES } from '@/lib/core/media'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'

// Mint a signed DIRECT-upload URL for a listing video. The bytes go browser→Supabase —
// they cannot pass through a Vercel function (bodies over ~4.5MB are rejected with
// FUNCTION_PAYLOAD_TOO_LARGE before the route runs; a real 60s phone clip is 10–50MB).
//
// Gates, in order: SIGN-IN REQUIRED (videos are heavy + publishing needs an account
// anyway — no anonymous path into the public bucket), enforcement (suspended/held
// accounts can't park content in public storage), per-profile rate limit, declared
// type/size pre-check. The bucket's own MIME allowlist + 50MB cap re-check at upload
// time, and /api/upload/video/complete verifies the landed object's real magic bytes.
//
// ⚠️ WS6 MIGRATION — THE WRAPPER TAKES THE AUTH PREAMBLE ONLY, AND THE RATE LIMIT DELIBERATELY STAYS
// IN THE HANDLER. route() runs `rateLimit` BEFORE the handler, which would put it ahead of the
// enforcement gate and flip a restricted account that is also over the limit from 403
// `account_restricted` to 429 `rate_limited`. The gate order above is documented and intentional, so
// it is preserved rather than reordered for the sake of using the option. `auth: 'userId'` is the
// same getCurrentProfileId() the old code called.
//
// ⚠️ NO `body:` SCHEMA — `req.json().catch(() => ({}))` means a missing/malformed body succeeds into
// the `bad_type` 415, not a 400. A schema would change that code.
//
// ⚠️ THE try/catch STAYS: every throw here answers `sign_failed` 500, not `internal_error`, so this
// route is byte-identical on every branch including the failure path. That catch would also rewrite a
// thrown ApiError into `sign_failed` — return responses explicitly, don't convert them to throws.
export const POST = route({ auth: 'userId' }, async ({ req, userId }) => {
  try {
    const { state } = await getEnforcement(userId)
    if (blocksPosting(state)) return NextResponse.json({ error: 'account_restricted' }, { status: 403 })

    // Accountable account → fail OPEN (don't block posting on a Redis blip).
    // ⚠️ strict: FAIL CLOSED. Each call mints a signed URL authorising a direct 50MB browser→Supabase
    // write into the PUBLIC listing-videos bucket. Un-limited, that is free bulk file hosting on our
    // storage bill. Same blast radius as the transcode route: no video attach during an outage,
    // everything else about posting still works.
    const limit = await rateLimit('upload-video-sign', userId, 30, '1 h', { strict: true })
    if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

    const body = (await req.json().catch(() => ({}))) as { type?: unknown; size?: unknown }
    const type = String(body.type || '')
    const size = Number(body.size)
    const ext = VIDEO_ALLOWED.get(type)
    if (!ext) return NextResponse.json({ error: 'bad_type' }, { status: 415 })
    if (!Number.isFinite(size) || size <= 0 || size > VIDEO_MAX_BYTES) {
      return NextResponse.json({ error: 'too_large' }, { status: 413 })
    }

    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage.from(LISTING_VIDEOS_BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      console.error('[POST /api/upload/video/sign]', error?.message)
      return NextResponse.json({ error: 'sign_failed' }, { status: 500 })
    }
    // signedUrl is the full direct-upload endpoint (the web SDK derives it from
    // its Supabase config; native clients have no SDK, so hand it over). Additive.
    return NextResponse.json({ path: data.path, token: data.token, signedUrl: data.signedUrl })
  } catch (e) {
    console.error('[POST /api/upload/video/sign]', e)
    return NextResponse.json({ error: 'sign_failed' }, { status: 500 })
  }
})
