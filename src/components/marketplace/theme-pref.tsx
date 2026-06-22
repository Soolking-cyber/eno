'use client'

import { Monitor, Sun, Moon } from 'lucide-react'
import { useTheme, type Theme } from '@/context/theme-context'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/** Appearance preference (sits beside the Language picker in the account menu).
 *  System follows the device; Light/Dark force a scheme. Persisted by
 *  ThemeProvider. Written with semantic tokens so it's correct in both themes. */
export function ThemePref() {
  const { theme, setTheme } = useTheme()
  const { tr } = useLanguage()

  const opts: { value: Theme; Icon: typeof Sun; label: string }[] = [
    { value: 'system', Icon: Monitor, label: tr('System', 'Hệ thống') },
    { value: 'light', Icon: Sun, label: tr('Light', 'Sáng') },
    { value: 'dark', Icon: Moon, label: tr('Dark', 'Tối') },
  ]

  return (
    <section>
      <h2 className="h-section text-foreground">{tr('Appearance', 'Giao diện')}</h2>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">
        {tr('Choose a theme — System follows your device.', 'Chọn giao diện — Hệ thống theo thiết bị của bạn.')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {opts.map(({ value, Icon, label }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className={cn(
              'flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
              theme === value
                ? 'border-primary/40 bg-accent text-accent-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
    </section>
  )
}
