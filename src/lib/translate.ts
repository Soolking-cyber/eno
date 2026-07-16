import 'server-only'

import { createHash } from 'node:crypto'
import { Type } from '@google/genai'
import { GEMINI_MODEL, getGemini } from '@/lib/gemini'
import { getVisaDb } from '@/lib/visa/db'
import { languageName, type Language } from '@/lib/languages'

const GOOGLE_ENDPOINT = 'https://translation.googleapis.com/language/translate/v2'
const GOOGLE_CODES: Record<Language, string> = {
  en: 'en', vi: 'vi', 'zh-Hans': 'zh-CN', ko: 'ko', ja: 'ja', ru: 'ru',
  km: 'km', ms: 'ms', th: 'th', fr: 'fr', hi: 'hi',
}

type TranslationRow = { source_hash: string; source_text: string; translated_text: string }

function hash(text: string) {
  return createHash('sha1').update(text).digest('hex')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
}

async function readCache(texts: string[], target: Language): Promise<Map<string, string>> {
  const output = new Map<string, string>()
  try {
    const hashes = texts.map(hash)
    const { data, error } = await getVisaDb()
      .from('forum_translations')
      .select('source_hash,source_text,translated_text')
      .eq('target_language', target)
      .in('source_hash', hashes)
    if (error) return output
    for (const row of (data || []) as TranslationRow[]) output.set(row.source_text, row.translated_text)
  } catch {
    // Cache setup must never make the translated UI unavailable.
  }
  return output
}

export async function uncachedTranslationStats(texts: string[], target: Language) {
  const unique = Array.from(new Set(texts.filter((text) => text.trim())))
  const cached = await readCache(unique, target)
  const missing = unique.filter((text) => !cached.has(text))
  return { count: missing.length, characters: missing.reduce((total, text) => total + text.length, 0) }
}

async function writeCache(source: string[], translated: string[], target: Language) {
  try {
    await getVisaDb().from('forum_translations').upsert(source.map((text, index) => ({
      source_hash: hash(text),
      source_text: text,
      target_language: target,
      translated_text: translated[index] || text,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'source_hash,target_language' })
  } catch {
    // Best effort; the provider response can still be served.
  }
}

async function googleTranslate(texts: string[], target: Language): Promise<string[] | null> {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY?.trim()
  if (!key) return null
  try {
    const response = await fetch(`${GOOGLE_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, target: GOOGLE_CODES[target], format: 'text' }),
    })
    if (!response.ok) return null
    const json = await response.json() as { data?: { translations?: Array<{ translatedText?: string }> } }
    const translations = json.data?.translations
    if (!Array.isArray(translations) || translations.length !== texts.length) return null
    return texts.map((text, index) => decodeEntities(translations[index]?.translatedText || text))
  } catch {
    return null
  }
}

async function geminiTranslate(texts: string[], target: Language): Promise<string[] | null> {
  const ai = getGemini()
  if (!ai) return null
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Translate every item in the JSON array into ${languageName(target)}. Preserve eno brand names, URLs, email addresses, numbers, currency codes, placeholders, punctuation, and meaning. Use concise natural UI language. Return exactly one translated string for each input, in the same order. Input JSON:\n${JSON.stringify(texts)}`,
      config: {
        temperature: 0,
        maxOutputTokens: Math.min(16_000, Math.max(2_000, texts.join('').length * 2)),
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { translations: { type: Type.ARRAY, items: { type: Type.STRING } } },
          required: ['translations'],
        },
      },
    })
    const parsed = JSON.parse(response.text || '{}') as { translations?: string[] }
    if (!Array.isArray(parsed.translations) || parsed.translations.length !== texts.length) return null
    return parsed.translations.map((value, index) => value || texts[index])
  } catch (error) {
    console.error('[translate/gemini]', (error as Error)?.message?.slice(0, 300))
    return null
  }
}

export async function translateBatch(texts: string[], target: Language): Promise<string[]> {
  if (!texts.length) return []
  const unique = Array.from(new Set(texts.filter((text) => text.trim())))
  const cached = await readCache(unique, target)
  const missing = unique.filter((text) => !cached.has(text))

  if (missing.length) {
    const translated = await googleTranslate(missing, target) || await geminiTranslate(missing, target)
    if (translated) {
      missing.forEach((text, index) => cached.set(text, translated[index] || text))
      await writeCache(missing, translated, target)
    } else {
      missing.forEach((text) => cached.set(text, text))
    }
  }

  return texts.map((text) => text.trim() ? cached.get(text) || text : text)
}
