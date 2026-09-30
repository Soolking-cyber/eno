'use client'

import { LANGUAGES, useLanguage } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { CURRENCIES } from '@/lib/currencies'
import { CustomSelect } from './custom-select'

/**
 * Language + display currency, in the footer, for EVERYONE — a guest included.
 *
 * ⚠️ WHY THIS EXISTS: the only language/currency control was PreferencesInline, and it renders only
 * inside the signed-in account panel and the dashboard. A guest — most visitors, and exactly the
 * foreigner or Vietnamese reader who landed in the wrong language — could change neither; they got
 * whatever Accept-Language or an old cookie decided. The footer is on every page of both editions,
 * which is where people look for this ("Language · Currency" is the footer convention on Airbnb and
 * Booking), and it changes no owner-set chrome.
 *
 * ⛔ NOT PreferencesInline, ON PURPOSE. That component carries the theme Switch, whose Sun/Moon glyphs
 * are NOT in scripts/critical-icons.mjs CRITICAL_GLYPHS — and the footer renders on every route, so
 * drawing them here would bind the ~188 KB deferred sprite (glyphs-rest.svg) to every page load
 * (src/lib/critical-glyphs.guard.test.ts). For the same reason there is no Globe icon: CustomSelect's
 * own trigger glyph (ChevronsUpDown) is core, so these two cost no sprite request.
 *
 * Hydration-safe as rendered on the server: language starts at the [lang] route's variant and currency
 * at 'VND' on both the server and the first client render (currency-context.tsx), and the stored
 * currency lands in an effect. Choosing a language across the en/vi variant reloads the page
 * (language-context.tsx `setLang`), because server-rendered text is in the old variant.
 */
/**
 * The trigger's size, by device. A thumb gets a 44px trigger (`min-h-11`, the house tap floor —
 * CustomSelect's default 48px buys nothing here and costs the phone footer height). A mouse
 * (`pc`) gets a compact text-xs control that sits IN the bottom bar's text line instead of doubling
 * the row's height — the Airbnb/Booking footer convention ("English · ₫ VND" as quiet text buttons).
 * `pc:rounded-lg` because a ~24px control is the canon's compact tier (docs/design-language.md §2).
 * The same string is passed as `activeClassName`, so a non-default value (a guest who chose Tiếng Việt)
 * stays neutral rather than painting the accent fill a facet filter uses to say "narrowed".
 */
const TRIGGER = 'min-h-11 text-body hover:bg-muted pc:min-h-0 pc:rounded-lg pc:px-2 pc:py-1 pc:text-xs'

/**
 * The two pickers, exported one by one so the phone's guest Account sheet (guest-account-sheet.tsx,
 * O-09) shows the SAME controls the footer does — one place decides what a language or currency
 * option is called and what choosing it does. `className` is the trigger's box; the footer passes
 * TRIGGER, the sheet its own full-width row.
 */
export function LanguageSelect({ className = TRIGGER, wrapperClassName = 'shrink-0' }: { className?: string; wrapperClassName?: string }) {
  const { tr, lang, setLang } = useLanguage()
  return (
    <CustomSelect
      value={lang}
      onChange={(v) => setLang(v as typeof lang)}
      options={LANGUAGES.map((l) => ({ value: l.code, label: l.native }))}
      label={tr('Language', 'Ngôn ngữ')}
      wrapperClassName={wrapperClassName}
      className={className}
      activeClassName={className}
    />
  )
}

export function CurrencySelect({ className = TRIGGER, wrapperClassName = 'shrink-0' }: { className?: string; wrapperClassName?: string }) {
  const { tr } = useLanguage()
  const { currency, setCurrency } = useCurrency()
  return (
    <CustomSelect
      value={currency}
      onChange={setCurrency}
      options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.symbol}  ${c.label}` }))}
      label={tr('Display currency', 'Tiền tệ hiển thị')}
      wrapperClassName={wrapperClassName}
      className={className}
      activeClassName={className}
    />
  )
}

export function FooterPreferences() {
  const { tr } = useLanguage()
  return (
    <div
      role="group"
      aria-label={tr('Language and currency', 'Ngôn ngữ và tiền tệ')}
      className="flex flex-wrap items-center justify-center gap-2 lg:justify-end"
    >
      <LanguageSelect />
      <CurrencySelect />
    </div>
  )
}
