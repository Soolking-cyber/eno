'use client'

import { useLanguage, LANGUAGES } from '@/context/language-context'
import { cn } from '@/lib/utils'

/** Language preference (moved out of the header into the profile). The active
 *  language auto-defaults to the device language on first visit (see
 *  LanguageProvider); this lets the user override it anytime. Flat, on-canvas. */
export function LanguagePref() {
  const { lang, setLang, tr } = useLanguage()
  return (
    <section>
      <h2 className="h-section text-foreground">{tr('Language', 'Ngôn ngữ')}</h2>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">
        {tr('Defaults to your device language — change it anytime.', 'Mặc định theo ngôn ngữ thiết bị — đổi bất cứ lúc nào.')}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            aria-pressed={lang === l.code}
            className={cn(
              'flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
              lang === l.code
                ? 'border-[#0a66c2]/40 bg-accent text-accent-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted',
            )}
          >
            <span className="truncate">{l.native}</span>
            <span className="text-[10px] font-bold text-muted-foreground">{l.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
