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

    const translations = await translateBatch(texts as string[], target as Lang)
    return NextResponse.json({ translations })
  } catch (err) {
    console.error('[api/translate]', err)
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
  }
}
