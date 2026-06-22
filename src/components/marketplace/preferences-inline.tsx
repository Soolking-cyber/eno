'use client'

import { Monitor, Sun, Moon } from 'lucide-react'
import { useLanguage, LANGUAGES } from '@/context/language-context'
import { useTheme } from '@/context/theme-context'
import { cn } from '@/lib/utils'

/** Compact one-line preferences: language picker (left) + System/Light/Dark icon
 *  segmented control (right). Borderless. Shared by the desktop account dropdown
 *  and the mobile dashboard so both read the same. */
export function PreferencesInline({ className }: { className?: string }) {
  const { tr, lang, setLang } = useLanguage()
  const { theme, setTheme } = useTheme()
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as typeof lang)}
        aria-label={tr('Language', 'Ngôn ngữ')}
        className="min-w-0 flex-1 cursor-pointer rounded-lg bg-tint py-2 pl-2.5 pr-1 text-sm font-medium text-body outline-none transition-colors hover:bg-muted focus:ring-2 focus:ring-ring/30"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.native}</option>
        ))}
      </select>
      <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-tint p-0.5">
        {([['system', Monitor, tr('System', 'Hệ thống')], ['light', Sun, tr('Light', 'Sáng')], ['dark', Moon, tr('Dark', 'Tối')]] as const).map(([val, Icon, label]) => (
          <button
            key={val}
            role="radio"
            aria-checked={theme === val}
            title={label}
            aria-label={label}
            onClick={() => setTheme(val)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-pointer',
              theme === val ? 'bg-card text-accent-foreground shadow-sm' : 'text-ink-4 hover:text-body',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    </div>
  )
}
