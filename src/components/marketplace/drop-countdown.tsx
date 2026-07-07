'use client'

import { useLanguage } from '@/context/language-context'

/**
 * Tiny "· còn N ngày" / "· N days left" suffix for the price-drop pill on the
 * PDP. Computed CLIENT-side from the serialized dropExpiresAt so the day count
 * stays live even though the page HTML is ISR-cached (mirrors PostedAgo, which
 * also derives its label from useLanguage at render time). Renders null once the
 * badge window lapses or when there is no active drop.
 */
export function DropCountdown({ expiresAt }: { expiresAt: string | null }) {
  const { tr } = useLanguage()
  if (!expiresAt) return null
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
  if (days <= 0) return null
  return (
    <span className="tabular-nums text-[11px] font-semibold text-red-600">
      {tr(`· ${days} ${days === 1 ? 'day' : 'days'} left`, `· còn ${days} ngày`)}
    </span>
  )
}
