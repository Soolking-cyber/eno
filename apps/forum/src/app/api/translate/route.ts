import { NextResponse } from 'next/server'
import { LANGUAGE_CODES, isLanguage } from '@/lib/languages'
import { kv, rateLimit } from '@/lib/ratelimit'
import { translateBatch, uncachedTranslationStats } from '@/lib/translate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function clientIp(request: Request) {
  // Cloudflare's header first (Cloud Run sits behind CF + a Google LB, where
  // x-forwarded-for's first hop can be an edge IP, not the client) — mirrors
  // the marketplace's src/lib/client-ip.ts ordering.
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
}

async function chargeDailyCharacters(characters: number) {
  if (characters === 0) return true
  try {
    const key = `forum-translate:chars:${new Date().toISOString().slice(0, 10)}`
    const total = await kv.incrby(key, characters, 172_800)
    return total <= 1_000_000
  } catch {
    // Unconfigured admin client or backend blip: dev stays usable, prod fails
    // CLOSED (no accounting means no paid calls) — same stance as before.
    return process.env.NODE_ENV !== 'production'
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { texts?: unknown; target?: unknown }
    if (!Array.isArray(body.texts) || !isLanguage(body.target)) {
      return NextResponse.json({ error: `Expected texts and one of: ${LANGUAGE_CODES.join(', ')}` }, { status: 400 })
    }
    if (body.texts.some((text) => typeof text !== 'string')) {
      return NextResponse.json({ error: 'Every translation item must be a string' }, { status: 400 })
    }
    const texts = body.texts as string[]
    const characters = texts.reduce((total, text) => total + text.length, 0)
    if (texts.length > 250 || characters > 30_000) {
      return NextResponse.json({ error: 'Translation batch is too large' }, { status: 400 })
    }
    if (body.target === 'en' && texts.every((text) => /^[\x00-\x7F]*$/.test(text))) {
      return NextResponse.json({ translations: texts })
    }

    const misses = await uncachedTranslationStats(texts, body.target)
    if (misses.count > 0) {
      const strict = process.env.NODE_ENV === 'production'
      const limit = await rateLimit('forum-translate-billable-ip', clientIp(request), 6, '1 m', { strict })
      if (!limit.success || !(await chargeDailyCharacters(misses.characters))) {
        return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
      }
    }

    return NextResponse.json({ translations: await translateBatch(texts, body.target) })
  } catch (error) {
    console.error('[api/translate]', (error as Error)?.message?.slice(0, 300))
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
  }
}
