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
        label={tr('Language', 'Ngôn ngữ')}
        triggerLabel={compact ? code : undefined}
        wrapperClassName={compact ? 'shrink-0' : 'min-w-0 flex-1'}
        className="text-body hover:bg-muted"
        activeClassName="text-body hover:bg-muted"
      />
      <CustomSelect
        value={currency}
        onChange={setCurrency}
        options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol}  ${c.label}` }))}
        label={tr('Display currency', 'Tiền tệ hiển thị')}
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
          // NO bg override: ui/switch's own `bg-white` thumb is what makes this legible. The
          // `bg-card` that used to be here was the bug — against the bg-muted track it measured
          // 1.14:1 in dark (#1b1b1b thumb on #262626 track) and 1.04:1 in light, so the knob
          // dissolved into the track and only its glyph marked the position.
          //
          // White fixes dark outright (15.1:1 on #262626). It does NOT fix light: the track is
          // #f5f5f5, so a white fill is 1.09:1 there no matter what, and a shadow is not a
          // contrast boundary. The ring is therefore load-bearing in light mode and has to be
          // dark enough to clear the 3:1 floor for a non-text UI part on its own — ink-3
          // (#737373) is 4.35:1 against the track and 4.74:1 against the knob. In dark it is
          // #b8b8b8 and merely decorative, because the fill already carries the boundary.
          'h-7 w-7 top-1 left-1 data-checked:left-7 shadow-sm ring-1 ring-ink-3 duration-200 ease-out',
          // SURFACE INK, both faces (lead ruling R2, 2026-08-07; icon-language §0/§6). The
          // R1 thumb wore text-warning amber for the sun and brand blue for the moon — a
          // second hue inside shell chrome (neither a rating star nor an allowlisted
          // third-party mark), and the pair wasn't even self-consistent across themes. The
          // ruling: theme is not a brand or status moment — both glyphs render the ink of
          // the surface they sit on. That surface is the ALWAYS-WHITE thumb (ui/switch's
          // bg-white, load-bearing for the knob's own contrast, see above), so its ink is
          // dark in BOTH themes: ink-2 in light (#262626, ~13.5:1 on white); in dark the
          // ink-* tokens invert to light values, so the dark-on-white value comes from the
          // token that still holds it — the canvas (--background #1b1b1b, ~16:1 on white).
          // Both clear the 3:1 non-text floor with room (accent-foreground's 2.22:1 was the
          // original bug; primary's 5.69:1 was compliant but made theme a brand moment).
          // Sun-vs-Moon shape alone says which mode you are in — no hue needed.
          'text-ink-2 dark:text-background',
        )}
      >
        {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </Switch>
    </div>
  )
}
