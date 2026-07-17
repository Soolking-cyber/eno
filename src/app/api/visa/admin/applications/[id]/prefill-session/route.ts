import { z } from 'zod'
import { decryptVisaPayload, visaApplicantSnapshotHash } from '@/lib/visa/crypto'
import { getVisaAdmin } from '@/lib/visa/auth'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'
import { VISA_AUTHORIZATION_VERSION } from '@/lib/visa/schema'
import { VISA_BUCKET } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const releaseSchema = z.object({ sessionId: z.string().trim().min(8).max(160) })
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

type HostedEvent = {
  event: string
  metadata: { sessionId?: unknown; expiresAt?: unknown; warnings?: unknown } | null
}

function browserError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'hosted_browser_not_configured') return Response.json({ error: message }, { status: 503, headers })
  return Response.json({ error: 'hosted_browser_failed' }, { status: 502, headers })
}

async function recentHostedEvents(applicationId: string) {
  const { data, error } = await getVisaDb()
    .from('visa_events')
    .select('event,metadata')
    .eq('application_id', applicationId)
    .in('event', ['hosted_prefill_started', 'hosted_prefill_released'])
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data || []) as HostedEvent[]
}

function latestUnreleased(events: HostedEvent[]) {
  const released = new Set<string>()
  for (const event of events) {
    const sessionId = typeof event.metadata?.sessionId === 'string' ? event.metadata.sessionId : ''
    if (!sessionId) continue
    if (event.event === 'hosted_prefill_released') released.add(sessionId)
    if (event.event === 'hosted_prefill_started' && !released.has(sessionId)) {
      return {
        sessionId,
        warnings: Array.isArray(event.metadata?.warnings) ? event.metadata.warnings.filter((item): item is string => typeof item === 'string') : [],
      }
    }
  }
  return null
}

async function activeSession(applicationId: string) {
  const stored = latestUnreleased(await recentHostedEvents(applicationId))
  if (!stored) return null
  const { resumeHostedVisaPrefill } = await import('@/lib/visa/hosted-prefill')
  const session = await resumeHostedVisaPrefill(stored.sessionId)
  return session ? { ...session, warnings: stored.warnings } : null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getVisaAdmin()
  if (!admin) return Response.json({ error: 'admin_required' }, { status: 403, headers })
  const { id } = await params
  const { data: application } = await getVisaDb().from('visa_applications').select('id').eq('id', id).maybeSingle()
  if (!application) return Response.json({ error: 'not_found' }, { status: 404, headers })
  if (!process.env.BROWSERBASE_API_KEY?.trim()) return Response.json({ configured: false, session: null }, { headers })
  try {
    return Response.json({ configured: true, session: await activeSession(id) }, { headers })
  } catch (error) {
    return browserError(error)
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getVisaAdmin()
  if (!admin) return Response.json({ error: 'admin_required' }, { status: 403, headers })
  if (!process.env.BROWSERBASE_API_KEY?.trim()) return Response.json({ error: 'hosted_browser_not_configured' }, { status: 503, headers })
  const { id } = await params
  const db = getVisaDb()
  const [{ data: application }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('status,encrypted_payload,authorized_at,authorization_version,authorization_snapshot_hash').eq('id', id).maybeSingle(),
    db.from('visa_documents').select('kind,storage_path,mime_type,validation_status').eq('application_id', id).in('kind', ['passport', 'portrait']),
  ])
  if (!application) return Response.json({ error: 'not_found' }, { status: 404, headers })
  if (
    application.status !== 'ready_to_submit'
    || !application.authorized_at
    || !application.authorization_snapshot_hash
    || application.authorization_version !== VISA_AUTHORIZATION_VERSION
  ) return Response.json({ error: 'applicant_authorization_refresh_required' }, { status: 409, headers })

  const payload = decryptVisaPayload(application.encrypted_payload)
  if (visaApplicantSnapshotHash(payload) !== application.authorization_snapshot_hash) {
    return Response.json({ error: 'authorized_snapshot_changed' }, { status: 409, headers })
  }
  const passport = documents?.find((document) => document.kind === 'passport' && document.validation_status === 'passed')
  const portrait = documents?.find((document) => document.kind === 'portrait' && document.validation_status === 'passed')
  if (!passport || !portrait) return Response.json({ error: 'verified_images_required' }, { status: 409, headers })

  try {
    const existing = await activeSession(id)
    if (existing) return Response.json({ session: existing, reused: true }, { headers })
    const [passportDownload, portraitDownload] = await Promise.all([
      db.storage.from(VISA_BUCKET).download(passport.storage_path),
      db.storage.from(VISA_BUCKET).download(portrait.storage_path),
    ])
    if (passportDownload.error || !passportDownload.data || portraitDownload.error || !portraitDownload.data) {
      return Response.json({ error: 'document_download_failed' }, { status: 500, headers })
    }
    const { createHostedVisaPrefill } = await import('@/lib/visa/hosted-prefill')
    const session = await createHostedVisaPrefill({
      payload,
      passport: {
        buffer: Buffer.from(await passportDownload.data.arrayBuffer()),
        mimeType: passport.mime_type || 'image/jpeg',
        name: 'passport.jpg',
      },
      portrait: {
        buffer: Buffer.from(await portraitDownload.data.arrayBuffer()),
        mimeType: portrait.mime_type || 'image/jpeg',
        name: 'portrait.jpg',
      },
    })
    await recordVisaEvent(id, 'admin', 'hosted_prefill_started', admin, {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      warnings: session.warnings,
      provider: 'browserbase',
      recordingsDisabled: true,
      captchaAutomationDisabled: true,
    })
    return Response.json({ session, reused: false }, { headers })
  } catch (error) {
    return browserError(error)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getVisaAdmin()
  if (!admin) return Response.json({ error: 'admin_required' }, { status: 403, headers })
  const parsed = releaseSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid_session' }, { status: 400, headers })
  const { id } = await params
  try {
    const stored = latestUnreleased(await recentHostedEvents(id))
    if (!stored || stored.sessionId !== parsed.data.sessionId) return Response.json({ error: 'session_not_found' }, { status: 404, headers })
    const { releaseHostedVisaPrefill } = await import('@/lib/visa/hosted-prefill')
    await releaseHostedVisaPrefill(parsed.data.sessionId)
    await recordVisaEvent(id, 'admin', 'hosted_prefill_released', admin, { sessionId: parsed.data.sessionId })
    return Response.json({ released: true }, { headers })
  } catch (error) {
    return browserError(error)
  }
}
