'use client'

// Step sections of the PostWizard with FLAT prop seams (photos/media, price,
// location, contact) + the success screen, moved out of post-wizard.tsx verbatim.
// Hoisted to module scope so React keeps stable component identity across the
// wizard's frequent re-renders (a keystroke must not remount these subtrees).
// No behaviour change: every handler body, class list and ⚠️ comment travelled
// as-is; the only state that moved IN here is state no other step ever read (the
// photo grid's dragOver, the contact card's editingPhone). Category / Details /
// Specifics stay inline in post-wizard.tsx — their prop seams are not clean
// (they touch most of the wizard's state at once).
//
// ⚠️ The `pw-photo` / `pw-price` / `pw-location` / `pw-contact` Section ids here
// are load-bearing: scrollToMissing() in post-wizard.tsx does
// getElementById('pw-' + checkKey). Don't rename them.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ImagePlus, X, MapPin, ChevronDown, Check, Sparkles, Loader2, LocateFixed, Zap, Video, SquarePlay, Camera, Crop } from 'lucide-react'
import { cn } from '@/lib/utils'
import { captureNativePhoto, nativePhotoCaptureAvailable } from '@/lib/native-photos'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { FieldControl } from '@/components/ui/field'
import { useLanguage } from '@/context/language-context'
import { moneyLocale, compactPrice } from '@/lib/vnd'
import type { PostMedia } from '@/hooks/use-post-media'
import { Section, Field } from './post-wizard-parts'
import { VndInput } from './vnd-input'
import { EnoSeal } from './eno-seal'
import { Mascot } from './mascot'
import { ShareButton } from './share-button'
import { SquareCropDialog } from './square-crop-dialog'

type T = (vi: string, en: string) => string

/* Photos (+ optional video) — everything media lives in the usePostMedia bundle. */
export function MediaSection({
  media,
  errPhoto,
  minPhotos,
  aiEnabled,
  aiBusy,
  autofillFromPhoto,
  t,
}: {
  media: PostMedia
  errPhoto: boolean
  /** Category-dependent photo minimum (services = 1, goods = 3). */
  minPhotos: number
  aiEnabled: boolean
  aiBusy: 'photo' | 'desc' | null
  autofillFromPhoto: () => void
  t: T
}) {
  const { photos, setPhotos, addPhotos, applySquareCrop, keepFullPhoto, movePhoto, bindPhoto, draggingPhoto, converting, video, videoBusy, addVideo, removeVideo } = media
  // Which photo's square-reframe dialog is open (index), or null.
  const [cropIndex, setCropIndex] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // ── Native camera (Capacitor) ───────────────────────────────────────────────
  // On Android the file input below CANNOT reach the camera: Capacitor only launches
  // ACTION_IMAGE_CAPTURE for inputs carrying `capture`, and adding that attribute would make
  // the input capture-ONLY and kill multi-select. So a seller on Android literally cannot
  // photograph their own item. On native we therefore add a SECOND tile that goes straight to
  // @capacitor/camera (src/lib/native-photos.ts — read its header for why capture comes back as
  // base64 and why the gallery deliberately stays on the file input).
  //
  // ⚠️ Why a separate tile and not one tile + a native action sheet: opening the file dialog
  // via input.click() requires live user activation, and awaiting a native sheet consumes it —
  // the "choose from library" branch of a sheet would silently do nothing. Two tiles keep the
  // library path on the label's OWN activation, which is never lost.
  //
  // Resolved AFTER mount so the server and the first client render emit identical markup (the
  // extra tile appears on-device only, where there is no SSR mismatch to create).
  const [nativeCamera, setNativeCamera] = useState(false)
  // ── Native camcorder (Capacitor, ANDROID only) ──────────────────────────────
  // The same trap as the photo input, one layer down. Capacitor's Android
  // BridgeWebChromeClient only launches ACTION_VIDEO_CAPTURE when the input carries
  // `capture` AND its accept list literally contains `video/*` — the existing video input has
  // neither, so an Android seller cannot film the item they are holding. iOS is unaffected:
  // WKWebView's own file picker already offers "Record Video", so gating on android keeps a
  // redundant tile off that platform.
  //
  // ⚠️ It has to be a SECOND input, never `capture` on the existing one: with `capture`,
  // Android goes straight to the camcorder and the library branch is gone (the photo comment
  // above spells this out). And it has to be a <label>+<input>, not a Button that clicks an
  // input — the file dialog needs the label's own user activation, which nothing consumes.
  const [androidCamcorder, setAndroidCamcorder] = useState(false)
  useEffect(() => { setNativeCamera(nativePhotoCaptureAvailable()) }, [])
  // Resolved after mount for the same reason as nativeCamera: the server and the first client
  // render must emit identical markup, so the extra tile appears on-device only.
  useEffect(() => {
    const cap = (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
    }).Capacitor
    setAndroidCamcorder(!!cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android')
  }, [])
  // Two guards, deliberately. The REF is the real one: `capturing` state is read from a render
  // closure, so a double-tap inside one tick sees the stale `false` and launches the camera
  // twice — Capacitor keeps a single pending call per plugin, so the second launch orphans the
  // first. The state exists only to paint the spinner + disable the tile.
  const capturingRef = useRef(false)
  const [capturing, setCapturing] = useState(false)
  const takeNativePhoto = async () => {
    if (capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)
    try {
      const res = await captureNativePhoto()
      if (res.status === 'ok') await addPhotos([res.file])
      else if (res.status === 'denied') toast.error(t('eno cần quyền máy ảnh — bật trong Cài đặt để chụp ảnh.', 'eno needs camera access — turn it on in Settings to take photos.'))
      else if (res.status === 'failed' || res.status === 'unavailable') toast.error(t('Không chụp được ảnh — thử lại hoặc chọn ảnh từ thư viện.', "Couldn't take that photo — try again, or pick one from your library."))
      // 'cancelled' → the seller backed out on purpose; say nothing.
    } finally {
      capturingRef.current = false
      setCapturing(false)
    }
  }

  return (
    <Section
      id="pw-photo"
      title={t('Ảnh', 'Photos')}
      hint={minPhotos === 1
        // Services: one photo is enough, but say that more still help — the ask is
        // "optional", not "don't bother".
        ? t('Cần 1 ảnh, tối đa 6. Ảnh đầu là ảnh bìa. Thêm ảnh là tuỳ chọn nhưng tin nhiều ảnh được xem nhiều hơn hẳn.', 'One photo is enough, up to 6. The first is your cover. More are optional, but listings with more photos get far more views.')
        : t('Tối thiểu 3 ảnh từ các góc khác nhau, tối đa 6. Ảnh đầu là ảnh bìa. Tin nhiều ảnh được xem nhiều hơn hẳn.', 'At least 3 photos from different angles, up to 6. The first is your cover. Listings with more photos get far more views.')}
    >
      {/* A photo grid is not a labelable control, so it can't go in a <Field>. Same
          contract by hand: it names itself, reports invalid, and points at its error. */}
      <div
        role="group"
        aria-label={t('Ảnh', 'Photos')}
        // No aria-invalid on role="group" (unsupported per ARIA; jsx-a11y flags it and SRs ignore
        // it) — the error is announced via aria-describedby → the role="alert" message. The visual
        // error ring is state-driven (errPhoto in className), not aria-invalid.
        aria-describedby={errPhoto ? 'pw-photo-error pw-photo-hint' : 'pw-photo-hint'}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addPhotos(e.dataTransfer.files) }}
        className={cn('grid grid-cols-3 gap-2 rounded-2xl transition-colors sm:grid-cols-4', dragOver && 'bg-brand/5 ring-2 ring-brand/40', errPhoto && '-mx-2 -mt-2 p-2 ring-2 ring-destructive/60')}
      >
        {photos.map((p, i) => (
          <div
            key={i}
            {...bindPhoto(i)}
            className={cn(
              'group relative aspect-square cursor-move select-none overflow-hidden rounded-xl bg-tint transition-[transform,box-shadow]',
              // Lifted (mid-drag) affordance: the grabbed tile rises above the grid.
              draggingPhoto === i && 'z-10 scale-105 shadow-xl ring-2 ring-brand/50',
            )}
          >
            <img src={p.url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
            {i === 0 ? (
              <span className="absolute left-1.5 top-1.5 rounded-lg bg-primary px-1.5 py-0.5 text-3xs font-bold text-white">{t('Bìa', 'Cover')}</span>
            ) : (
              // transition-opacity is load-bearing: it must beat the base
              // transition-all, or the tile's drag transform animates.
              <Button
                type="button"
                variant="bare"
                size="none"
                onClick={() => movePhoto(i, 0)}
                className="absolute bottom-1 left-1 rounded-lg bg-black/55 px-1.5 py-0.5 text-3xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
              >
                {t('Đặt làm bìa', 'Make cover')}
              </Button>
            )}
            <IconButton size="xs" variant="overlay" aria-label={t('Xóa ảnh', 'Remove photo')} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((arr) => arr.filter((_, j) => j !== i)) }} className="absolute right-1 top-1 h-6 w-6">
              <X className="h-4 w-4" />
            </IconButton>
            {/* Reframe / keep-full — only on a NEW photo (edit-mode hosted images have no source
                to re-crop). Always visible (mobile can't hover); the label says the current state. */}
            {p.original && (
              <button
                type="button"
                onClick={() => setCropIndex(i)}
                aria-label={t('Cắt ảnh thành hình vuông', 'Crop photo to square')}
                className="absolute bottom-1 right-1 flex h-6 items-center gap-1 rounded-lg bg-black/55 px-1.5 text-3xs font-bold text-white cursor-pointer"
              >
                <Crop className="h-3 w-3" />
                {p.square === false ? t('Đầy đủ', 'Full') : t('Vuông', 'Square')}
              </button>
            )}
          </div>
        ))}
        {/* Native only — the direct camera. Sits BEFORE the library tile: photographing the item
            you're holding is the primary act on a phone, picking an old screenshot is not. */}
        {nativeCamera && photos.length < 6 && (
          <Button
            type="button"
            variant="bare"
            size="none"
            onClick={() => { void takeNativePhoto() }}
            disabled={capturing}
            aria-label={t('Chụp ảnh', 'Take photo')}
            className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors hover:border-brand hover:text-accent-foreground"
          >
            {capturing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            <span className="text-3xs font-semibold">{t('Chụp ảnh', 'Take photo')}</span>
            <span className="text-3xs leading-tight text-ink-4">{t('tối đa 6 ảnh', 'up to 6 photos')}</span>
          </Button>
        )}
        {/* ⚠️ Optical pairing (R2, blind critic): every empty tile in this grid keeps the SAME
            three-row stack (glyph · label · 3xs hint) so the glyphs sit on one shared centerline —
            the photo tile used to be two rows, which floated its glyph lower than the video
            tile's. The hint line is real copy, not a spacer. */}
        {photos.length < 6 && (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors hover:border-brand hover:text-accent-foreground">
            {converting ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            <span className="text-3xs font-semibold">{converting ? t('Đang xử lý…', 'Processing…') : nativeCamera ? t('Thư viện', 'Library') : t('Thêm ảnh', 'Add')}</span>
            <span className="text-3xs leading-tight text-ink-4">{t('tối đa 6 ảnh', 'up to 6 photos')}</span>
            <input type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
          </label>
        )}

        {/* Optional video — its own square in the SAME grid, so it's exactly a photo-tile
            size, flowing INLINE right after the "Add photo" tile on EVERY size (owner
            2026-07-17: dropped the old col-start-1 that pushed it to its own row below on
            mobile — it now sits to the RIGHT of "Add photo"). */}
        {/* Android only — the direct camcorder, sitting BEFORE the library tile for the same
            reason the camera does: filming the item in your hands is the primary act on a
            phone. ⚠️ The 60s cap is stated up front because ACTION_VIDEO_CAPTURE has NO
            duration limit of its own — the length is only checked after the recording comes
            back (use-post-media's ≤61s probe), so a seller who films three minutes would
            otherwise lose all of it to a rejection they were never warned about. */}
        {androidCamcorder && !video && (
          // ⚠️ Disabled while a pick/probe is in flight, and deliberately WITHOUT its own
          // spinner. `addVideo` early-returns while videoBusy, so a camcorder launched mid-probe
          // would come back to a silent drop — the seller films 40 seconds and nothing appears.
          // A disabled input cannot be activated through its label, which closes that path; the
          // tile beside it owns the single "Checking…" indicator, so there is never a second
          // spinner competing with it. (codex + Gemini both flagged this on the first cut.)
          <label
            aria-disabled={videoBusy || undefined}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors',
              videoBusy ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:border-brand hover:text-accent-foreground',
            )}
          >
            <Video className="h-6 w-6" />
            <span className="text-3xs font-semibold">{t('Quay video', 'Record video')}</span>
            <span className="text-3xs leading-tight text-ink-4">{t('tối đa 60 giây', 'stop before 60s')}</span>
            {/* `accept` must literally contain `video/*` and `capture` must be present, or
                Capacitor's Android bridge silently opens the file picker instead. */}
            <input
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              disabled={videoBusy}
              onChange={(e) => { addVideo(e.target.files); e.currentTarget.value = '' }}
            />
          </label>
        )}

        <div className="aspect-square">
          {video ? (
            <div className="group relative h-full w-full overflow-hidden rounded-xl bg-black">
              <video src={video.url} muted loop autoPlay playsInline preload="metadata" className="h-full w-full object-cover" />
              <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-lg bg-black/60 px-1.5 py-0.5 text-3xs font-bold text-white backdrop-blur-[2px]">
                <Video className="h-3 w-3" /> {t('Video', 'Video')}
              </span>
              <IconButton size="xs" variant="overlay" aria-label={t('Xóa video', 'Remove video')} onClick={removeVideo} className="absolute right-1 top-1 h-6 w-6">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          ) : (
            // Same busy guard as the camcorder tile: a second pick landing mid-probe hits
            // addVideo's early return and is dropped without a word. This tile keeps the
            // spinner — it is the slot the finished video appears in.
            <label
              aria-disabled={videoBusy || undefined}
              className={cn(
                'flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-ink-4 transition-colors',
                videoBusy ? 'pointer-events-none' : 'cursor-pointer hover:border-brand hover:text-accent-foreground',
              )}
            >
              {/* SquarePlay, not Video (R2, blind critic): lucide Video's artwork is a 20×12
                  box that reads a full step smaller than ImagePlus's 18×19 rounded square
                  beside it. SquarePlay IS ImagePlus's optical twin — the same 18-unit
                  rounded square (rx2, the canon's soft-corner tier) with the app's
                  established video mark inside (play triangle = video everywhere: card
                  badges, view toggles, the feed). The pair now reads at one optical size.
                  The Android camcorder tile keeps the camera-bodied Video glyph — record
                  vs pick is a real distinction there. */}
              {videoBusy ? <Loader2 className="h-6 w-6 animate-spin" /> : <SquarePlay className="h-6 w-6" />}
              {/* Relabelled when the camcorder tile is beside it, so the two tiles read as
                  "record" vs "pick" rather than two identical "Add video"s. */}
              <span className="text-3xs font-semibold">{videoBusy ? t('Đang kiểm tra…', 'Checking…') : androidCamcorder ? t('Thư viện', 'Library') : t('Thêm video', 'Add video')}</span>
              <span className="text-3xs leading-tight text-ink-4">{t('tùy chọn · 60 giây', 'optional · 60s')}</span>
              {/* disabled, not just pointer-events-none: the label can also be reached by
                  keyboard, and only a disabled input refuses to open the picker. */}
              <input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" className="hidden" disabled={videoBusy} onChange={(e) => { addVideo(e.target.files); e.currentTarget.value = '' }} />
            </label>
          )}
        </div>
      </div>
      {errPhoto && <p id="pw-photo-error" role="alert" className="mt-2 text-xs font-semibold text-destructive">{minPhotos === 1 ? t('Thêm ít nhất 1 ảnh', 'Add at least 1 photo') : t('Thêm ít nhất 3 ảnh từ các góc khác nhau', 'Add at least 3 photos from different angles')}</p>}
      {/* Media hint covers the video square in the grid above. */}
      <p id="pw-photo-hint" className="mt-1.5 text-xs text-ink-4">{t('Ảnh đầu là ảnh bìa. Video (tùy chọn) tự phát khi rê chuột và trong mục Video.', 'First photo is your cover. A video (optional) autoplays on hover and in the Video feed.')}</p>
      {aiEnabled && photos.length > 0 && (
        <Button
          type="button"
          variant="bare"
          size="none"
          onClick={autofillFromPhoto}
          disabled={!!aiBusy}
          className="mt-3 gap-1.5 rounded-xl border border-line-strong px-3 py-1.5 text-xs font-bold text-accent-foreground transition-colors hover:bg-muted disabled:opacity-50 cursor-pointer"
        >
          {aiBusy === 'photo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {t('Tự điền từ ảnh', 'Autofill from photo')}
        </Button>
      )}
      <SquareCropDialog
        file={cropIndex != null ? photos[cropIndex]?.original ?? null : null}
        onApply={(square) => { if (cropIndex != null) applySquareCrop(cropIndex, square); setCropIndex(null) }}
        onKeepFull={() => { if (cropIndex != null) keepFullPhoto(cropIndex); setCropIndex(null) }}
        onCancel={() => setCropIndex(null)}
      />
    </Section>
  )
}

/* Price — amount + negotiable/fixed + urgent. `touch` is the wizard's on-blur
   validation marker; err flags/messages are computed in the wizard (they mirror
   the publish-blocking checks there). */
export function PriceSection({
  fixedPriceOnly,
  price,
  setPrice,
  touch,
  errPrice,
  priceErr,
  priceBand,
  priceUnit,
  negotiable,
  setNegotiable,
  urgent,
  setUrgent,
  t,
}: {
  /** Services sell at a stated price: no offers, no urgency (owner, 2026-07-22). */
  fixedPriceOnly?: boolean
  price: string
  setPrice: (v: string) => void
  touch: (k: string) => void
  errPrice: boolean
  priceErr?: string
  priceBand: { n: number; p25: number; median: number; p75: number } | null
  priceUnit: string
  negotiable: boolean
  setNegotiable: (v: boolean) => void
  urgent: boolean
  setUrgent: (v: boolean) => void
  t: T
}) {
  return (
    <Section id="pw-price" title={t('Giá', 'Price')}>
      <div onBlur={() => touch('price')}>
        <div className="flex max-w-xs items-center gap-2">
          {/* VndInput renders a <div> (input + VND suffix + preset chips), so it is not a
              labelable control and cannot go inside a <FieldControl>. The Section's heading
              "Giá/Price" is a heading, not a label — so the name and the reason have to be
              handed to the inner <input> by hand, or a screen reader reads this as an
              "invalid, blank edit field" with no name and no reason, on the one control that
              blocks every publish. */}
          <div className="flex-1">
            <VndInput
              id="pw-price-input"
              value={price}
              onChange={setPrice}
              placeholder={t('Nhập giá', 'Enter price')}
              invalid={errPrice}
              aria-label={t('Giá', 'Price')}
              aria-describedby={priceErr ? 'pw-price-error' : undefined}
            />
          </div>
          {priceUnit && <span className="shrink-0 text-sm font-semibold text-ink-4">{priceUnit}</span>}
        </div>
        {priceErr && <p id="pw-price-error" role="alert" className="mt-1.5 text-xs font-semibold text-destructive">{priceErr}</p>}
        {priceBand && Number(price) > 0 && <PriceGuidance price={Number(price)} band={priceBand} />}
        {/* Negotiable vs fixed — a fixed price hides the offer UI so buyers just
            ask availability and buy directly (seller's convenience). Fixed price
            also switches off Urgent: urgency promises flexibility. */}
        {/* Services are sold at the price stated — the negotiable/fixed choice and the
            Urgent toggle are both hidden for them (owner, 2026-07-22: "for services
            category all products non negotiable"). The server forces the same two values,
            so hiding the control is presentation, never the enforcement. */}
        {!fixedPriceOnly && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('Kiểu giá', 'Price type')}>
          {[
            { val: true, label: t('Có thể trả giá', 'Negotiable'), hint: t('Người mua có thể trả giá', 'Buyers can send offers') },
            { val: false, label: t('Giá cố định', 'Fixed price'), hint: t('Không nhận trả giá', 'No offers — ask & buy directly') },
          ].map((opt) => (
            <Button
              key={String(opt.val)}
              type="button"
              variant="bare"
              size="none"
              onClick={() => { setNegotiable(opt.val); if (!opt.val) setUrgent(false) }}
              aria-pressed={negotiable === opt.val}
              className={cn(
                // Stacked two-line label: `block` (the base is inline-flex) and
                // `whitespace-normal` (the base nowrap inherits into the hint line).
                'block whitespace-normal rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition-colors cursor-pointer',
                negotiable === opt.val ? 'bg-primary text-white' : 'bg-tint text-body hover:bg-muted',
              )}
            >
              {opt.label}
              <span className={cn('block text-xs font-medium', negotiable === opt.val ? 'text-white/80' : 'text-ink-4')}>{opt.hint}</span>
            </Button>
          ))}
        </div>
        )}
        {/* Urgent sale ("Bán gấp") — free, 7 days, auto-expires. Selecting it
            force-enables offers (the server enforces the same coupling). Uses the
            destructive token (not warning): white-on-warning is unreadable in dark
            (--warning is amber-400 there). Distinct from the blue selections. */}
        {!fixedPriceOnly && (
        <div className="mt-3">
          <Button
            type="button"
            variant="bare"
            size="none"
            onClick={() => { const next = !urgent; setUrgent(next); if (next) setNegotiable(true) }}
            aria-pressed={urgent}
            className={cn(
              // Block-level flex row, left-aligned, wrapping: `flex` (base is
              // inline-flex), `justify-start` (base centres), and
              // `whitespace-normal` (base nowrap inherits into the two-line hint).
              'flex justify-start whitespace-normal gap-2 rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition-colors cursor-pointer',
              // Urgent is NOT an error: it wears the same solid-ink tone the urgent
              // chip uses on cards (card-badges TONE.urgent), not the destructive red.
              // Red here would both conflate urgency with failure and fail AA in dark
              // (white on the light dark-mode red is 3.17:1).
              urgent ? 'bg-foreground text-background' : 'bg-tint text-body hover:bg-muted',
            )}
          >
            <Zap className={cn('h-4 w-4 shrink-0', urgent && 'fill-current')} />
            <span>
              {t('Bán gấp', 'Urgent sale')}
              <span className={cn('block text-xs font-medium', urgent ? 'text-white/80' : 'text-ink-4')}>
                {t('Nổi bật 7 ngày — cần bán nhanh, sẵn sàng nhận trả giá', 'Highlighted for 7 days — sell fast, open to offers')}
              </span>
            </span>
          </Button>
        </div>
        )}
      </div>
    </Section>
  )
}

/* Location — area-picker trigger (the AreaFilter popover itself stays in the
   wizard, anchored to areaBtnRef) + the quick geolocate button. */
export function LocationSection({
  errLocation,
  areaLabel,
  areaBtnRef,
  setAreaOpen,
  useMyLocation,
  locating,
  t,
}: {
  errLocation: boolean
  areaLabel: string
  areaBtnRef: React.RefObject<HTMLButtonElement | null>
  setAreaOpen: React.Dispatch<React.SetStateAction<boolean>>
  useMyLocation: () => void
  locating: boolean
  t: T
}) {
  return (
    <Section id="pw-location" title={t('Khu vực', 'Location')}>
      {/* A popover trigger + a geolocate button — no labelable control, so this is
          Field's contract by hand. The trigger carries it too: it is the focusable
          one, so it is what a screen reader actually lands on. */}
      <div
        role="group"
        aria-label={t('Khu vực', 'Location')}
        // aria-invalid is unsupported on role="group" (jsx-a11y flags it; SRs ignore it). The error
        // reaches AT through the focusable trigger + aria-describedby → the error message.
        aria-describedby={errLocation ? 'pw-location-error' : undefined}
        className="flex max-w-md items-center gap-2"
      >
        <Button
          variant="bare"
          size="none"
          type="button"
          ref={areaBtnRef}
          aria-invalid={errLocation ? true : undefined}
          aria-describedby={errLocation ? 'pw-location-error' : undefined}
          onClick={() => setAreaOpen((o) => !o)}
          className={cn(
            // POPOVER ANCHOR. AreaFilter's reposition() reads this button's
            // getBoundingClientRect() during the render that opens the panel, so three
            // base classes have to be cancelled here or the panel lands wrong / the
            // control changes weight:
            //   active:scale-100 — the base active:scale-[0.97] shrinks the rect mid-press,
            //     and the open-render happens while the button is still :active. Same
            //     load-bearing guard as price-range-filter's trigger.
            //   font-normal — the placeholder span below has NO weight of its own, so the
            //     base font-medium would inherit into it and bold it 400→500. (The
            //     picked-area span carries its own font-medium and is unaffected.)
            //   shrink — flex-1 and shrink-0 are different tailwind-merge groups, so the
            //     base's shrink-0 survives twMerge and beats flex-1's flex-shrink:1 on
            //     stylesheet order. `shrink` is the same group, so it wins and restores it.
            // duration-150 restores the default transition time the base's duration-100 cuts.
            'flex min-w-0 flex-1 shrink items-center justify-between gap-2 rounded-xl bg-tint px-3.5 py-3 text-sm font-normal text-left transition-colors duration-150 active:scale-100 hover:bg-muted',
            errLocation && 'ring-2 ring-destructive/60',
          )}
        >
          <span className={cn('flex min-w-0 items-center gap-2', areaLabel ? 'text-foreground font-medium' : 'text-ink-4')}>
            {/* h-5: the §4 input/list-lead step — this trigger is the wizard's one
                input-shaped control with a lead glyph, and its neighbour (LocateFixed)
                already sits on the same 20px step. */}
            <MapPin className="h-5 w-5 shrink-0 text-accent-foreground" />
            <span className="truncate">{areaLabel || t('Chọn khu vực', 'Set area')}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-4" />
        </Button>
        {/* Quick "use my current location" */}
        <IconButton
          size="lg"
          onClick={useMyLocation}
          disabled={locating}
          aria-label={t('Dùng vị trí hiện tại', 'Use my current location')}
          title={t('Dùng vị trí hiện tại', 'Use my current location')}
          className="h-[46px] w-[46px] rounded-xl bg-tint text-accent-foreground transition-colors hover:bg-muted active:scale-[0.96] disabled:opacity-60"
        >
          {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
        </IconButton>
      </div>
      {errLocation && <p id="pw-location-error" role="alert" className="mt-1.5 text-xs font-semibold text-destructive">{t('Chọn khu vực', 'Set the area')}</p>}
    </Section>
  )
}

/* Contact — taken from your ACCOUNT (a number belongs to one account, so
   it isn't re-typed per post). Missing name/phone → add it in Settings. */
export function ContactSection({
  meLoaded,
  isGuest,
  postingAs,
  contactName,
  setContactName,
  contactPhone,
  setContactPhone,
  phoneOk,
  errContactName,
  errContactPhone,
  t,
}: {
  meLoaded: boolean
  isGuest: boolean
  postingAs: string | null
  contactName: string
  setContactName: (v: string) => void
  contactPhone: string
  setContactPhone: (v: string) => void
  phoneOk: boolean
  errContactName: boolean
  errContactPhone: boolean
  t: T
}) {
  const [editingPhone, setEditingPhone] = useState(false) // quick-edit the contact number inline
  return (
    <Section id="pw-contact" title={t('Liên hệ', 'Contact')} hint={t('Số của bạn được giữ kín — người mua nhắn tin trong ứng dụng, chỉ hiện số sau khi bạn trả lời.', 'Your number stays private — buyers message you in-app; it’s revealed only after you reply.')}>
      {!meLoaded ? (
        <div className="h-5 w-56 rounded-lg shimmer" />
      ) : isGuest ? (
        // Draft-first guests: contact comes from the account they'll sign in
        // with at Publish — no fields to type here.
        <p className="text-sm text-muted-foreground">
          {t('Tên và số điện thoại lấy từ tài khoản của bạn khi đăng nhập lúc đăng tin.', 'Your name & number come from your account when you sign in at publish.')}
        </p>
      ) : (
        <div className="space-y-3">
          {postingAs && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {/* First-party verification moment ("posting as <registered business>") →
                  the eno seal replaces lucide ShieldCheck (icon-language §0b law). */}
              <EnoSeal className="h-4 w-4 shrink-0 text-accent-foreground" />
              {t('Đăng với tư cách', 'Posting as')} <span className="font-semibold text-foreground">{postingAs}</span>
            </p>
          )}

          {/* Name — inline-editable if it's not set on the account yet. */}
          {contactName.trim().length >= 2 ? (
            <p className="text-sm font-semibold text-foreground">{contactName}</p>
          ) : (
            <Field label={t('Tên của bạn', 'Your name')} error={errContactName ? t('Thêm tên của bạn', 'Add your name') : undefined}>
              <FieldControl
                render={
                  <Input
                    value={contactName}
                    maxLength={80}
                    // Same field as the profile editor's name — it deserves the same autofill
                    // token, so the seller taps their own name instead of retyping it.
                    autoComplete="name"
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder={t('Tên hiển thị cho người mua', 'Name buyers will see')}
                    className={cn('max-w-md', errContactName && 'ring-2 ring-destructive/60')}
                  />
                }
              />
            </Field>
          )}

          {/* Phone — quick-edit inline (no trip to Settings). Shows the saved number
              with a "Change" toggle; an input when it's missing or being edited. */}
          {!editingPhone && phoneOk ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="tabular-nums text-muted-foreground">{contactPhone}</span>
              <Button variant="bare" size="none" type="button" onClick={() => setEditingPhone(true)} className="text-xs font-bold text-accent-foreground hover:underline">
                {t('Đổi số', 'Change number')}
              </Button>
            </div>
          ) : (
            <Field label={t('Số điện thoại', 'Phone number')} hint={t('Người mua không thấy số cho đến khi bạn trả lời.', 'Buyers never see it until you reply.')} error={errContactPhone ? t('Thêm số điện thoại hợp lệ', 'Add a valid phone number') : undefined}>
              <FieldControl
                render={
                  <Input
                    type="tel"
                    inputMode="tel"
                    // This is the seller's OWN number, exactly like profile-editor / business-profile-editor
                    // (both `autoComplete="tel"`). It was the only twin missing the token, so the one place
                    // the number is asked for mid-flow was also the one place autofill didn't offer it.
                    autoComplete="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="+84…"
                    className={cn('max-w-md', errContactPhone && 'ring-2 ring-destructive/60')}
                  />
                }
              />
              {/* Zalo OTP verification is BUILT but hidden until Zalo is live —
                  no dead "coming soon" buttons on the posting path. */}
            </Field>
          )}

          <Link href="/dashboard?tab=account" className="inline-block text-xs font-bold text-accent-foreground hover:underline">
            {t('Chỉnh sửa trong Cài đặt', 'Edit in Settings')}
          </Link>
        </div>
      )}
    </Section>
  )
}

/* Success screen — peak-motivation moment, never a dead end: view it, share it,
   then manage it. A first-ever publish gets its own (calm) celebration copy. */
export function PostSuccess({
  firstListing,
  createdId,
  title,
  price,
  t,
}: {
  firstListing: boolean
  createdId: string | null
  title: string
  price: string
  t: T
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <Mascot name="success" className="h-52 w-52" />
      <h1 className="h-title text-foreground">
        {firstListing ? t('Tin đầu tiên của bạn đã lên sóng! 🎉', 'Your first listing is live! 🎉') : t('Tin của bạn đã được đăng!', 'Your listing is live!')}
      </h1>
      <p className="max-w-md text-sm text-body">
        {t('Tin của bạn đã hiển thị công khai. Người mua sẽ nhắn tin cho bạn ngay trong ứng dụng — số điện thoại của bạn được giữ kín cho đến khi bạn trả lời.', 'It’s now visible to buyers. They’ll message you in-app — your number stays private until you reply.')}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {createdId && (
          <Button asChild variant="cta" size="none">
            <Link href={`/listings/${createdId}`} className="px-6 py-2.5">
              {t('Xem tin của bạn', 'View your listing')}
            </Link>
          </Button>
        )}
        {createdId && (
          <ShareButton
            url={`${typeof window !== 'undefined' ? window.location.origin : 'https://eno.vn'}/listings/${createdId}`}
            title={title.trim()}
            price={Number(price) || undefined}
            currency="₫"
          />
        )}
      </div>
      <Link href="/dashboard" className="text-sm font-semibold text-accent-foreground hover:underline">
        {t('Tới bảng điều khiển', 'Go to dashboard')}
      </Link>
    </div>
  )
}

// Quiet price-guidance box under the price input — where this ask sits vs the market
// band (P25–P75 of comparable listings, same data as the PDP's "Market price" module).
// Amber only when priced ABOVE the band (a nudge, never a blocker); a low ask is the
// seller's call, so it stays neutral. Renders only when a reliable band exists.
function PriceGuidance({ price, band }: { price: number; band: { n: number; p25: number; p75: number } }) {
  const { tr, lang } = useLanguage()
  const loc = moneyLocale(lang)
  // compactPrice matches the PDP MarketPrice module — same data, same voice
  // (and full VND pairs overflow the sentence on 320px screens).
  const range = `${compactPrice(band.p25, loc)} – ${compactPrice(band.p75, loc)}`
  const pos = price < band.p25 ? 'low' : price > band.p75 ? 'high' : 'typical'
  return (
    <div
      className={cn(
        'mt-2 flex max-w-md items-start gap-2 rounded-xl px-3 py-2 text-xs font-medium leading-relaxed',
        pos === 'high' ? 'bg-warning/10 text-warning' : 'bg-tint text-body',
      )}
    >
      {pos === 'typical' && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />}
      <span>
        {pos === 'high'
          ? tr(`Above the typical ${range} range — fairly-priced listings sell faster`, `Cao hơn mặt bằng ${range} — tin có giá hợp lý thường bán nhanh hơn`)
          : pos === 'low'
            ? tr(`Below the typical ${range} range — buyers will see a good deal`, `Thấp hơn mặt bằng ${range} — người mua sẽ thấy đây là mức giá tốt`)
            : tr(`Similar listings go for ${range} — yours is in range`, `Tin tương tự có giá ${range} — giá của bạn hợp lý`)}
      </span>
    </div>
  )
}
