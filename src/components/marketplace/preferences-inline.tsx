'use client'

import { Sun, Moon } from 'lucide-react'
import { useLanguage, LANGUAGES } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { useTheme } from '@/context/theme-context'
import { CURRENCIES } from '@/lib/currencies'
import { CustomSelect } from './custom-select'
import { cn } from '@/lib/utils'

/** Compact preferences row: STYLED language picker + DISPLAY-currency picker
 *  (independent of language — e.g. English UI with VND prices, or vice-versa) +
 *  a light/dark toggle. Borderless, dark-mode-safe, portaled menus. Shared by the
 *  desktop account dropdown and the mobile dashboard so both read the same. */
export function PreferencesInline({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { tr, lang, setLang } = useLanguage()
  const { currency, setCurrency } = useCurrency()
  const { resolved, setTheme } = useTheme()
  const code = LANGUAGES.find((l) => l.code === lang)?.label
  const isDark = resolved === 'dark'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <CustomSelect
        value={lang}
        onChange={(v) => setLang(v as typeof lang)}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.native }))}
        triggerLabel={compact ? code : undefined}
        wrapperClassName={compact ? 'shrink-0' : 'min-w-0 flex-1'}
        className="text-body hover:bg-muted"
        activeClassName="text-body hover:bg-muted"
      />
      <CustomSelect
        value={currency}
        onChange={setCurrency}
        options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.flag} ${c.label}` }))}
        wrapperClassName={compact ? 'shrink-0' : 'min-w-0 flex-1'}
        className="text-body hover:bg-muted"
        activeClassName="text-body hover:bg-muted"
      />
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label={tr('Dark mode', 'Chế độ tối')}
        title={isDark ? tr('Dark', 'Tối') : tr('Light', 'Sáng')}
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className="relative flex h-9 w-[3.75rem] shrink-0 items-center rounded-full bg-muted px-1 transition-colors cursor-pointer"
      >
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full bg-card shadow-sm transition-transform duration-200 ease-out',
            isDark ? 'translate-x-6 text-accent-foreground' : 'translate-x-0 text-amber-500',
          )}
        >
          {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </span>
      </button>
    </div>
  )
}
