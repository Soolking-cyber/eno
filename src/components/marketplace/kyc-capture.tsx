'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, ShieldCheck } from '@/components/ui/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

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
  onUploaded,
  onImage,
  className,
}: {
  kind: KycCaptureKind
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
  const streamRef = useRef<MediaStream | null>(null)
  /** Whether this component is still on screen — see the getUserMedia guard below. */
  const mountedRef = useRef(true)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraBlocked, setCameraBlocked] = useState(false)

  // ⛔ STOP THE TRACKS ON EVERY EXIT PATH. A MediaStream left running keeps the camera indicator
  // lit after the user has moved on, which reads as spyware and is the single most common complaint
  // about in-page camera use. The ref (not state) is what makes this reliable in the unmount path.
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; stopStream() }
  }, [stopStream])

  // Revoke the object URL when the preview is replaced or torn down — otherwise every retake leaks
  // a full-resolution bitmap for the lifetime of the page.
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])


  const start = useCallback(async () => {
    setError(null)
    setPhase('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // The document is photographed with the REAR camera and the selfie with the front one.
          // `ideal`, not `exact`: a laptop has neither, and `exact` throws OverconstrainedError
          // rather than falling back to the only camera present.
          facingMode: kind === 'selfie' ? { ideal: 'user' } : { ideal: 'environment' },
          // Ask for enough pixels to clear the review floor (720x960 for a selfie). A phone will
          // exceed this comfortably; asking is what stops a browser handing back 640x480.
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      })
      // ⛔ THE COMPONENT MAY ALREADY BE GONE. getUserMedia resolves long after the permission
      // prompt appears, so an unmount mid-prompt runs stopStream() BEFORE streamRef is set —
      // the stream then arrives with nothing left to clean it up, and the camera stays on with
      // the OS privacy indicator lit. Stop it here instead of storing it.
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // iOS Safari refuses to play an inline video without an explicit play() after srcObject.
        await videoRef.current.play().catch(() => undefined)
      }
      setPhase('live')
    } catch {
      // Every failure lands here — denied, unavailable, in-app webview. The distinction does not
      // change what the seller should do next, so do not make them read about it.
      setCameraBlocked(true)
      setPhase('idle')
    }
  }, [kind])

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return
      stopStream()
      setShot({ blob, url: URL.createObjectURL(blob) })
      setPhase('review')
    // 0.92 rather than 1.0: the server re-encodes anyway, and a lossless frame from a 12 MP sensor
    // is a 20 MB upload on a Vietnamese mobile connection.
    }, 'image/jpeg', 0.92)
  }, [stopStream])

  const upload = useCallback(async (blob: Blob) => {
    setPhase('uploading')
    setError(null)
    try {
      const res = await fetch(`/api/seller/identity/documents?kind=${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: blob,
      })
      const data = (await res.json().catch(() => null)) as { path?: string; error?: string } | null
      if (!res.ok || !data?.path) {
        setError(messageFor(data?.error, tr))
        setPhase('review')
        return
      }
      const uploadId = ++uploadSeq
      onUploaded(data.path, uploadId)
      setPhase('done')
      // ⚠️ OCR fires on the COMMITTED image, only AFTER a successful upload — so the scanned MRZ
      // always corresponds to the document that was actually stored, never a shot that was retaken
      // or whose upload failed. The uploadId lets the consumer reject a stale decode that resolves
      // after a newer upload. Fires even a null decode so the consumer can surface "type instead".
      if (onImage) onImage(await decodeToImageData(blob), uploadId)
    } catch {
      setError(tr('Upload failed. Check your connection and try again.', 'Tải lên thất bại. Kiểm tra kết nối và thử lại.'))
      setPhase('review')
    }
  }, [kind, onUploaded, onImage, tr])

  const retake = useCallback(() => {
    if (shot) URL.revokeObjectURL(shot.url)
    setShot(null)
    setError(null)
    setPhase('idle')
    if (!cameraBlocked) void start()
  }, [cameraBlocked, shot, start])

  const label = kind === 'document'
    ? tr('Passport data page', 'Trang thông tin hộ chiếu')
    : tr('Selfie holding your passport and the code', 'Ảnh tự chụp cầm hộ chiếu và mã')

  const hint = kind === 'document'
    ? tr('Fill the frame with the page that has your photo and the two lines of code at the bottom.',
         'Đặt trang có ảnh và hai dòng mã ở dưới cùng cho vừa khung hình.')
    : tr('Hold the passport open next to your face, with the paper showing your code.',
         'Cầm hộ chiếu đã mở bên cạnh khuôn mặt, cùng tờ giấy ghi mã của bạn.')

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-sm text-muted-foreground">{hint}</p>

      <div className="relative overflow-hidden rounded-xl border bg-muted aspect-[4/3]">
        {phase === 'review' && shot ? (
          // A plain <img>, deliberately: the src is a blob: URL for a frame that exists only in
          // this tab, so next/image has nothing to optimise and would add a round trip to the
          // optimizer for bytes it cannot fetch.
          <img src={shot.url} alt={label} className="size-full object-contain" />
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

      <div className="flex flex-wrap gap-2">
        {phase === 'idle' && !cameraBlocked && (
          <Button variant="cta" size="sm" onClick={() => void start()}>
            {tr('Open camera', 'Mở máy ảnh')}
          </Button>
        )}
        {phase === 'live' && (
          <Button variant="cta" size="sm" onClick={capture}>{tr('Take photo', 'Chụp ảnh')}</Button>
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

        {/* The fallback. Always reachable, not only after getUserMedia fails: a seller whose browser
            silently returns a black frame has no other way out, and hiding it until we detect that
            would mean detecting something we cannot see. */}
        {phase !== 'live' && phase !== 'uploading' && phase !== 'done' && (
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            {cameraBlocked
              ? tr('Take a photo with your camera app', 'Chụp bằng ứng dụng máy ảnh')
              : tr('Use a photo instead', 'Dùng ảnh có sẵn')}
          </Button>
        )}
      </div>

      {cameraBlocked && phase === 'idle' && !shot && (
        <Alert>
          <AlertDescription>
            {tr(
              'We could not open the camera in this browser. Take the photo with your camera app instead — it works just as well.',
              'Không thể mở máy ảnh trong trình duyệt này. Hãy chụp bằng ứng dụng máy ảnh — vẫn hợp lệ như bình thường.',
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
