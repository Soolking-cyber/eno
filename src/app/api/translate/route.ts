import { NextResponse } from 'next/server'
import { translateBatch, uncachedStats, LANGS, type Lang } from '@/lib/translate'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const texts: unknown = body?.texts
    const target: unknown = body?.target

    if (!Array.isArray(texts) || typeof target !== 'string' || !LANGS.includes(target as Lang)) {
      return NextResponse.json({ error: 'Expected { texts: string[], target: Lang }' }, { status: 400 })
    }

    const list = texts as string[]
    // Anti-DoS: bound the raw payload. Generous, so the app's own large batches
    // (the ~555-string UI dictionary, busy listing pages) pass through.
    if (list.length > 1500) {
      return NextResponse.json({ error: 'Too many texts in one request' }, { status: 400 })
    }

    // Cost guard: this public endpoint can trigger a PAID translation on a cache
    // miss — but cache hits are free (a string is billed once, then cached
    // forever). So bound only the BILLABLE (uncached) work, not total size: the
    // full UI dictionary and repeat listing views (all cache hits) go straight
    // through, while a request asking for a large batch of brand-new strings is
    // rejected. This is what fixes the UI dictionary fetch, which was a single
    // request of all ~555 strings (all cached) being wrongly rejected by size.
    const { count: newCount, chars: newChars } = await uncachedStats(list, target as Lang)
    if (newCount > 250 || newChars > 30000) {
      return NextResponse.json({ error: 'Too many new texts in one request' }, { status: 400 })
    }

    const translations = await translateBatch(list, target as Lang)
    return NextResponse.json({ translations })
  } catch (err) {
    console.error('[api/translate]', err)
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
  }
}
