'use client'

import { useLanguage, useTr } from '@/context/language-context'
import { detectContentLang } from '@/lib/detect-lang'
import { linkifyLegal } from './legal-linkify'

/**
 * `<Tr>` for a legal paragraph: translated exactly as `<Tr text={p}>` would be, then its document
 * paths and email addresses turned into links (legal-linkify.tsx). Same `lang` span as `<Tr>` when the
 * text is not in the page's language, so a screen reader still switches voice.
 */
export function LinkifiedTr({ text }: { text: string }) {
  const { lang } = useLanguage()
  const out = useTr(text)
  const cl = detectContentLang(out)
  const nodes = linkifyLegal(out)
  return cl && cl !== lang ? <span lang={cl}>{nodes}</span> : <>{nodes}</>
}
