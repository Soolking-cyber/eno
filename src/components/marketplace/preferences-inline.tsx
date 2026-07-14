'use client'

import { Sun, Moon } from 'lucide-react'
import { useLanguage, LANGUAGES } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { useTheme } from '@/context/theme-context'
import { CURRENCIES } from '@/lib/currencies'
import { Switch } from '@/components/ui/switch'
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
  const curSymbol = CURRENCIES.find((c) => c.code === currency)?.symbol
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
        options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol}  ${c.label}` }))}
        triggerLabel={compact ? curSymbol : undefined}
        wrapperClassName={compact ? 'shrink-0' : 'min-w-0 flex-1'}
        className="text-body hover:bg-muted"
        activeClassName="text-body hover:bg-muted"
      />
      {/* Real switch semantics (Space/Enter, aria-checked from the primitive, focus ring) with the
          SAME box as before: a 60×36 track that stays bg-muted in BOTH states — hence the explicit
          `data-checked:bg-muted`, which tailwind-merges away the primitive's `data-checked:bg-primary`
          (a bare `bg-muted` would not: different variant, different merge group, so the primary would
          still win when checked). The thumb travels via `left` (4px → 28px), matching the primitive's
          left-not-translate rule; 28px is exactly where `translate-x-6` used to land it. */}
      <Switch
        checked={isDark}
        onChange={(next) => setTheme(next ? 'dark' : 'light')}
        label={tr('Dark mode', 'Chế độ tối')}
        title={isDark ? tr('Dark', 'Tối') : tr('Light', 'Sáng')}
        className="relative h-9 w-[3.75rem] bg-muted data-checked:bg-muted tap-44"
        thumbClassName={cn(
          'h-7 w-7 top-1 left-1 data-checked:left-7 bg-card shadow-sm duration-200 ease-out',
          isDark ? 'text-accent-foreground' : 'text-warning',
        )}
      >
        {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </Switch>
    </div>
  )
}
