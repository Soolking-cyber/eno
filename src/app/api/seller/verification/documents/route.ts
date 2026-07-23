import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/ratelimit'
import {
  MAX_VERIFICATION_DOC_BYTES,
  sniffVerificationMime,
  storeVerificationDoc,
  VERIFICATION_DOC_KINDS,
  type VerificationDocKind,
} from '@/lib/business-verification-store'
import { appendVerificationDoc, getOrCreateDraft } from '@/lib/core/business-verification-service'

// Applicant uploads one business-verification document (identity / bank / authorization)
// to their OWN draft case. Mirrors the visa documents route's shape — auth → strict
// rateLimit → ownership → size-guard-before-arrayBuffer → MAGIC-BYTE validation (client
// MIME is NOT trusted) → store → append — minus the visa crypto/consent branches.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  // Strict: uploads are an abuse/storage vector, so fail CLOSED if the limiter is down.
  const limit = await rateLimit('business-verif-doc', userId, 20, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const seller = await db.seller.findUnique({ where: { ownerId: userId }, select: { id: true } })
  if (!seller) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })

  let form: FormData
  try { form = await request.formData() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  const kindRaw = form.get('kind')
  const file = form.get('file')
  if (typeof kindRaw !== 'string' || !VERIFICATION_DOC_KINDS.includes(kindRaw as VerificationDocKind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  }
  if (!(file instanceof File)) return NextResponse.json({ error: 'invalid_document' }, { status: 400 })
  // Size guard BEFORE arrayBuffer() — never buffer a huge upload into memory to reject it.
  if (file.size > MAX_VERIFICATION_DOC_BYTES) return NextResponse.json({ error: 'file_too_large' }, { status: 400 })

  const bytes = Buffer.from(await file.arrayBuffer())
  const mime = sniffVerificationMime(bytes)
  if (!mime) return NextResponse.json({ error: 'unsupported_file_type' }, { status: 415 })

  const draft = await getOrCreateDraft(seller.id)
  if (!draft) return NextResponse.json({ error: 'verification_locked' }, { status: 409 })

  const stored = await storeVerificationDoc({ profileId: userId, kind: kindRaw as VerificationDocKind, bytes, mime })
  if (!stored) return NextResponse.json({ error: 'store_failed' }, { status: 502 })

  const appended = await appendVerificationDoc(draft.id, stored)
  if (!appended) return NextResponse.json({ error: 'verification_locked' }, { status: 409 })

  return NextResponse.json({ ok: true, kind: stored.kind }, { status: 201 })
}
