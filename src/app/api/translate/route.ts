import { NextResponse } from 'next/server'
import { translateBatch, LANGS, type Lang } from '@/lib/translate'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const texts: unknown = body?.texts
    const target: unknown = body?.target

    if (!Array.isArray(texts) || typeof target !== 'string' || !LANGS.includes(target as Lang)) {
      return NextResponse.json({ error: 'Expected { texts: string[], target: Lang }' }, { status: 400 })
    }

    // Cost guard: this public endpoint can trigger a paid translation on a cache
    // miss, so bound how much one request can ask for (cache hits are free; a new
    // string is billed once then cached forever).
    const list = texts as string[]
    const totalChars = list.reduce((n, t) => n + (typeof t === 'string' ? t.length : 0), 0)
    if (list.length > 60 || totalChars > 8000) {
      return NextResponse.json({ error: 'Too many/large texts in one request' }, { status: 400 })
    }

    const translations = await translateBatch(list, target as Lang)
    return NextResponse.json({ translations })
  } catch (err) {
    console.error('[api/translate]', err)
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
  }
}
