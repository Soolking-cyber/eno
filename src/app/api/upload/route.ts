import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { storeListingImage, IMG_ALLOWED, IMG_MAX_BYTES } from '@/lib/core/media'

export const runtime = 'nodejs'

// Receives image files (multipart), normalizes + stores them via the shared media core,
// returns public URLs. Kept open (the post wizard is a guest/anonymous flow), but
// RATE-LIMITED to stop the endpoint being abused as free image hosting: generous for
// signed-in users, tighter per-IP (fail-closed) for anonymous uploaders.
//
// ⚠️ WS6 — NOT MIGRATED: the auth is OPTIONAL, which no wrapper mode expresses. `getCurrentProfileId()`
// returning null is a supported outcome here (the post wizard is a guest flow), whereas `auth: 'userId'`
// 401s that caller — so migrating would break anonymous posting outright. The limiter is downstream of
// the same fact: bucket, limit AND `strict` are all chosen by whether a profile was resolved
// (`upload-user` 120/h fail-open vs `upload-ip` 30/h fail-closed), and the wrapper's option is one static
// config. Its 429 body also carries `urls`/`failed` alongside the code, which apiFail() cannot emit.
// No `body:` schema in any case — this reads multipart/form-data, not JSON.
export async function POST(req: NextRequest) {
  try {
    const profileId = await getCurrentProfileId()
    const ip = clientIp(req)
    const limit = profileId
      ? await rateLimit('upload-user', profileId, 120, '1 h') // authed seller: fail OPEN — don't block posting on a Redis blip (accountable account)
      : await rateLimit('upload-ip', ip, 30, '1 h', { strict: true }) // anon: fail CLOSED
    if (!limit.success) return NextResponse.json({ error: 'rate_limited', urls: [], failed: 0 }, { status: 429 })

    const form = await req.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) return NextResponse.json({ urls: [], failed: 0 })

    // Listing photos get the eno wordmark BAKED IN (default) — "save image" keeps
    // the mark; CSS shields don't survive a download. Avatars/shop logos
    // (kind=avatar, sent by the profile editors) stay clean.
    const watermark = String(form.get('kind') || 'listing') !== 'avatar'

    const urls: string[] = []
    let failed = 0
    // ⚠️ WHY A FILE WAS DROPPED IS NOW RECORDED. This route answers 200 with a SHORT `urls`
    // array when it rejects a file, the client turns that into "Could not upload your photos —
    // please try again", and until now nothing anywhere said which photo or why. A real report
    // of that error was undiagnosable from production: four requests, all 200, no rejection
    // reason on either side. `reason` distinguishes the three causes, all of which are
    // properties of the caller's OWN file and so safe to name.
    const reasons: string[] = []
    // ⛔ ANON IS CAPPED AT 3 FILES, SIGNED-IN KEEPS 8. The rate limit alone reads as
    // 30 requests/hour, but each request carried 8 files — 240 images/hour/IP into a
    // PUBLIC bucket from an unauthenticated caller, which is a storage and egress bill
    // with no account attached to it. Capping files rather than halving the request
    // rate keeps the honest anonymous path (a few photos, one go) intact.
    // ⚠️ THIS IS A REDUCTION, NOT A FIX: an anonymous IP can still land 90 images an
    // hour (30 requests × 3). Bulk abuse gets more expensive, not impossible.
    const perRequest = profileId ? 8 : 3
    // ⛔ COUNT WHAT THE CAP DROPS. Slicing silently answers 200 with a short `urls`
    // array and no explanation — a signed-out visitor attaching 8 photos would see 3
    // land and be told nothing. This route's own contract, stated just below, is that
    // a dropped file is always recorded; all three reviewers caught the first version
    // of this cap breaking it.
    const overCap = Math.max(0, files.length - perRequest)
    if (overCap > 0) {
      failed += overCap
      reasons.push(`over_cap:${overCap}`)
      console.warn('[POST /api/upload]', overCap, 'over the', perRequest, 'per-request cap', profileId ? '(authed)' : '(anon — sign in to send more)')
    }
    for (const file of files.slice(0, perRequest)) {
      // Cheap pre-check on the client-provided type/size; the core re-decodes with sharp.
      if (!IMG_ALLOWED.has(file.type)) {
        // The picker accepts .heic/.heif and the client converts them, so a HEIC arriving here
        // means that conversion silently produced nothing — worth seeing rather than guessing.
        console.warn('[POST /api/upload] rejected type', file.type || '(none)', file.name?.slice(-12))
        failed++; reasons.push('type'); continue
      }
      if (file.size === 0 || file.size > IMG_MAX_BYTES) {
        console.warn('[POST /api/upload] rejected size', file.size)
        failed++; reasons.push(file.size === 0 ? 'empty' : 'size'); continue
      }
      const url = await storeListingImage(Buffer.from(await file.arrayBuffer()), { watermark })
      if (url) urls.push(url)
      else {
        // sharp could not decode it despite an allowed mime — a mislabelled or corrupt file.
        console.warn('[POST /api/upload] storeListingImage returned nothing for', file.type, file.size)
        failed++; reasons.push('decode')
      }
    }
    if (failed) console.warn('[POST /api/upload]', failed, 'of', files.length, 'rejected —', reasons.join(','))
    return NextResponse.json({ urls, failed, reasons })
  } catch (e) {
    console.error('[POST /api/upload]', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
