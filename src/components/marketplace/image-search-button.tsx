'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2 } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { runVisualSearch, isUnauthorized, isAiDeclined } from '@/lib/visual-search'
import { aiConsentNeeded, askAiConsent } from '@/lib/ai-consent'
import { IconButton } from '@/components/ui/icon-button'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Camera button for a search bar — take / upload a photo, recognize the main
 *  subject (Gemini Vision), and hand the resulting query back to the bar so it can
 *  run a normal search. `accept="image/*"` (no `capture`) lets the OS picker offer
 *  camera OR library on mobile. Paste is handled by the bars via imageFromPaste(). */
export function ImageSearchButton({
  onResult,
  onError,
  onStart,
  className,
  // 20px — the composer/input action step of the size ladder (icon-language §4).
  iconClassName = 'h-5 w-5',
}: {
  onResult: (r: { query: string; category: string | null; brand: string | null }) => void
  onError?: (msg: string) => void
  onStart?: () => void
  className?: string
  iconClassName?: string
}) {
  const { tr } = useLanguage()
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handle = async (file?: File | null) => {
    if (!file || busy) return
    setBusy(true)
    // ⚠️ App Store gate `app-ai-notice` (src/lib/ai-consent.ts): in the apps, ask before the caller's onStart — the photo
    // has been picked, nothing has been sent. "Not now" ⇒ nothing is sent, nothing else happens (the notice said what).
    // Busy is set FIRST so a second pick cannot start a second wait (codex, review). Gate off ⇒ no await; the only
    // difference is that busy is set a line before onStart instead of a line after.
    if (aiConsentNeeded('photo_search') && !(await askAiConsent('photo_search'))) { setBusy(false); return }
    onStart?.()
    try {
      const r = await runVisualSearch(file)
      // ⚠️ 401 IS SILENT HERE TOO. runVisualSearch has already asked the AuthProvider to open the
      // sign-in modal; adding "try a clearer photo" on top of it blames the photograph for being
      // signed out. This branch existed because a 401 used to arrive as a bare `null`.
      // A declined Google AI question is silent for the same reason: the notice has already spoken.
      if (isUnauthorized(r) || isAiDeclined(r)) return
      if (r && r.query) onResult({ query: r.query, category: r.category, brand: r.brand })
      else onError?.(tr("Couldn't recognize the item — try a clearer photo.", 'Không nhận ra món đồ — thử ảnh rõ hơn.'))
    } catch {
      onError?.(tr('Visual search failed — try again.', 'Tìm bằng ảnh thất bại — thử lại.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { handle(e.target.files?.[0]); if (ref.current) ref.current.value = '' }}
      />
      <Tooltip content={tr('Search by photo', 'Tìm bằng ảnh')} side="bottom">
        <IconButton
          size="lg"
          aria-label={tr('Search by photo', 'Tìm bằng ảnh')}
          onClick={() => ref.current?.click()}
          disabled={busy}
          className={className}
        >
          {busy ? <Loader2 className={cn(iconClassName, 'animate-spin')} /> : <Camera className={iconClassName} />}
        </IconButton>
      </Tooltip>
    </>
  )
}
