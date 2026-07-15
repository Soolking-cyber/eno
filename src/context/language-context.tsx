'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Language = 'en' | 'vi'
type LanguageContextValue = {
  lang: Language
  setLang: (language: Language) => void
  tr: (english: string, vietnamese: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>('en')

  useEffect(() => {
    const stored = localStorage.getItem('eno-forum-language')
    if (stored === 'en' || stored === 'vi') {
      setLangState(stored)
      return
    }
    if (navigator.language.toLowerCase().startsWith('vi')) setLangState('vi')
  }, [])

  const setLang = (language: Language) => {
    setLangState(language)
    try { localStorage.setItem('eno-forum-language', language) } catch { /* storage unavailable */ }
  }

  const value = useMemo<LanguageContextValue>(() => ({
    lang,
    setLang,
    tr: (english, vietnamese) => lang === 'vi' ? vietnamese : english,
  }), [lang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}

export function Tr({ text, vi }: { text: string; vi?: string }) {
  const { tr } = useLanguage()
  return <>{tr(text, vi || text)}</>
}
