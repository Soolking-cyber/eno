'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Loader2, Plus } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { compressImageFile } from '@/lib/normalize-image'
import { storefrontUrl } from '@/lib/storefront-host'

/**
 * THE STOREFRONT BANNER CONTROL — a shop's one cover image for its own storefront.
 *
 * ⛔ ITS OWN COMPONENT BECAUSE EVERY SELLER HAS A STOREFRONT, NOT ONLY BUSINESS-TIER ONES. It was
 * first written inside `<BusinessProfileEditor>`, which `settings-client` renders only when
 * `dash.tier === 'business'`. Storefronts are gated on holding a HANDLE, not on tier — so an
 * ordinary seller had a live storefront at `<handle>.eno.vn` and no way anywhere in the product to
 * put a banner on it. Splitting it out is what makes the control's reach match the feature's.
 *
 * ⚠️ IT SAVES ON THE SPOT rather than joining a dirty-form Save. There is one field and its value
 * only ever arrives from an upload that has already completed, so there is nothing for a visitor
 * to review before committing — and the version that shared the profile form's Save button had the
 * failure that form already had: starting an upload and saving immediately PATCHed the OLD url.
 */

type Props = {
  /** Current banner, straight from the dashboard payload. */
  bannerUrl: string | null
  /** The shop's handle, used only to show where the banner will appear. */
  handle?: string | null
  onSaved?: () => void
}

/**
 * ⚠️ THE ONE TRUE SIZE, TAKEN FROM `<BannerImage>` RATHER THAN CHOSEN HERE. That component reserves
 * `aspect-[1280/300]` for the wide creative, so anything else a shop uploads is cropped to it. The
 * preview below uses the SAME ratio for the same reason a preview exists at all: showing the raw
 * upload at its own shape would let a shop approve artwork whose subject the storefront then cuts
 * off. If BannerImage's box ever changes, this changes with it.
 */
const BANNER_W = 1280
const BANNER_H = 300

export function StorefrontBannerEditor({ bannerUrl, handle, onSaved }: Props) {
  const { tr } = useLanguage()
  const [url, setUrl] = useState<string | null>(bannerUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /**
   * ⛔ THE PROP ARRIVES LATE, SO LOCAL STATE HAS TO FOLLOW IT. `useDashboard()` resolves after the
   * first paint, so this component mounts with `bannerUrl` undefined and — without this — kept
   * showing "Add a banner" to a shop that already has one. Two reviewers walked the consequence:
   * the shop uploads, believing it is setting its first banner, and silently replaces artwork it
   * was never shown.
   * ⚠️ GUARDED ON `busy` so a refresh landing mid-write cannot stomp the value being saved; the
   * optimistic `setUrl` in `persist` is the newer truth until the payload catches up.
   */
  useEffect(() => {
    if (!busy) setUrl(bannerUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `busy` is a guard, not an input: adding
    // it would re-sync the moment a write finishes and undo the optimistic value it just set.
  }, [bannerUrl])

  const persist = async (next: string | null) => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/seller', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        /**
         * ⚠️ `bannerMobileUrl: null` TRAVELS WITH EVERY WRITE, and it is the feature rather than a
         * tidy-up. The schema carries a separate phone creative that `<BannerImage>` PREFERS on
         * small screens, and partners have one set. One banner is the product decision, so setting
         * this one collapses the pair — otherwise a shop changes its banner, sees it change on
         * desktop, and every phone visitor keeps the old artwork with no control to remove it.
         */
        body: JSON.stringify({ bannerUrl: next, bannerMobileUrl: null }),
      })
      if (!res.ok) throw new Error('save')
      setUrl(next)
      onSaved?.()
    } catch {
      setError(tr('Could not save the banner — please try again.', 'Không lưu được ảnh bìa — vui lòng thử lại.'))
    } finally { setBusy(false) }
  }

  const upload = async (file: File) => {
    setBusy(true); setError('')
    try {
      const compressed = await compressImageFile(file) // HEIC→JPEG + downscale so big art doesn't 413
      const form = new FormData()
      form.append('files', compressed)
      // 'avatar' means NOT WATERMARKED — a shop's cover is its own artwork, like its logo. The eno
      // mark belongs on listing photos, which get scraped and re-shared.
      form.append('kind', 'avatar')
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const d = await res.json()
      if (!d.urls?.[0]) throw new Error('upload')
      await persist(d.urls[0])
    } catch {
      setError(tr('Banner upload failed.', 'Tải ảnh bìa thất bại.'))
      setBusy(false)
    }
  }

  const shopUrl = handle ? storefrontUrl(handle, process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn') : null

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {tr(
          `Shown across the top of your storefront. Upload a wide image — ${BANNER_W} × ${BANNER_H} works best.`,
          `Hiển thị ở đầu trang cửa hàng của bạn. Hãy dùng ảnh ngang — ${BANNER_W} × ${BANNER_H} là đẹp nhất.`,
        )}
      </p>
      {shopUrl && (
        <p className="mt-1 text-xs text-muted-foreground">
          {tr('Your storefront:', 'Cửa hàng của bạn:')}{' '}
          <a href={shopUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent-foreground underline underline-offset-2">
            {shopUrl.replace(/^https?:\/\//, '')}
          </a>
        </p>
      )}

      <label
        className="group relative mt-3 block cursor-pointer overflow-hidden rounded-2xl border border-line-strong bg-tint"
        title={tr('Change banner', 'Đổi ảnh bìa')}
      >
        {/* The reserved box is the storefront's own ratio — see BANNER_W/H above. */}
        <span className="block w-full" style={{ aspectRatio: `${BANNER_W} / ${BANNER_H}` }}>
          {url ? (
            <Image src={url} alt="" width={BANNER_W} height={BANNER_H} className="h-full w-full object-cover" unoptimized />
          ) : (
            <span className="flex h-full w-full items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5 shrink-0" />}
              {tr('Add a banner', 'Thêm ảnh bìa')}
            </span>
          )}
        </span>
        {url && (
          <span className="absolute right-2 top-2 flex h-8 items-center gap-1.5 rounded-full bg-black/55 px-3 text-xs font-semibold text-white">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : tr('Change', 'Đổi')}
          </span>
        )}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,.heic,.heif"
          className="hidden"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
        />
      </label>

      {url && (
        <Button
          type="button"
          variant="ghost"
          size="none"
          disabled={busy}
          onClick={() => persist(null)}
          className="press mt-2 cursor-pointer text-sm font-semibold text-body hover:text-accent-foreground"
        >
          {tr('Remove banner', 'Xoá ảnh bìa')}
        </Button>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
