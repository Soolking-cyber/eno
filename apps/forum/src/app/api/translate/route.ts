import { NextResponse } from 'next/server'
import { LANGUAGE_CODES, isLanguage } from '@/lib/languages'
import { getRedis, rateLimit } from '@/lib/ratelimit'
import { translateBatch, uncachedTranslationStats } from '@/lib/translate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function clientIp(request: Request) {
  return request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
}

async function chargeDailyCharacters(characters: number) {
  if (characters === 0) return true
  const redis = getRedis()
  if (!redis) return process.env.NODE_ENV !== 'production'
  try {
    const key = `forum-translate:chars:${new Date().toISOString().slice(0, 10)}`
    const total = await redis.incrby(key, characters)
    await redis.expire(key, 172_800)
    return total <= 1_000_000
  } catch {
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
