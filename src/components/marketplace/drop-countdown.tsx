'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
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
    <span className="tabular-nums text-2xs font-semibold text-destructive">
      {/* Two whole templates, not a word slotted into one: "day"/"days" is copy, not a value. */}
      {days === 1
        ? fillTemplate(tr('· {days} day left', '· còn {days} ngày'), '· {days} day left', { days: String(days) })
        : fillTemplate(tr('· {days} days left', '· còn {days} ngày'), '· {days} days left', { days: String(days) })}
    </span>
  )
}
