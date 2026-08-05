import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { LANGS } from '@/lib/i18n/langs'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Persist the signed-in user's chosen UI language onto their Profile so server-side
// messages (e.g. moderation notifications) reach them in the right language. Fire-and-
// forget from the language context; a no-op (401) for guests.
const VALID_LOCALES = new Set<string>(LANGS)

export async function POST(req: Request) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: { locale?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const locale = String(body.locale || '').trim()
  if (!VALID_LOCALES.has(locale)) return NextResponse.json({ error: 'invalid_locale' }, { status: 400 })

  // Only write when it actually changed (cheap read first to avoid needless updates).
  const cur = await db.profile.findUnique({ where: { id: meId }, select: { locale: true } })
  if (cur && cur.locale !== locale) await db.profile.update({ where: { id: meId }, data: { locale } }).catch((e) => logError(e, { op: 'profile.saveLocale' }))
  return NextResponse.json({ ok: true })
}
