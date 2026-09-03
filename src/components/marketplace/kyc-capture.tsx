'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw } from '@/components/ui/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { createDocDetector, grabDetectFrame, grabDocStill, downscaleImageData, cropImageData, type DocDetector, type DocBox } from '@/lib/identity/doc-detect'

// ── CAPTURING A PASSPORT AND A SELFIE ───────────────────────────────────────────────────────────
//
// getUserMedia with a LIVE PREVIEW, not a file picker, and the reason is not aesthetics: it is the
// only shape that lets us reject a bad frame BEFORE the seller uploads it. A picker hands back
// whatever the OS returns, so the first time anyone learns the passport number is unreadable is
// when a reviewer squints at it days later and rejects the case.
//
// ⛔ IT IS NOT A SECURITY CONTROL, AND NOTHING HERE PRETENDS OTHERWISE. A determined seller can
// feed a virtual camera, or call the upload endpoint directly. `capture="environment"` on the
// fallback input is a PICKER HINT — src/components/marketplace/visa-cards.tsx:1640 says so in as
// many words. What actually ties a photograph to a moment is the server-issued challenge code the
// seller writes on paper; see src/lib/identity/challenge.ts. This component's job is to make the
// honest path easy and produce a reviewable image, nothing more.
//
// ⚠️ THE FALLBACK IS NOT OPTIONAL. getUserMedia fails for reasons that have nothing to do with
// fraud: a denied permission the browser then remembers, an iOS in-app webview (Zalo, Facebook,
// Instagram — a large share of Vietnamese mobile traffic) that never grants camera at all, a
// desktop with no camera, or an OS-level privacy toggle. Without the file input those sellers
// simply cannot verify, and they would be exactly the cohort least able to work out why.

export type KycCaptureKind = 'document' | 'selfie'
/** What the live-view guide frame should shape itself to. Document guides crop the capture to the
 *  frame so the stored image is the document ONLY (a clean read); the selfie guide is a face oval. */
export type KycGuide = 'passport' | 'id' | 'selfie'

// Document aspect ratios (long ÷ short) for the alignment frame + the crop. ID-3 passport data page
// is 125×88mm ≈ 1.42; a CCCD/ID card is 85.6×54mm ≈ 1.585. The overlay draws a frame of this shape
// and `capture()` crops the video to it, so what the user lines up is exactly what we store.
const DOC_ASPECT: Record<'passport' | 'id', number> = { passport: 1.42, id: 1.585 }

// ⚠️ MODULE-GLOBAL, monotonic across ALL captures and REMOUNTS (a per-instance ref would reset on
// key={tier} and let an old tier's late upload look "newer" than a fresh one). Every successful
// upload gets a strictly increasing id, so the OCR consumer can reject any decode that resolves
// after a newer upload — the guard that keeps a stale scan from overwriting the current document.
let uploadSeq = 0

type Phase = 'idle' | 'starting' | 'live' | 'review' | 'uploading' | 'done'

/**
 * Decode a captured/selected image to ImageData for on-device OCR (the passport MRZ scan).
 * ⚠️ EXIF ORIENTATION: phone JPEGs are frequently stored rotated with an orientation tag, and a
 * sideways MRZ never reads — `imageOrientation:'from-image'` bakes the rotation into the pixels.
 * The camera-capture blob has no EXIF (it is a fresh canvas frame), so this is a no-op there.
 * Bounded to `maxDim` so a 12MP upload does not allocate a ~48MB buffer just to be cropped to a band.
 */
async function decodeToImageData(blob: Blob, maxDim = 2000): Promise<ImageData | null> {
  try {
    let bmp: ImageBitmap
    try {
      bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    } catch {
      bmp = await createImageBitmap(blob) // older engines lack the option; orientation may be off
    }
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bmp.close?.(); return null }
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    return ctx.getImageData(0, 0, w, h)
  } catch {
    return null
  }
}

export function KycCapture({
  kind,
  guide,
  code,
  alt,
  onUploaded,
  onImage,
  className,
}: {
  kind: KycCaptureKind
  /** Live-view alignment guide. Document guides ('passport'|'id') draw an aspect-correct frame and
   *  crop the capture to it (clean document-only image); 'selfie' draws a face oval. Defaults by kind. */
  guide?: KycGuide
  /** For the selfie: the anti-fraud code to display beside the face, so the user can write it on paper
   *  and hold it in frame. Shown large in the live view. */
  code?: string
  /** Accessible alt text for the captured/uploaded preview image. The CALLER supplies it because only
   *  the caller knows the document type (a CCCD vs a passport) — this component is tier-agnostic and
   *  must not hard-code "passport". Falls back to a generic name. */
  alt?: string
  /** `uploadId` is the same monotonic id passed to `onImage` — so a consumer can mark this upload the
   *  newest AT UPLOAD TIME (before the async decode), closing the window where the path is updated
   *  but an older in-flight scan can still land. Callers that don't need it (the selfie) ignore it. */
  onUploaded: (path: string, uploadId: number) => void
  /** Optional: receive the UPLOADED image as pixels for on-device OCR (passport MRZ scan). Fires once
   *  per successful upload (camera frame or picked file, EXIF-corrected), with `null` when the image
   *  could not be decoded so the consumer can surface "type instead". ⚠️ The second arg is a
   *  MONOTONIC per-upload id: a later upload always has a higher id, so the consumer can REJECT a
   *  stale decode that resolves out of order (an older, slower shot landing after a newer one) rather
   *  than letting it overwrite the newer document's data. */
  onImage?: (img: ImageData | null, uploadId: number) => void
  className?: string
}) {
  const { tr } = useLanguage()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Serialises getUserMedia: a start bumps this, and a stream resolving for a superseded generation
  // (a double-mount in dev StrictMode, a double-tapped retry) is stopped instead of adopted.
  const startGenRef = useRef(0)
  /** Whether this component is still on screen — see the getUserMedia guard below. */
  const mountedRef = useRef(true)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // Aborts the in-flight upload on unmount, so a photo taken in an ABANDONED attempt (the user pressed
  // Back / Start over while it was uploading) never resolves to fire onUploaded against a NEW attempt.
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [qualityHint, setQualityHint] = useState<string | null>(null) // "too dark / move closer" on a rejected still
  const [detectorLoading, setDetectorLoading] = useState(false) // OpenCV document scanner is still loading (~9MB, once)
  const [aligned, setAligned] = useState(false)          // a document (or a still selfie) is detected → GREEN cue to hold
  const capturedRef = useRef(false)                      // capture() already fired this live session — fire once
  const lastStillRef = useRef<ImageData | null>(null)    // full-res still of the captured document, for post-capture OCR
  const lastBoxRef = useRef<DocBox | null>(null)         // last detected document box (for cropping the OCR still to it)
  const detectorRef = useRef<DocDetector | null>(null)   // persisted so capture() can locate the document in the captured still
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // ⚠️ TWO DISTINCT REASONS the file fallback is showing, and they must not be conflated:
  //  · cameraBlocked — getUserMedia actually REJECTED (denied, no camera, in-app webview). Only this
  //    state may show the "in-app browsers block the camera" alert; it would be a lie otherwise.
  //  · uploadChosen — the user VOLUNTARILY chose "Upload instead" though the camera works (a desktop
  //    user uploading a phone photo). Same picker, but a neutral prompt, never the blocked-camera alert.
  const [cameraBlocked, setCameraBlocked] = useState(false)
  const [uploadChosen, setUploadChosen] = useState(false)

  // ⛔ STOP THE TRACKS ON EVERY EXIT PATH. A MediaStream left running keeps the camera indicator
  // lit after the user has moved on, which reads as spyware and is the single most common complaint
  // about in-page camera use. The ref (not state) is what makes this reliable in the unmount path.
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; stopStream(); uploadAbortRef.current?.abort() }
  }, [stopStream])

  // ⚠️ CROP ONLY ON AN EXPLICIT DOCUMENT GUIDE. An omitted `guide` must NOT silently passport-crop a
  // document — a future consumer capturing an A4 page (e.g. a business ERC) would otherwise store a
  // permanently truncated image. So default a guide-less document to the FULL frame (no crop, no
  // overlay); the selfie oval is the only kind-based default, and a selfie is never cropped anyway.
  const effGuide: KycGuide | null = guide ?? (kind === 'selfie' ? 'selfie' : null)
  // Document aspect for the frame + crop; null for the selfie or a guide-less document (no crop).
  const docAspect = effGuide === 'id' ? DOC_ASPECT.id : effGuide === 'passport' ? DOC_ASPECT.passport : null
  // Revoke the object URL when the preview is replaced or torn down — otherwise every retake leaks
  // a full-resolution bitmap for the lifetime of the page.
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])


  const start = useCallback(async () => {
    setError(null)
    setQualityHint(null)
    setUploadChosen(false) // (re)opening the camera ends any voluntary-upload intent
    // ⚠️ FEATURE-DETECT FIRST. iOS in-app webviews (Zalo, Facebook — a huge share of VN mobile) don't
    // expose getUserMedia at all, or throw synchronously. Don't spin on 'starting'; go straight to the
    // file-picker fallback so those users are never stuck. `<input type=file capture>` opens the native
    // camera there and works. The mandatory fallback is the single biggest audience risk (research).
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraBlocked(true)
      setPhase('idle')
      return
    }
    setPhase('starting')
    // Claim this attempt. getUserMedia resolves asynchronously; a second start() (dev StrictMode
    // double-mount, a double-tapped "Try again") must be able to tell that IT is now the current
    // attempt so the earlier one's late-resolving stream is stopped, not adopted on top of it.
    const gen = ++startGenRef.current
    // ⚠️ ONE RETRY for a TRANSIENT hardware error. Advancing document → selfie unmounts the rear
    // camera and mounts the front one in the same commit; on mobile the OS may not have released the
    // rear track yet, so the front-camera request rejects with NotReadableError/AbortError. A single
    // retry after a short beat clears it. A permission denial (NotAllowedError) is NOT retried — a
    // genuine block still falls straight to the file fallback.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            // The document is photographed with the REAR camera and the selfie with the front one.
            // `ideal`, not `exact`: a laptop has neither, and `exact` throws OverconstrainedError
            // rather than falling back to the only camera present.
            facingMode: kind === 'selfie' ? { ideal: 'user' } : { ideal: 'environment' },
            // ⚠️ ASK HIGH FOR THE DOCUMENT camera — the MRZ is a tiny band and the guide crop keeps only a
            // fraction of the frame, so more source pixels directly buys OCR readability (the selfie just
            // needs to clear the 720×960 floor). ⛔ KEEP 4:3 — camera sensors are natively 4:3, and asking
            // 16:9 (e.g. 2560×1440) makes WebRTC pick a lower 16:9 mode or crop vertical coverage. 2560×1920
            // is 4:3 at ~5MP. `ideal`, so a weaker camera still falls back.
            width: { ideal: kind === 'selfie' ? 1920 : 2560 },
            height: { ideal: kind === 'selfie' ? 1440 : 1920 },
          },
          audio: false,
        })
        // ⛔ THE COMPONENT MAY ALREADY BE GONE. getUserMedia resolves long after the permission
        // prompt appears, so an unmount mid-prompt runs stopStream() BEFORE streamRef is set —
        // the stream then arrives with nothing left to clean it up, and the camera stays on with
        // the OS privacy indicator lit. Stop it here instead of storing it. Same for a superseded
        // start() — otherwise this stream overwrites streamRef and the newer stream's tracks leak.
        if (!mountedRef.current || gen !== startGenRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
        // ⛔ Stop any previous live stream before adopting this one. Without it a double-start replaces
        // streamRef and the old MediaStream's tracks are never stopped.
        stopStream()
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          // iOS Safari refuses to play an inline video without an explicit play() after srcObject.
          await videoRef.current.play().catch(() => undefined)
        }
        // ⛔ RE-CHECK AFTER THE await. "Upload instead" (or an unmount) can fire DURING play(): it
        // bumps the generation. Stop OUR OWN stream and return — NOT the shared stopStream(), which
        // stops whatever is in streamRef: a newer start() may have already replaced it, and calling
        // stopStream() here would kill that newer, live stream (codex). Only clear streamRef if it is
        // still ours. Then the newer generation, or the chosen fallback, is left intact.
        if (!mountedRef.current || gen !== startGenRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          if (streamRef.current === stream) streamRef.current = null
          return
        }
        setPhase('live')
        return
      } catch (err) {
        // A superseded attempt failing must not clobber the UI the newer attempt owns.
        if (gen !== startGenRef.current) return
        const name = (err as { name?: string } | null)?.name
        if (attempt === 0 && (name === 'NotReadableError' || name === 'AbortError')) {
          await new Promise((r) => setTimeout(r, 350))
          if (!mountedRef.current || gen !== startGenRef.current) return
          continue // retry once — the other camera has had a beat to release
        }
        // Denied, unavailable, in-app webview, or a retry that still failed. The distinction does not
        // change what the seller should do next, so do not make them read about it.
        setCameraBlocked(true)
        setPhase('idle')
        return
      }
    }
  }, [kind, stopStream])

  // ⚠️ LIVE-FIRST: open the camera the moment this step mounts. This component IS the "take your
  // photo" step of the wizard, so the live view + guide + shutter is the whole UI — no "Open camera"
  // tap to fumble past. If getUserMedia can't open (in-app browser, no camera), start()'s catch sets
  // cameraBlocked and the file fallback appears instead. Runs once; `start` is stable per kind.
  useEffect(() => { void start() }, [start])

  const capture = useCallback(() => {
    // ⛔ RE-ARM ON EVERY BAILOUT. The auto-capture loops set `capturedRef.current = true` and then call
    // capture(); if capture returns early (no video yet, or the light gate below), that flag must be
    // cleared or the loop's `if (capturedRef.current) return` kills auto-capture FOREVER — a user who
    // first aimed at a dark desk then never gets a green cue or a shot until Retake (fable, 2026-09-02).
    const video = videoRef.current
    if (!video) { capturedRef.current = false; return }
    const vw = video.videoWidth, vh = video.videoHeight
    if (!vw || !vh) { capturedRef.current = false; return }
    // ⚠️ Snapshot the start generation NOW. JPEG encoding (canvas.toBlob) is async, and during it the
    // live view is still up, so the user can press "Upload instead" (bumps the generation) or Back /
    // Start over (unmounts). Without a guard in the callback, the stale encode would overwrite the
    // chosen fallback with a review of the abandoned shot AND leak an object URL nothing revokes (the
    // state set is a no-op on the unmounted component, so the URL is never stored to be cleaned).
    const gen = startGenRef.current
    // ⚠️ CROP TO THE VISIBLE GUIDE. For a document, store exactly the region the user lined up inside
    // the on-screen frame — not the desk, hand and background around it — so it is "a clean image of
    // the passport only to read from" (owner). The frame is rendered over an `object-cover` video, so
    // its on-screen rect must be mapped back through that cover transform to intrinsic video pixels;
    // a center-aspect crop would silently keep whatever object-cover pushed off-screen.
    //
    // ⛔ THE SELFIE IS NEVER CROPPED — it keeps the FULL intrinsic frame. The preview box is 4:3
    // landscape, so cropping to the visible region turns a portrait front camera (e.g. 720×1280) into
    // a 720×540 image, which is BELOW the server's selfie floor (short 720 / long 960) — every capture
    // rejected, and retaking reproduces the identical crop, so the user is hard-stuck. The full frame
    // clears the floor (720×1280 passes) and still contains everything the preview showed.
    let sx = 0, sy = 0, sw = vw, sh = vh
    const frame = frameRef.current
    if (docAspect && frame) {
      const vr = video.getBoundingClientRect()
      // object-cover scales the intrinsic frame to COVER the element, then center-crops the overflow.
      const scale = Math.max(vr.width / vw, vr.height / vh)
      const fr = frame.getBoundingClientRect()
      const offX = vr.left + (vr.width - vw * scale) / 2 // where intrinsic x=0 lands on screen
      const offY = vr.top + (vr.height - vh * scale) / 2
      sx = Math.max(0, Math.round((fr.left - offX) / scale))
      sy = Math.max(0, Math.round((fr.top - offY) / scale))
      sw = Math.min(vw - sx, Math.round(fr.width / scale))
      sh = Math.min(vh - sy, Math.round(fr.height / scale))
      if (sw <= 0 || sh <= 0) { sx = 0; sy = 0; sw = vw; sh = vh } // degenerate measure → full frame
    } else if (docAspect) {
      // Frame not mounted yet (not expected in 'live') — fall back to a safe center-aspect crop.
      if (vw / vh > docAspect) { sw = Math.round(vh * docAspect); sx = Math.round((vw - sw) / 2) }
      else { sh = Math.round(vw / docAspect); sy = Math.round((vh - sh) / 2) }
    }
    // else (selfie): sx/sy/sw/sh stay the full frame — see the floor note above.
    //
    // ⛔ DOCUMENT FLOOR GUARD. The guide crop can push a mid-res camera below the server's document
    // review floor (src/lib/kyc/image.ts KYC_MIN_DIMENSIONS.document = short 640 / long 960): a
    // 720×960 stream crops to ~662×466 and is rejected, and "move closer" can't help a crop that is
    // already the guide. If the crop would breach the floor, keep the FULL frame — a looser image
    // that passes beats a clean one that is refused. (Doesn't help a camera already below the floor;
    // that fails either way.) Selfies never reach here (docAspect null → no crop).
    // ⛔ CAPTURE THE TIGHT GUIDE CROP FOR OCR *BEFORE* THE FLOOR GUARD. The floor guard below may widen
    // the UPLOAD crop to the full frame to satisfy the server's dimension floor — but the OCR still must
    // keep the TIGHT guide crop, or the MRZ shrinks into a full-frame image and reads as garbage. Measured
    // on iPhone (2026-09-03): the floor guard fired, the OCR still was ~full-frame (1440×1752), and the
    // MRZ came back no_mrz_found. So the OCR crop and the upload crop are now decoupled.
    const ocrCropBox = (vw > 0 && vh > 0 && sw > 0 && sh > 0 && (sw < vw || sh < vh))
      ? { x: sx / vw, y: sy / vh, w: sw / vw, h: sh / vh }
      : null
    if (docAspect && (Math.min(sw, sh) < 640 || Math.max(sw, sh) < 960)) { sx = 0; sy = 0; sw = vw; sh = vh }
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) { capturedRef.current = false; return }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
    // ⚠️ LIGHT QUALITY GATE (industry pattern: reject a bad still with a specific hint, never upload
    // junk). Kept LENIENT on purpose — only a clearly unusable frame (a black/blocked camera) is
    // stopped here; the server's full quality pipeline (src/lib/kyc/image.ts) is the real gate, and
    // sharpness/glare are left to the visible preview + server so a fussy client threshold can't
    // frustrate more than it helps. A rejected still keeps the camera live for another tap.
    const px = ctx.getImageData(0, 0, sw, sh).data
    let lum = 0
    for (let i = 0; i < px.length; i += 4) lum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    if (lum / (px.length / 4) < 30) {
      setQualityHint(tr('Too dark to read — find better light and take the photo again.', 'Quá tối để đọc — tìm nơi sáng hơn và chụp lại.'))
      // Re-arm AFTER a short delay, not instantly: a lit desk with a dark guide area would otherwise
      // retrigger a full-res getImageData every ~350ms (jank). The delay bounds retries; still no
      // permanent deadlock (the earlier bug this half-fixes).
      setTimeout(() => { capturedRef.current = false }, 1500)
      return
    }
    setQualityHint(null)
    // Grab the still for the post-capture MRZ read (onImage, tier B). ⛔ CROP TO THE FRAME GUIDE the user
    // aligned the passport to — the SAME region (sx,sy,sw,sh) as the uploaded crop — NOT `lastBoxRef`.
    // lastBoxRef is OpenCV's detected box, which never populates on iOS (its WASM does not init there),
    // so grabDocStill got a null box and returned the WHOLE camera frame; the MRZ band then landed on the
    // desk/floor BELOW the passport and read as garbage → no_mrz_found (measured, iPhone 2026-09-03).
    // The guide crop puts the passport — and its MRZ in the bottom band — into the still.
    // Prefer OpenCV's TIGHT detected box when it exists (desktop — tightest MRZ pixels); else the tight
    // pre-floor guide crop (iOS, where OpenCV never runs); else (guide already ~full frame) the full frame.
    lastStillRef.current = kind === 'document' ? grabDocStill(video, lastBoxRef.current ?? ocrCropBox) : null
    // ⚠️ Where OpenCV IS available (desktop), refine the crop to the detected document within the guide
    // region. On iOS the detector is absent, so the guide crop above is the final still. Async; lands
    // before onImage runs (post-upload).
    const still0 = lastStillRef.current
    if (still0 && kind === 'document' && !lastBoxRef.current && detectorRef.current) {
      const probe = downscaleImageData(still0, 640)
      if (probe) {
        void detectorRef.current.detect(probe)
          .then((r) => { if (r?.box) { const cropped = cropImageData(still0, r.box); if (cropped) lastStillRef.current = cropped } })
          .catch(() => { /* keep the full still */ })
      }
    }
    canvas.toBlob((blob) => {
      if (!blob) return
      // ⛔ Drop a stale encode: the component unmounted, or "Upload instead" superseded this capture
      // while it encoded. Do NOT create an object URL or set state here — both would be orphaned.
      if (!mountedRef.current || gen !== startGenRef.current) return
      stopStream()
      setShot({ blob, url: URL.createObjectURL(blob) })
      setPhase('review')
    // 0.92 rather than 1.0: the server re-encodes anyway, and a lossless frame from a 12 MP sensor
    // is a 20 MB upload on a Vietnamese mobile connection.
    }, 'image/jpeg', 0.92)
  }, [stopStream, docAspect, kind])

  // ── DOCUMENT AUTO-CAPTURE (OpenCV edge detection) ── the real fix: detect the DOCUMENT by its
  // rectangular edges (a genuine detector, not a pixel heuristic that can't tell a page from a face)
  // and auto-capture once the quad FILLS the frame and is held for a beat. Works on any camera —
  // webcam included — because it reads geometry, not the tiny MRZ. GREEN when a good document is
  // detected → then captures. OCR (onImage) still fills the details post-capture. If OpenCV can't load
  // (old browser, blocked), the detector stays null → manual "Take photo" only. See lib/identity/doc-detect.
  useEffect(() => {
    if (phase !== 'live' || kind !== 'document') return
    capturedRef.current = false
    setAligned(false)
    lastBoxRef.current = null
    let alive = true
    let detector: DocDetector | null = null
    let covStreak = 0
    let stillStreak = 0
    let busy = false
    let prev: Uint8ClampedArray | null = null
    const armedAt = Date.now()
    const sc = document.createElement('canvas'); sc.width = 32; sc.height = 24
    const scx = sc.getContext('2d', { willReadFrequently: true })
    setDetectorLoading(true)
    createDocDetector()
      .then((d) => { if (alive) { detector = d; detectorRef.current = d; setDetectorLoading(false) } else d.dispose() })
      .catch(() => { if (alive) setDetectorLoading(false) }) // worker/WASM failed → hold-still fallback only
    const id = setInterval(async () => {
      if (!alive || capturedRef.current) return
      const video = videoRef.current
      if (!video || !video.videoWidth) return

      // 1) PREFERRED — OpenCV document detection (person-proof). Green + capture on a stable document.
      if (detector && !busy) {
        busy = true
        const frame = grabDetectFrame(video)
        const result = frame ? await detector.detect(frame) : null
        busy = false
        if (!alive || capturedRef.current) return
        lastBoxRef.current = result?.box ?? null // where the document is → crop the OCR still to it
        const cov = result?.cov ?? null
        if (cov != null && cov >= 0.35) {
          covStreak += 1
          setAligned(true)
          if (covStreak >= 2) { capturedRef.current = true; setAligned(false); capture(); return }
          return
        }
        covStreak = 0
      }

      // 2) FALLBACK — if OpenCV hasn't fired within a few seconds (unclear edges / busy background),
      // capture on HOLD-STILL so the user is never stuck. The passport they are holding gets captured;
      // OCR falls back to the full frame (no box). Green once it's holding.
      if (Date.now() - armedAt > 4000 && scx) {
        scx.drawImage(video, 0, 0, 32, 24)
        const cur = scx.getImageData(0, 0, 32, 24).data
        let lum = 0
        for (let i = 0; i < cur.length; i += 4) lum += 0.299 * cur[i] + 0.587 * cur[i + 1] + 0.114 * cur[i + 2]
        const lit = lum / (cur.length / 4) > 35
        let still = false
        if (prev) { let d = 0; for (let i = 0; i < cur.length; i += 4) d += Math.abs(cur[i] - prev[i]); still = d / (cur.length / 4) < 7 }
        prev = cur
        stillStreak = (lit && still) ? stillStreak + 1 : 0
        if (stillStreak >= 1) setAligned(true)
        if (stillStreak >= 3) { capturedRef.current = true; setAligned(false); lastBoxRef.current = null; capture(); return }
      }
    }, 350)
    return () => { alive = false; clearInterval(id); detector?.dispose(); detectorRef.current = null; setAligned(false); setDetectorLoading(false) }
  }, [phase, kind, capture])

  // ── SELFIE AUTO-CAPTURE ── the person IS the subject, so hold-still is the right trigger: LIT + STILL
  // for ~0.9s → capture. GREEN as soon as the frame is still → the cue to keep holding. Manual shutter
  // is always available too.
  useEffect(() => {
    if (phase !== 'live' || kind !== 'selfie') return
    capturedRef.current = false
    setAligned(false)
    let alive = true
    let prev: Uint8ClampedArray | null = null
    let stillStreak = 0
    const W = 32, H = 24
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const cx = c.getContext('2d', { willReadFrequently: true })
    // ⛔ ARMING DELAY — the selfie is a PROOF-OF-CODE shot: the user must first read the challenge code,
    // write it on paper and hold it up. Auto-capturing on mere stillness ~0.9s after the camera opens
    // shot people while they were still reading the prompt, with NO code in frame — defeating the whole
    // anti-fraud purpose (agy + fable, 2026-09-02). So auto-capture cannot fire for the first few seconds;
    // anyone ready sooner uses the always-present "Take photo" button.
    const SELFIE_ARM_MS = 5000
    const armedAt = Date.now()
    const tick = () => {
      if (!alive || capturedRef.current) return
      const video = videoRef.current
      if (!video || !video.videoWidth || !cx) return
      cx.drawImage(video, 0, 0, W, H)
      const cur = cx.getImageData(0, 0, W, H).data
      let lum = 0
      for (let i = 0; i < cur.length; i += 4) lum += 0.299 * cur[i] + 0.587 * cur[i + 1] + 0.114 * cur[i + 2]
      const lit = lum / (cur.length / 4) > 40
      let still = false
      if (prev) { let diff = 0; for (let i = 0; i < cur.length; i += 4) diff += Math.abs(cur[i] - prev[i]); still = diff / (cur.length / 4) < 7 }
      prev = cur
      stillStreak = (lit && still) ? stillStreak + 1 : 0
      // Hold off during arming AND reset the streak, so auto-capture needs a FRESH ~0.9s hold after the
      // delay — a phone left still on a stand while the user writes the code doesn't satisfy it at t=5s.
      if (Date.now() - armedAt < SELFIE_ARM_MS) { stillStreak = 0; return }
      setAligned(stillStreak >= 1)
      if (stillStreak >= 3) { capturedRef.current = true; setAligned(false); capture(); return } // ~0.9s held → capture
    }
    const id = setInterval(tick, 300)
    return () => { alive = false; clearInterval(id); setAligned(false) }
  }, [phase, kind, capture])


  const upload = useCallback(async (blob: Blob) => {
    setPhase('uploading')
    setError(null)
    const ctrl = new AbortController()
    uploadAbortRef.current = ctrl
    try {
      const res = await fetch(`/api/seller/identity/documents?kind=${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: blob,
        signal: ctrl.signal,
      })
      const data = (await res.json().catch(() => null)) as { path?: string; error?: string } | null
      if (!res.ok || !data?.path) {
        setError(messageFor(data?.error, tr))
        setPhase('review')
        return
      }
      // ⛔ ABANDONED ATTEMPT GUARD. If this component unmounted while the upload was in flight (Back /
      // Start over), the abort above normally wins — but if the fetch resolved first, do NOT fire
      // onUploaded: it would set a NEW attempt's path from THIS (old) attempt's photo, pairing a
      // superseded document/selfie with a different challenge. That is the mismatch the flow forbids.
      if (!mountedRef.current) return
      const uploadId = ++uploadSeq
      onUploaded(data.path, uploadId)
      setPhase('done')
      // ⚠️ OCR fires on the COMMITTED image, only AFTER a successful upload — so the scanned MRZ
      // always corresponds to the document that was actually stored, never a shot that was retaken
      // or whose upload failed. The uploadId lets the consumer reject a stale decode that resolves
      // after a newer upload. We hand it the FULL-RES still captured at shutter time (lastStillRef,
      // far more MRZ pixels than the compressed crop blob); if that is missing, fall back to decoding
      // the uploaded blob. Fires even a null decode so the consumer can surface "type instead".
      if (onImage) onImage(lastStillRef.current ?? (await decodeToImageData(blob)), uploadId)
    } catch {
      // An abort is an intentional cancel on unmount, not a failure to report — and the component is
      // gone, so there is nothing to show it on.
      if (ctrl.signal.aborted) return
      setError(tr('Upload failed. Check your connection and try again.', 'Tải lên thất bại. Kiểm tra kết nối và thử lại.'))
      setPhase('review')
    }
  }, [kind, onUploaded, onImage, tr])

  const retake = useCallback(() => {
    if (shot) URL.revokeObjectURL(shot.url)
    setShot(null)
    setError(null)
    // ⛔ DROP THE PREVIOUS STILL. lastStillRef holds the full-res still of the LAST live capture; if it
    // survives a retake (or an "Upload instead" that picks a file, which sets no still) then onImage
    // would OCR the OLD document while the NEW blob is uploaded — data from one document, image of
    // another (fable, 2026-09-02). Cleared here and on the file path so onImage falls back to the blob.
    lastStillRef.current = null
    setPhase('idle')
    // ⚠️ Reopen the live camera ONLY on the normal path. If the camera is blocked, or the user
    // deliberately chose "Upload instead" (a frozen/wrong-lens live view), start() would drop them
    // back onto that same unusable camera — and clear uploadChosen doing it. Landing on idle instead
    // re-shows the file picker so they can pick another photo (codex).
    if (!cameraBlocked && !uploadChosen) void start()
  }, [cameraBlocked, uploadChosen, shot, start])

  // ⚠️ SELFIE COPY IS DOCUMENT-AGNOSTIC. This component does not know the tier, and the selfie's
  // anti-fraud proof is the PAPER CODE held beside the face — NOT the document, which was captured in
  // its own step. Saying "passport" here would tell a tier-A (CCCD) user to hold a document they never
  // ⚠️ NO INTERNAL TITLE/HINT. This component is TIER-AGNOSTIC, so any copy it owned would say
  // "passport" to a tier-A (CCCD) user (codex). The tier-correct heading + instructions live in the
  // consumer's per-step body (verify-client), above this component; the only copy that must exist
  // here is the preview's alt text, which the caller supplies via `alt` (falls back to a generic
  // name). The live-view alignment frame + selfie code overlay carry the in-camera guidance.
  const effAlt = alt ?? (kind === 'document'
    ? tr('Your document photo', 'Ảnh giấy tờ của bạn')
    : tr('Your selfie', 'Ảnh chân dung của bạn'))

  return (
    <div className={cn('space-y-3', className)}>
      {/* ⚠️ TALLER ON MOBILE. A 4:3 box on a portrait phone is a small strip with the tall screen empty
          ("too small" — owner, on-device). A 3:4 portrait container fills far more of the phone; the
          landscape document frame still centres inside it (object-cover on the video, the guide rect
          drives the crop). Desktop keeps 4:3. */}
      <div className="relative overflow-hidden rounded-xl border bg-black aspect-[3/4] max-h-[62svh] sm:aspect-[4/3] sm:max-h-none">
        {phase === 'review' && shot ? (
          // A plain <img>, deliberately: the src is a blob: URL for a frame that exists only in
          // this tab, so next/image has nothing to optimise and would add a round trip to the
          // optimizer for bytes it cannot fetch. object-contain so a cropped document is shown whole.
          <img src={shot.url} alt={effAlt} className="size-full bg-black object-contain" />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            // ⚠️ MIRRORED FOR THE SELFIE ONLY. An unmirrored front camera makes people misjudge
            // which way to move; mirroring the DOCUMENT view would make its text unreadable.
            className={cn('size-full object-cover', kind === 'selfie' && 'scale-x-[-1]', phase !== 'live' && 'invisible')}
          />
        )}

        {/* ── DOCUMENT GUIDE ── an aspect-correct frame with a dimmed surround. What the user lines up
            inside it is exactly what capture() crops to, so the stored image is the page alone. */}
        {phase === 'live' && docAspect && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              ref={frameRef}
              // ⚠️ WIDTH-DRIVEN ONLY. A `max-h` alongside `aspectRatio` + a definite `w-` does NOT
              // feed back to shrink the width, so the clamp would distort the frame to a non-document
              // aspect (and the crop, which follows this rect, would inherit the distortion). The
              // container is a fixed 4:3 box: 92% width makes the frame ~86% of the container's HEIGHT
              // for a passport (0.92/1.42 ÷ 0.75) and ~73% for an ID — both fit, so no clamp is needed.
              // ⚠️ NO dimmed surround. The old `0 0 0 9999px` box-shadow darkened everything OUTSIDE the
              // frame, which read as a bright "white backplate" cropping the view inside the camera
              // (owner, on-device). Just an outlined frame now — a green ring when aligned — over the full
              // live video, so the whole viewport stays visible.
              className={cn('relative w-[80%] rounded-lg border-2 transition-colors', aligned ? 'border-success' : 'border-white/80')}
              style={{ aspectRatio: String(docAspect), boxShadow: aligned ? '0 0 0 3px rgba(34,197,94,0.55)' : '0 0 0 1px rgba(0,0,0,0.35)' }}
            />
            {/* ⚠️ NO caption INSIDE the frame — the step body above already says "line it up inside the
                frame", and a second bar over the camera was clutter (owner, on-device). The frame border
                + the single bottom cue carry the in-view guidance. */}
          </div>
        )}

        {/* ── SELFIE GUIDE ── a face oval, and a COMPACT code reminder at the top. Overlay is NOT
            mirrored (it's a guide). ⚠️ The code sits in a small top chip, NOT a wide panel over the
            right half: the user holds their PAPER on that side, and an opaque panel there hid the very
            handwriting they need to see is legible and in frame (codex). Kept as a reminder only —
            the full-size code is shown above the camera in the step body. */}
        {phase === 'live' && effGuide === 'selfie' && (
          <div className="pointer-events-none absolute inset-0">
            <div
              className={cn('absolute left-1/2 top-[46%] h-[64%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 transition-colors', aligned ? 'border-success' : 'border-white/85')}
              style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }}
            />
            {code && (
              <div className="absolute inset-x-0 top-3 flex justify-center">
                <div className="flex items-center gap-2 rounded-lg bg-black/55 px-3 py-1.5">
                  <span className="text-2xs font-medium uppercase tracking-wide text-white/70">
                    {tr('Your code', 'Mã của bạn')}
                  </span>
                  <span className="whitespace-nowrap font-mono text-base font-bold tracking-[0.15em] text-white">{code}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Live instruction + GREEN cue. Passport: it reads the code and auto-captures (green when it
            reads). Selfie: hold still and it auto-captures (green when still). A tap always works too. */}
        {phase === 'live' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className={cn('rounded-lg px-3 py-1.5 text-center text-xs font-medium text-white', aligned ? 'bg-success' : 'bg-black/55')}>
              {aligned
                ? tr('Hold still…', 'Giữ yên…')
                : detectorLoading
                  ? tr('Preparing… or tap Take photo', 'Đang chuẩn bị… hoặc chạm Chụp ảnh')
                  : kind === 'selfie'
                    ? tr('Face + code in view — or tap Take photo', 'Đưa mặt + mã vào khung — hoặc chạm Chụp ảnh')
                    // ⚠️ NOT "fill the frame" — that invites overfilling, pushing the bottom MRZ code lines
                    // outside the crop so the read finds no MRZ and autofill silently fails (fable, 2026-09-02).
                    : effGuide === 'id'
                      ? tr('Whole card inside the frame — or tap Take photo', 'Cả thẻ nằm trong khung — hoặc chạm Chụp ảnh')
                      : tr('Whole page inside the frame — or tap Take photo', 'Cả trang nằm trong khung — hoặc chạm Chụp ảnh')}
            </span>
          </div>
        )}

        {phase === 'starting' && (
          <div className="absolute inset-0 grid place-items-center"><Spinner /></div>
        )}
        {phase === 'idle' && !shot && (
          <div className="absolute inset-0 grid place-items-center">
            <Camera className="size-8 text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {/* A rejected still (too dark) tells the user exactly what to fix, and the camera stays live. */}
      {qualityHint && phase === 'live' && (
        <Alert><AlertDescription>{qualityHint}</AlertDescription></Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {/* The MANUAL SHUTTER — always the way to capture (industry pattern). No auto-capture. */}
        {phase === 'live' && (
          <Button variant="cta" size="sm" onClick={capture}><Camera className="size-4" aria-hidden /> {tr('Take photo', 'Chụp ảnh')}</Button>
        )}
        {/* ⚠️ ESCAPE HATCH for a camera that never becomes usable — black/frozen frame or wrong lens
            once live, OR a permission request that hangs without ever resolving (some in-app webviews
            leave it pending, so the catch that sets cameraBlocked never runs and phase stays
            'starting' — a spinner with no way out). Shown in BOTH states. Bumping the start generation
            supersedes any pending getUserMedia so a late grant can't reopen over the fallback. A
            low-prominence link, never a rival to the primary shutter. */}
        {(phase === 'live' || phase === 'starting') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { startGenRef.current += 1; stopStream(); setUploadChosen(true); setPhase('idle') }}
          >
            {tr("Camera not working? Upload instead", 'Máy ảnh không hoạt động? Tải ảnh lên')}
          </Button>
        )}
        {phase === 'review' && shot && (
          <>
            <Button variant="cta" size="sm" onClick={() => void upload(shot.blob)}>
              {tr('Use this photo', 'Dùng ảnh này')}
            </Button>
            <Button variant="outline" size="sm" onClick={retake}>
              <RefreshCw className="size-4" aria-hidden /> {tr('Retake', 'Chụp lại')}
            </Button>
          </>
        )}
        {phase === 'uploading' && <Button variant="cta" size="sm" disabled><Spinner /> {tr('Uploading…', 'Đang tải lên…')}</Button>}
        {phase === 'done' && (
          <p className="text-sm text-muted-foreground">{tr('Photo saved.', 'Đã lưu ảnh.')}</p>
        )}

        {/* ⚠️ FALLBACK when the camera could not open (live-first; upload only if the camera fails) OR
            the user chose to upload anyway. In-app browsers (Zalo, Facebook, Instagram) never grant
            the camera, so those users get the picker plus a nudge to reopen in a real browser; nobody
            is hard-blocked. "Try the camera again" clears BOTH reasons and reopens the live view. */}
        {/* phase === 'idle' ONLY: in 'review' the "Use this photo" / "Retake" pair owns the row, so a
            second "Take a photo with your camera app" CTA there would be two competing primaries. */}
        {(cameraBlocked || uploadChosen) && phase === 'idle' && (
          <>
            <Button variant="cta" size="sm" onClick={() => fileRef.current?.click()}>
              {/* A voluntary uploader may be on a desktop with no camera app, so don't tell them to
                  "take a photo"; a genuinely blocked camera is mobile (in-app browser) where the
                  camera-app hint is right. Both open the same picker. */}
              {uploadChosen && !cameraBlocked
                ? tr('Choose a photo to upload', 'Chọn ảnh để tải lên')
                : tr('Take a photo with your camera app', 'Chụp bằng ứng dụng máy ảnh')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setCameraBlocked(false); setUploadChosen(false); void start() }}>
              {tr('Try the camera again', 'Thử lại máy ảnh')}
            </Button>
          </>
        )}
      </div>

      {/* NEUTRAL prompt for a voluntary upload — NOT the blocked-camera alert, which would misdiagnose
          a working camera. Only a genuine getUserMedia reject (cameraBlocked) shows that alert below. */}
      {uploadChosen && !cameraBlocked && phase === 'idle' && (
        <p className="text-sm text-muted-foreground">
          {kind === 'selfie'
            ? tr('Upload a clear selfie of your face with your written code beside it.', 'Tải lên ảnh chân dung rõ nét với mã đã viết cầm bên cạnh.')
            : tr('Upload a clear, well-lit photo that fills the frame.', 'Tải lên ảnh rõ nét, đủ sáng và lấp đầy khung hình.')}
        </p>
      )}

      {cameraBlocked && phase === 'idle' && (
        <Alert>
          <AlertDescription>
            {tr(
              "We couldn't open the camera — you may have declined access, or an in-app browser like Zalo or Facebook may be blocking it. Open this page in Safari or Chrome for the guided camera, or take the photo with your camera app.",
              'Không mở được máy ảnh — có thể bạn đã từ chối quyền, hoặc một trình duyệt trong ứng dụng như Zalo hay Facebook đang chặn. Hãy mở trang này trong Safari hoặc Chrome để dùng máy ảnh có hướng dẫn, hoặc chụp bằng ứng dụng máy ảnh.',
            )}
          </AlertDescription>
        </Alert>
      )}

      <input
        ref={fileRef}
        type="file"
        // ⚠️ `image/*` FIRST. On iOS a WKWebView narrows the picker to the listed types, and without
        // it the "Take Photo" option disappears entirely — the same trap the visa card hit.
        accept="image/*,image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
        capture={kind === 'selfie' ? 'user' : 'environment'}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // reset first, so re-picking the same file still fires
          if (!file) return
          if (shot) URL.revokeObjectURL(shot.url)
          lastStillRef.current = null // a picked file has no live still — OCR must decode THIS blob, not a prior capture
          setShot({ blob: file, url: URL.createObjectURL(file) })

          // ⚠️ THE CAMERA MUST STOP HERE TOO. This path is reachable while a stream is live (the
          // seller opened the camera, then chose a file instead), and without it the hardware stays
          // on with the privacy indicator lit while they review an upload that never used it.
          stopStream()
          setPhase('review')
        }}
      />
    </div>
  )
}

/**
 * ⚠️ EVERY CODE THE UPLOAD ROUTE CAN RETURN NEEDS AN ANSWER HERE, and each one must say what to DO.
 * "Invalid image" is the failure mode this exists to avoid: a seller whose only problem is standing
 * too far away needs to be told to move closer, not that something is invalid.
 */
function messageFor(code: string | undefined, tr: (en: string, vi: string) => string): string {
  switch (code) {
    case 'image_too_small_to_review':
      return tr('Too small to read. Move closer and fill the frame.', 'Ảnh quá nhỏ để đọc. Lại gần hơn và lấp đầy khung hình.')
    case 'image_size_invalid':
    case 'file_too_large':
      return tr('That file is too large. Take the photo again with the camera.', 'Tệp quá lớn. Hãy chụp lại bằng máy ảnh.')
    case 'image_decode_failed':
    case 'image_dimensions_invalid':
      return tr('We could not read that image. Take the photo again.', 'Không đọc được ảnh này. Hãy chụp lại.')
    case 'image_official_limit_failed':
      return tr('That photo is too detailed to store. Take it again from a little further back.', 'Ảnh quá nặng để lưu. Hãy chụp lại từ xa hơn một chút.')
    default:
      return tr('Something went wrong. Please try again.', 'Đã xảy ra lỗi. Vui lòng thử lại.')
  }
}
