'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { runVisualSearch } from '@/lib/visual-search'
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
  iconClassName = 'h-[18px] w-[18px]',
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
    onStart?.()
    setBusy(true)
    try {
      const r = await runVisualSearch(file)
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
      <button
        type="button"
        aria-label={tr('Search by photo', 'Tìm bằng ảnh')}
        title={tr('Search by photo', 'Tìm bằng ảnh')}
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={className}
      >
        {busy ? <Loader2 className={cn(iconClassName, 'animate-spin')} /> : <Camera className={iconClassName} />}
      </button>
    </>
  )
}
