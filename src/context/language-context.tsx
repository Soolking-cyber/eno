'use client'

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  LANGUAGES,
  isLanguage,
  matchDeviceLanguage,
  type Language,
} from '@/lib/languages'
import { detectContentLanguage } from '@/lib/detect-content-language'

export { LANGUAGES, type Language } from '@/lib/languages'

type LanguageContextValue = {
  lang: Language
  setLang: (language: Language) => void
  tr: (english: string, vietnamese?: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)
const translationCache = new Map<string, string>()
const translationInflight = new Set<string>()
const pending: Partial<Record<Language, Array<{ text: string; resolve: (value: string) => void }>>> = {}
const listeners = new Set<() => void>()
let version = 0
let scheduled = false

function cacheKey(language: Language, text: string) {
  return `${language}\u0000${text}`
}

function emitTranslationChange() {
  version += 1
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot() {
  return version
}

function flushTranslations() {
  scheduled = false
  for (const language of Object.keys(pending) as Language[]) {
    const items = pending[language]
    if (!items?.length) continue
    delete pending[language]
    const uniqueTexts = Array.from(new Set(items.map(({ text }) => text)))
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: uniqueTexts, target: language }),
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((body: { translations?: string[] }) => {
        const translatedBySource = new Map<string, string>()
        uniqueTexts.forEach((source, index) => {
          const translated = body.translations?.[index] || source
          translatedBySource.set(source, translated)
          if (translated !== source) translationCache.set(cacheKey(language, source), translated)
        })
        items.forEach((item) => item.resolve(translatedBySource.get(item.text) || item.text))
        emitTranslationChange()
      })
      .catch(() => items.forEach((item) => item.resolve(item.text)))
      .finally(() => items.forEach((item) => translationInflight.delete(cacheKey(language, item.text))))
  }
}

export function requestTranslation(text: string, language: Language): Promise<string> {
  if (!text) return Promise.resolve(text)
  const key = cacheKey(language, text)
  const cached = translationCache.get(key)
  if (cached != null) return Promise.resolve(cached)
  translationInflight.add(key)
  return new Promise((resolve) => {
    ;(pending[language] ||= []).push({ text, resolve })
    if (!scheduled) {
      scheduled = true
      window.setTimeout(flushTranslations, 50)
    }
  })
}

export async function requestTranslations(texts: string[], language: Language): Promise<Record<string, string>> {
  const unique = Array.from(new Set(texts.filter(Boolean)))
  if (language === 'en' || unique.length === 0) return Object.fromEntries(unique.map((text) => [text, text]))
  const missing = unique.filter((text) => !translationCache.has(cacheKey(language, text)))
  if (missing.length) {
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: missing, target: language }),
      })
      if (response.ok) {
        const body = await response.json() as { translations?: string[] }
        missing.forEach((source, index) => {
          const translated = body.translations?.[index] || source
          if (translated !== source) translationCache.set(cacheKey(language, source), translated)
        })
        emitTranslationChange()
      }
    } catch {
      // Source-language copy remains usable when translation is temporarily unavailable.
    }
  }
  return Object.fromEntries(unique.map((text) => [text, translationCache.get(cacheKey(language, text)) || text]))
}

function writeLanguageCookie(language: Language) {
  document.cookie = `lang=${language};path=/;max-age=31536000;samesite=lax`
}

function detectDeviceLanguage(): Language {
  const preferences = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const preference of preferences) {
    const matched = matchDeviceLanguage(preference)
    if (matched) return matched
  }
  return 'en'
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>('en')

  useEffect(() => {
    const stored = localStorage.getItem('eno-forum-language') || localStorage.getItem('lang')
    const language = isLanguage(stored) ? stored : detectDeviceLanguage()
    setLangState(language)
    writeLanguageCookie(language)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = (language: Language) => {
    setLangState(language)
    try {
      localStorage.setItem('eno-forum-language', language)
      localStorage.setItem('lang', language)
    } catch {
      // The in-memory selection still works when storage is unavailable.
    }
    writeLanguageCookie(language)
  }

  const value = useMemo<LanguageContextValue>(() => ({
    lang,
    setLang,
    tr: (english, vietnamese) => {
      if (!english) return english
      if (lang === 'en') return english
      if (lang === 'vi' && vietnamese != null) return vietnamese
      const key = cacheKey(lang, english)
      const translated = translationCache.get(key)
      if (translated != null) return translated
      if (!translationInflight.has(key)) void requestTranslation(english, lang)
      return english
    },
  }), [lang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  useSyncExternalStore(subscribe, getSnapshot, () => 0)
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}

export function useTr(text: string | null | undefined): string {
  const { lang } = useLanguage()
  const source = text || ''
  const key = cacheKey(lang, source)
  const [translated, setTranslated] = useState(() => translationCache.get(key) || source)

  useEffect(() => {
    const sourceLanguage = detectContentLanguage(source)
    if (!source || (lang === 'en' && !sourceLanguage)) {
      setTranslated(source)
      return
    }
    const cached = translationCache.get(cacheKey(lang, source))
    if (cached) {
      setTranslated(cached)
      return
    }
    let cancelled = false
    requestTranslation(source, lang).then((value) => { if (!cancelled) setTranslated(value) })
    return () => { cancelled = true }
  }, [lang, source])

  return translated
}

export function Tr({ text, vi }: { text?: string | null; vi?: string }) {
  const { tr } = useLanguage()
  return <>{tr(text || '', vi)}</>
}

export function LanguageOptions() {
  return LANGUAGES
}
