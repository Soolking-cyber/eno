import { LANGS, type Language } from '@/lib/i18n/langs'

/**
 * WHICH SERVER-RENDERED LANGUAGE A REQUEST GETS — the one decision behind Vietnamese-first HTML.
 *
 * Owner, 2026-09-17: "it should read browser language first then render html — vietnamese should see
 * fast load too just as english speakers". Until then every HTML response was English and Vietnamese
 * arrived only after hydration (measured: 4–6 s on a throttled phone, and a layout shift as it
 * swapped). src/proxy.ts calls this for every page request and rewrites into the hidden `[lang]`
 * segment, so the public URL never changes while the ISR cache holds one copy per variant.
 *
 * ⚠️ TWO VARIANTS, ELEVEN LANGUAGES. Only English and Vietnamese are hand-authored, so only they are
 * rendered on the server. The nine machine-translated languages get the ENGLISH variant and the client
 * swaps them exactly as before — rendering them server-side would need the MT cache at render time.
 *
 * ⛔ IT MUST AGREE WITH THE CLIENT, OR THE PAGE SWAPS ANYWAY. language-context.tsx decides the same way:
 * an explicit choice (the `lang` cookie it writes on every change) wins, otherwise the FIRST supported
 * language in the browser's preference order, otherwise English. "First supported" is the rule, not
 * "first Vietnamese": `zh-CN, vi;q=0.5` is a Chinese visitor who reads Vietnamese second, and the
 * client shows them Chinese — so the server must pick English (the zh fallback), not Vietnamese.
 */
export type LangVariant = 'en' | 'vi'
export const LANG_VARIANTS: readonly LangVariant[] = ['en', 'vi']
export const LANG_COOKIE = 'lang'

/** Map a BCP-47 tag to a supported language — same rules as the client's matchLanguage(). */
export function matchSupportedLanguage(raw: string): Language | null {
  const lc = raw.trim().toLowerCase()
  if (!lc) return null
  if (lc.startsWith('zh')) return 'zh-Hans'
  // `zh` returned above, so a primary tag here is never a Chinese variant.
  const primary = lc.split('-')[0]
  return (LANGS as string[]).includes(primary) ? (primary as Language) : null
}

/**
 * Accept-Language in preference order: q-value descending, header order breaking ties (a stable sort),
 * `q=0` dropped because it means "not acceptable".
 */
export function acceptLanguageOrder(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const qv = q ? Number(q.slice(2)) : 1
      return { tag: tag.trim(), q: Number.isFinite(qv) ? qv : 0, i }
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag)
}

export function langVariantFor(cookie: string | null | undefined, acceptLanguage: string | null | undefined): LangVariant {
  // An explicit or previously-detected choice. Any SUPPORTED code counts — a `ko` cookie is a Korean
  // reader, served English and swapped client-side — but garbage falls through to the header rather
  // than silently pinning English.
  if (cookie && (LANGS as string[]).includes(cookie)) return cookie === 'vi' ? 'vi' : 'en'
  for (const tag of acceptLanguageOrder(acceptLanguage)) {
    const hit = matchSupportedLanguage(tag)
    if (hit) return hit === 'vi' ? 'vi' : 'en'
  }
  return 'en'
}

/** The server variant a client-side language maps to — used to decide whether a switch needs a reload. */
export function variantOfLanguage(lang: Language): LangVariant {
  return lang === 'vi' ? 'vi' : 'en'
}
