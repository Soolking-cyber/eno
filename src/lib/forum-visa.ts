import 'server-only'

import { createSupabaseServer } from '@/lib/supabase/server'
import { FORUM_URL } from '@/lib/forum-nav'

// Why this ONE dashboard section is a cross-site proxy while forum posts/itineraries are
// plain Prisma reads: visa applications live in the forum's OWN database (encrypted
// payloads, forum-side admin workflow) — the marketplace DB has no visa tables. Both
// sites share one Supabase auth project, so the user's marketplace access token is a
// valid Bearer for the forum's /api/visa/applications endpoint.
//
// FAIL-SOFT contract: every failure (401, 503/visa_schema_not_ready, 5xx, network error,
// timeout, malformed body) collapses into { state: 'unavailable' } — callers render an
// honest "not reachable" card, never a crash and never an upstream error string. The
// token is used for the one fetch and is never logged, thrown, or returned.

export type ForumVisaApplication = {
  id: string
  status: string
  documentCount: number
  submittedAt: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string | null
}

export type ForumVisaResult =
  | { state: 'ok'; applications: ForumVisaApplication[] }
  | { state: 'signed-out' }
  | { state: 'unavailable' }

export async function fetchForumVisaApplications(): Promise<ForumVisaResult> {
  let token: string | undefined
  try {
    const supabase = await createSupabaseServer()
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token ?? undefined
  } catch {
    return { state: 'unavailable' }
  }
  if (!token) return { state: 'signed-out' }

  // Never attach the session token to anything but the known forum origins (defense
  // in depth — FORUM_URL is owner-controlled env, but a misconfigured value must fail
  // closed rather than exfiltrate a reusable bearer token).
  const allowedHost = (() => {
    try {
      const u = new URL(FORUM_URL)
      return u.protocol === 'https:' && ['www.eno.forum', 'eno.forum'].includes(u.hostname)
    } catch { return false }
  })()
  if (!allowedHost) return { state: 'unavailable' }

  try {
    const res = await fetch(`${FORUM_URL}/api/visa/applications`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { state: 'unavailable' }
    const body = (await res.json()) as { applications?: unknown }
    if (!Array.isArray(body.applications)) return { state: 'unavailable' }
    const applications: ForumVisaApplication[] = []
    for (const raw of body.applications) {
      const a = raw as Record<string, unknown>
      // Defensive pick: only the fields this section renders cross the boundary (the
      // forum payload also carries checklist/admin fields we must not depend on).
      // A malformed ENTRY means the upstream contract broke — report the section as
      // unavailable rather than silently rendering "no applications" (a lie).
      if (typeof a?.id !== 'string' || typeof a?.status !== 'string') return { state: 'unavailable' }
      // Dates: absent stays null; PRESENT-but-invalid means the upstream contract broke.
      const date = (v: unknown): string | null | false => {
        if (v == null) return null
        if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return v
        return false
      }
      const submittedAt = date(a.submittedAt)
      const resolvedAt = date(a.resolvedAt)
      const createdAt = date(a.createdAt)
      const updatedAt = date(a.updatedAt)
      if (submittedAt === false || resolvedAt === false || createdAt === false || updatedAt === false) return { state: 'unavailable' }
      if (!Array.isArray(a.documents)) return { state: 'unavailable' }
      applications.push({
        id: a.id,
        status: a.status,
        documentCount: a.documents.length,
        submittedAt,
        resolvedAt,
        createdAt: createdAt ?? '',
        updatedAt,
      })
    }
    return { state: 'ok', applications }
  } catch {
    return { state: 'unavailable' }
  }
}
