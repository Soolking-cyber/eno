import 'server-only'
import { cookies } from 'next/headers'
import { translateBatch, LANGS, type Lang } from './translate'

// Read the active language from the `lang` cookie (set client-side by the
// language provider). Safe to call ONLY in dynamic routes / route handlers —
// calling cookies() in an ISR/static page opts it into dynamic rendering.
export async function getServerLang(): Promise<Lang> {
  const store = await cookies()
  const v = store.get('lang')?.value
  return v && (LANGS as string[]).includes(v) ? (v as Lang) : 'en'
}

/**
 * Resolve a set of English source strings into the target language as a
 * { [englishSource]: translation } map, reading the warm Postgres cache (no
 * Azure call on a hit). Returns an empty map for English (identity). Use to
 * render server components in-language so the first paint needs no client swap.
 */
export async function getDict(lang: Lang, texts: string[]): Promise<Record<string, string>> {
  if (lang === 'en') return {}
  const uniq = Array.from(new Set(texts.filter((t) => t && t.trim())))
  if (uniq.length === 0) return {}
  const out = await translateBatch(uniq, lang)
  const dict: Record<string, string> = {}
  uniq.forEach((t, i) => { if (out[i]) dict[t] = out[i] })
  return dict
}
