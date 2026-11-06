import { NextResponse } from 'next/server'
import { z } from 'zod'
import { route } from '@/lib/api/handler'
import { publishImportItem } from '@/lib/fb-import/publish'
import { normalizePhone } from '@/lib/phone'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// `area`: the location the seller confirmed for the whole import (publish.ts publishImportItem). Required: an import is never published on Facebook's guess alone.
const body = z.object({ contactPhone: z.string().max(40), contactName: z.string().max(80).optional(), area: z.string().trim().min(1).max(120) })

// One draft, one request: the screen walks the seller's selection, so a timeout costs one item and each result is reported. Strict: each one fetches photos and runs moderation.
export const POST = route({ auth: 'userId', rateLimit: { bucket: 'fb-import-publish', limit: 120, window: '1 h', strict: true } }, async ({ req, userId, params }) => {
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const phone = normalizePhone(parsed.data.contactPhone)
  if (phone.replace(/\D/g, '').length < 9) return NextResponse.json({ error: 'phone_required' }, { status: 400 })
  const r = await publishImportItem(userId, params.id, phone, parsed.data.contactName?.trim() ?? '', req.headers, parsed.data.area)
  return NextResponse.json(r, { status: r.ok ? 201 : 400, headers: { 'Cache-Control': 'no-store' } })
})
