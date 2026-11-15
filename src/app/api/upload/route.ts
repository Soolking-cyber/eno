import { recordImageOwner } from '@/lib/image-owner'
import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { storeListingImage, prepareListingImage, putListingImage, sniffImageType, IMG_ALLOWED, IMG_MAX_BYTES, type PreparedListingImage } from '@/lib/core/media'
import { chargeAccountPhotoCheck } from '@/lib/ai-guard'
import { flyerRuleFor } from '@/lib/listing-photo-check'
import { listingPhotoVerdict, rememberPhotoKey } from '@/lib/listing-photo-verdict'
import { ownsStorefront, photoCheckExemptFor } from '@/lib/listing-photo-refusal'

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
//
// ⛔ NO FLYERS AND NO CONTACT DETAILS IN LISTING PHOTOS (owner, 2026-11-15; src/lib/listing-photo-check.ts) — OPT-IN:
// only the post wizard sends `check=listing` (+ `category`). Without it nothing here changes (avatars, banners, evidence,
// the teacher form). With it each file is prepared, then checked — the files of a request in parallel, 8 s at most — and:
//   · a refusal stands only on TWO reads that agree (both models, in parallel); that file is NOT STORED, reason
//     photo_flyer / photo_contact;
//   · anything else — ok, a lone refusal, past the deadline, over a cap, no model — is stored (FAIL-OPEN): the pass after
//     Publish decides;
//   · a GUEST gets the cache only, never a paid read (ai-guard.ts: AI is login-only); a member's own cap comes first;
//   · where the pass never checks (PHOTO_CHECK_EXEMPT, from the `subcategory` and `seller` the wizard sends) nothing is
//     checked. ⛔ A client-sent `seller` counts only when the signed-in caller owns that storefront (otherwise anyone
//     could name SDC_store and skip the check); the pass after Publish decides with the real one in any case.
// The answer adds `results`, one per file in the order sent ({ url } or { reason }).
const CHECK_DEADLINE_MS = 8_000

type FileResult = { url: string } | { reason: string }

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
    const category = String(form.get('category') || '')
    const sent = String(form.get('seller') || '')
    const exempt = async () => photoCheckExemptFor({ category, subcategory: String(form.get('subcategory') || '') || null, sellerId: (await ownsStorefront(profileId, sent)) ? sent : '' }).catch(() => false)
    if (watermark && String(form.get('check') || '') === 'listing' && !(await exempt())) {
      return await checkedUpload(files, perRequest, reasons, { profileId, flyerRule: flyerRuleFor(category) })
    }
    for (const file of files.slice(0, perRequest)) {
      const buf = await readUpload(file)
      if (typeof buf === 'string') { failed++; reasons.push(buf); continue }
      const url = await storeListingImage(buf, { watermark })
      // A signed-in headshot records its uploader (image-owner.ts): the teacher photo check spends checks only on yours.
      if (url && profileId && !watermark) await recordImageOwner(url, profileId)
      if (url) urls.push(url)
      else {
        // sharp could not decode it despite JPEG/PNG/WebP bytes — a corrupt or truncated file.
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

/** The file's bytes, or why it is refused ('type' | 'empty' | 'size') — before any sharp call. */
async function readUpload(file: File): Promise<Buffer | string> {
  // Cheap pre-check on the client-provided type/size; the core re-decodes with sharp.
  if (!IMG_ALLOWED.has(file.type)) {
    // The picker accepts .heic/.heif and the client converts them, so a HEIC arriving here
    // means that conversion silently produced nothing — worth seeing rather than guessing.
    console.warn('[POST /api/upload] rejected type', file.type || '(none)', file.name?.slice(-12))
    return 'type'
  }
  if (file.size === 0 || file.size > IMG_MAX_BYTES) {
    console.warn('[POST /api/upload] rejected size', file.size)
    return file.size === 0 ? 'empty' : 'size'
  }
  const buf = Buffer.from(await file.arrayBuffer())
  // ⛔ THE BYTES, NOT THE LABEL, BEFORE ANY SHARP CALL. file.type is whatever the browser or curl said, and sharp
  // decodes SVG, GIF, TIFF and AVIF too (sniffImageType). Our clients re-encode to JPEG/WebP, or forward the person's
  // own file (bulk ZIP, compressImageFile's keep-the-original), so a file refused here is an AVIF/GIF wearing a .jpg
  // name or not from our clients at all, and `head` says which.
  if (!sniffImageType(buf)) {
    console.warn('[POST /api/upload] rejected bytes', file.type, 'head', buf.subarray(0, 8).toString('hex'), file.name?.slice(-12))
    return 'type'
  }
  return buf
}

/** The opt-in path (header). `reasons` arrives holding the over-cap count. */
async function checkedUpload(files: File[], perRequest: number, reasons: string[], o: { profileId: string | null; flyerRule: boolean }) {
  const results: FileResult[] = files.map(() => ({ reason: 'over_cap' }))
  const prepared: { i: number; img: PreparedListingImage }[] = []
  for (const [i, file] of files.slice(0, perRequest).entries()) {
    const buf = await readUpload(file)
    const img = typeof buf === 'string' ? null : await prepareListingImage(buf)
    if (img) prepared.push({ i, img })
    else results[i] = { reason: typeof buf === 'string' ? buf : 'decode' }
  }
  const gate = o.profileId ? { beforeRead: () => chargeAccountPhotoCheck(o.profileId!) } : { cacheOnly: true }
  const verdicts = await Promise.all(prepared.map(({ img }) => listingPhotoVerdict(
    { bytes: img.out, sha: img.sha256 },
    { lane: 'upload', flyerRule: o.flyerRule, confirm: 'parallel', deadlineMs: CHECK_DEADLINE_MS, ...gate },
  )))
  for (const [n, { i, img }] of prepared.entries()) {
    const v = verdicts[n]
    if (typeof v === 'object' && v.rule !== 'ok' && v.confirmed) { results[i] = { reason: `photo_${v.rule}` }; continue }
    const put = await putListingImage(img)
    if (!put) { results[i] = { reason: 'decode' }; continue }
    // The facts belong to the bytes (sha): the stored key points at them, so the pass and a save find them.
    await rememberPhotoKey(put.key, img.sha256)
    results[i] = { url: put.url }
  }
  const urls = results.flatMap((r) => ('url' in r ? [r.url] : []))
  reasons.push(...results.flatMap((r) => ('reason' in r && r.reason !== 'over_cap' ? [r.reason] : [])))
  const failed = files.length - urls.length
  if (failed) console.warn('[POST /api/upload] checked:', failed, 'of', files.length, 'rejected —', reasons.join(','))
  return NextResponse.json({ urls, failed, reasons, results })
}
