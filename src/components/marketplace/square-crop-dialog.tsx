'use client'

import { useCallback, useEffect, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { EnoSlider } from '@/components/ui/slider'
import { useLanguage } from '@/context/language-context'
import { cropToSquare } from '@/lib/square-crop'

// The reframe step for a photo the wizard already squared by default (owner: "square by default,
// keep-full option"). The seller pans/pinch-zooms to choose WHICH 1:1 region to keep, or bails out
// to "keep full photo" (the un-cropped original, shown blur-filled like today). react-easy-crop
// owns the mobile gesture surface (both reviewers: don't hand-roll pinch/pan in a WebView); we own
// the pixels — cropToSquare re-crops the downscaled `original`, so this is non-lossy and bounded.
export function SquareCropDialog({ file, onApply, onKeepFull, onCancel }: {
  /** The photo's downscaled, uncropped source (usePostMedia keeps it as `original`). Null = closed. */
  file: File | null
  /** The seller framed a square → the cropped 1:1 File to store in its place. */
  onApply: (square: File) => void
  /** The seller chose to keep the full non-square photo — leave it uncropped. */
  onKeepFull: () => void
  onCancel: () => void
}) {
  const { tr } = useLanguage()
  const [url, setUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!file) { setUrl(null); return }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    setCrop({ x: 0, y: 0 }); setZoom(1); setArea(null)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), [])

  const apply = async () => {
    if (!file || !area) return
    setBusy(true)
    try {
      onApply(await cropToSquare(file, area))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!file} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Fit to square', 'Cắt thành hình vuông')}</DialogTitle>
          <DialogDescription>{tr('Drag and zoom to choose the part shown on your listing.', 'Kéo và thu phóng để chọn phần hiển thị trên tin đăng.')}</DialogDescription>
        </DialogHeader>
        {/* Fixed 1:1 stage — react-easy-crop fills it and reports the crop in source pixels. */}
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
          {url && (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              showGrid={false}
              restrictPosition
              objectFit="cover"
            />
          )}
        </div>
        <div className="flex items-center gap-3 px-1">
          <span className="shrink-0 text-xs text-ink-4">{tr('Zoom', 'Thu phóng')}</span>
          <EnoSlider value={zoom} min={1} max={3} step={0.01} onChange={setZoom} aria-label={tr('Zoom', 'Thu phóng')} className="flex-1" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onKeepFull}>{tr('Keep full photo', 'Giữ ảnh đầy đủ')}</Button>
          <Button type="button" variant="cta" className="h-11" disabled={busy || !area} onClick={() => void apply()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{tr('Use square', 'Dùng ảnh vuông')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
