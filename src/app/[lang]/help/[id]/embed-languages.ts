import { LANGS } from '@/lib/i18n/langs'
import { acceptLanguageOrder, matchSupportedLanguage } from '@/lib/lang-variant'

/**
 * WHICH CACHED TRANSLATIONS A HELP THREAD EMBEDS — the languages this response's reader can be shown.
 *
 * cachedTranslations() returns every language the Translation cache holds for a string, and that set
 * GROWS ON DEMAND: each machine-translated reader who opens a thread adds their language's rows
 * (measured 2026-09-29: an English community post already carried a Russian title and body, shipped to
 * every English and Vietnamese reader in the RSC payload). useLocalized only ever reads `en` (a
 * Vietnamese-authored post under the English UI), `vi`, and the reader's own language, so those are
 * all the page embeds. The page is force-dynamic, so reading the request costs no cache split.
 *
 * The reader's language is the one the client will settle on: the `lang` cookie it writes on every
 * detection and choice, else the first SUPPORTED Accept-Language tag — the same inputs, in the same
 * order, as langVariantFor() in lang-variant.ts, but keeping the machine-translated language that the
 * variant rule folds into English. A reader it misses (a stored choice the cookie lost) falls back to
 * useLocalized's client path, which is what every reader got before the embed existed.
 */
export function readerLanguage(cookie: string | null | undefined, acceptLanguage: string | null | undefined): string | null {
  if (cookie && (LANGS as string[]).includes(cookie)) return cookie
  for (const tag of acceptLanguageOrder(acceptLanguage)) {
    const hit = matchSupportedLanguage(tag)
    if (hit) return hit
  }
  return null
}

/** The languages to keep: always `en` and `vi`, plus the reader's when it is another one. */
export function embedLanguages(reader: string | null): ReadonlySet<string> {
  return new Set(reader ? ['en', 'vi', reader] : ['en', 'vi'])
}

/** One string's cached translations narrowed to `keep` — null when nothing survives, as the client expects. */
export function pickEmbedded(map: Record<string, string> | undefined, keep: ReadonlySet<string>): Record<string, string> | null {
  if (!map) return null
  const out: Record<string, string> = {}
  for (const [lang, value] of Object.entries(map)) if (keep.has(lang)) out[lang] = value
  return Object.keys(out).length ? out : null
}
