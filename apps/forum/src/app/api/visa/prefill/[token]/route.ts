import { createHash } from 'node:crypto'
import { decryptVisaPayload, visaApplicantSnapshotHash } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'
import { signVisaFile } from '@/lib/visa/storage'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PII-bearing responses (and even the error shapes) must never be cached or leak a referrer.
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const

function clientIp(request: Request) {
  // Cloudflare's header first (Cloud Run sits behind CF + a Google LB, where
  // x-forwarded-for's first hop can be an edge IP, not the client) — mirrors
  // the marketplace's src/lib/client-ip.ts ordering.
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return Response.json({ error: 'invalid_token' }, { status: 404, headers: NO_STORE })
  // Per-IP brute-force guard on token claims — strict (fail closed): this endpoint returns a decrypted PII payload.
  const limit = await rateLimit('visa-prefill-claim', clientIp(request), 10, '1 h', { strict: true })
  if (!limit.success) return Response.json({ error: 'rate_limited' }, { status: 429, headers: NO_STORE })
  const db = getVisaDb()
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const { data: session } = await db.from('visa_prefill_sessions').select('*').eq('token_hash', tokenHash).maybeSingle()
  if (!session || session.consumed_at || new Date(session.expires_at) <= new Date()) return Response.json({ error: 'expired_or_used' }, { status: 410, headers: NO_STORE })
  const claimedAt = new Date().toISOString()
  const { data: claimed, error } = await db.from('visa_prefill_sessions').update({ consumed_at: claimedAt }).eq('id', session.id).is('consumed_at', null).gt('expires_at', claimedAt).select('id')
  if (error || claimed?.length !== 1) return Response.json({ error: 'expired_or_used' }, { status: 410, headers: NO_STORE })
  const [{ data: application }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', session.application_id).maybeSingle(),
    db.from('visa_documents').select('kind,storage_path').eq('application_id', session.application_id),
  ])
  if (!application || application.status !== 'ready_to_submit' || !application.authorized_at) return Response.json({ error: 'application_not_ready' }, { status: 409, headers: NO_STORE })
  const payload = decryptVisaPayload(application.encrypted_payload)
  if (!application.authorization_snapshot_hash || visaApplicantSnapshotHash(payload) !== application.authorization_snapshot_hash) return Response.json({ error: 'authorized_snapshot_changed' }, { status: 409, headers: NO_STORE })
  const portrait = documents?.find((item) => item.kind === 'portrait'), passport = documents?.find((item) => item.kind === 'passport')
  if (!portrait || !passport) return Response.json({ error: 'documents_missing' }, { status: 409, headers: NO_STORE })
  await recordVisaEvent(application.id, 'system', 'prefill_session_consumed')
  return Response.json({ applicationId: application.id, payload, documents: { portrait: await signVisaFile(portrait.storage_path), passport: await signVisaFile(passport.storage_path) }, stopBeforeSubmission: true }, { headers: NO_STORE })
}
