'use client'

import { Monitor, Sun, Moon } from 'lucide-react'
import { useLanguage, LANGUAGES } from '@/context/language-context'
import { useTheme } from '@/context/theme-context'
import { CustomSelect } from './custom-select'
import { cn } from '@/lib/utils'

/** Compact one-line preferences: a STYLED language picker (left) + System/Light/Dark
 *  icon segmented control (right). Borderless, dark-mode-safe, portaled menu (no
 *  native OS dropdown). Shared by the desktop account dropdown and the mobile
 *  dashboard so both read the same. */
export function PreferencesInline({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { tr, lang, setLang } = useLanguage()
  const { theme, setTheme } = useTheme()
  // Compact (narrow account dropdown): show the 2-letter code on the trigger so it
  // never truncates to "P…". Full width (dashboard): show the native name.
  const code = LANGUAGES.find((l) => l.code === lang)?.label
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <CustomSelect
        value={lang}
        onChange={(v) => setLang(v as typeof lang)}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.native }))}
        triggerLabel={compact ? code : undefined}
        wrapperClassName={compact ? 'shrink-0' : 'min-w-0 flex-1'}
        className="bg-tint text-body"
        activeClassName="bg-tint text-body hover:bg-accent hover:text-accent-foreground"
      />
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
              'flex h-9 w-9 items-center justify-center rounded-md transition-colors cursor-pointer',
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
