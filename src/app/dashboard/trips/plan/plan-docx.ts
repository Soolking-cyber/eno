// Word-export translation helper for the trip planner, extracted verbatim from
// itinerary-builder.tsx (the pure docx lib helpers live in src/lib/itinerary-docx-copy).
import type { Language } from '@/context/language-context'

/** One-shot machine translations for the Word export (docx renders en/vi natively;
 *  a third language sends a source→translation map). Chunked so a cold language
 *  stays inside /api/translate's per-request billable cap — the language-context
 *  batching idiom. Failures degrade to the English source, never a broken button. */
export async function requestDocxTranslations(texts: string[], language: Language): Promise<Record<string, string>> {
  const unique = Array.from(new Set(texts.filter(Boolean)))
  if (unique.length === 0) return {}
  const CHUNK = 100
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK))
  const results = await Promise.all(chunks.map(async (chunk) => {
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: chunk, target: language }),
      })
      if (!response.ok) return null
      const body = await response.json() as { translations?: string[] }
      return Array.isArray(body.translations) ? body.translations : null
    } catch {
      return null
    }
  }))
  const map: Record<string, string> = {}
  results.forEach((translations, chunkIndex) => {
    if (!translations) return
    chunks[chunkIndex].forEach((source, i) => {
      const translated = translations[i]
      if (translated && translated !== source) map[source] = translated
    })
  })
  return map
}
