import { NextResponse } from 'next/server'
import { getAdmin, getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { VISA_BUCKET } from '@/lib/visa-admin'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'
import { VISA_RESULT_MAX_BYTES, findVisaResultDocument, visaResultFilename } from '@/lib/visa/result'

// THE APPLICANT DOWNLOADS THEIR VISA, IN THE CHAT.
//
// The owner: "user can download there". The card in the thread points here, and it points
// here EVERY TIME — requirement 5, "the card stays downloadable, it is not a one-shot
// link". Nothing about this endpoint is single-use: it re-reads the row and re-streams the
// bytes on each request, so a customer who lost the email a year later still has their
// visa in the conversation.
//
// ⚠️ NO URL TO THE VISA IS EVER HANDED TO THE APPLICANT. On this path there is no signed
// URL, no public object and no redirect to storage — the bytes are fetched server-side and
// written into the response of an authenticated request. A signed URL, however short-lived,
// is a bearer token for an identity document, and it would then sit in browser history, in
// a referrer header, and in whatever the applicant pastes it into.
// ⚠️ Stated precisely, because the same file is reachable another way: the ADMIN case page
// (src/app/admin/visas/[id]/page.tsx) signs a 6h URL for EVERY document on a case, result
// included, exactly as it already does for the passport and portrait images. That is the
// desk's own admin-gated SSR surface and predates this route — but it means "nobody ever
// gets a signed URL to a result" would be a false claim, and the applicant-facing promise
// is the one this route keeps.
//
// ⚠️ WHO MAY READ IT: the applicant, and the desk. Nobody else, ever.
//   · THE OWNERSHIP CHECK is `application.user_id === the session's profile id`, and it is
//     the ONLY thing standing between one applicant and another's passport-bearing visa.
//     result.test.ts drives a signed-in non-owner with the storage layer counted, and
//     asserts a 404 with zero downloads — deleting the check turns the suite red.
//   · ADMIN is allowed alongside the owner, mirroring the existing per-document route
//     (/api/visa/applications/[id]/documents/[documentId]) so the desk can verify the exact
//     bytes the applicant received. Same entitlement model as the handover pack, with the
//     same caveat: ADMIN_EMAILS is the whole allowlist, so adding an address to it adds
//     access to every applicant's visa.
//   · A caller who is neither gets 404, NOT 403. A 403 would confirm the case exists.
//
// ⚠️ `no-store` on every response, refusals included — an intermediary caching either the
// PDF or a "not found" for this URL is a data leak in one direction and an outage in the
// other.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } as const
const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE })

// ⚠️ WS6 — NOT MIGRATED: EVERY RESPONSE CARRIES A HEADER THE WRAPPER CANNOT SET, INCLUDING THE
// REFUSALS. `refuse()` above attaches `Cache-Control: no-store, max-age=0, must-revalidate` to the
// 401, the 429, both 404s and all three 503s; `apiFail()` emits a bare `NextResponse.json({error})`
// with no headers, so the 401 and the 429 the wrapper would produce lose the header the file's own
// preamble calls a data leak in one direction and an outage in the other. The success path is a
// `Response` with five headers, which a handler may still return — but the refusals are the ones
// the wrapper would author, and it cannot.
//
// Two further wire facts block the individual options even if headers were free:
//   · `auth:` — the gate is `!userId && !admin` over `Promise.all([getCurrentProfileId(),
//     getAdmin()])`, and `admin` is read again at the ownership check and at the audit actor. Same
//     disjunction as the per-document route; `auth:'userId'` 401s a caller today's bytes serve,
//     `auth:'admin'` answers capital-F `Forbidden` 403 to the applicant who owns the visa.
//   · `rateLimit:` — the key is `userId || admin || 'anon'`, i.e. it falls back to the ADMIN EMAIL
//     for a desk caller. The wrapper keys on `userId ?? clientIp(req)`, so every admin download
//     would move from a per-operator bucket to a per-IP one.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [userId, admin] = await Promise.all([getCurrentProfileId(), getAdmin()])
  if (!userId && !admin) return refuse('auth_required', 401)

  // Fails OPEN: a limiter outage must not stand between a customer and the document they
  // paid for. The cap is here because each call streams a file out of private storage.
  const limit = await rateLimit('visa-result-download', userId || admin || 'anon', 60, '1 h')
  if (!limit.success) return refuse('rate_limited', 429)

  const { id } = await params
  if (!UUID_RE.test(id)) return refuse('not_found', 404)

  const { data: application, error } = await getVisaDb()
    .from('visa_applications')
    .select('id,user_id,reference')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[visa-result] case load failed', error.code)
    return refuse('visa_database_unavailable', 503)
  }
  // THE OWNERSHIP GATE. Absent case and wrong owner give the SAME answer on purpose.
  if (!application || (!admin && application.user_id !== userId)) return refuse('not_found', 404)

  let document
  try {
    document = await findVisaResultDocument(id)
  } catch {
    console.error('[visa-result] document lookup failed')
    return refuse('visa_database_unavailable', 503)
  }
  // The visa is not ready yet. Ordinary, not an error condition.
  if (!document) return refuse('result_not_ready', 404)

  const { data, error: downloadError } = await getVisaDb().storage.from(VISA_BUCKET).download(document.storage_path)
  if (downloadError || !data) {
    // No storage path in the log line — it names an account and a case.
    console.error('[visa-result] storage read failed')
    return refuse('result_unavailable', 503)
  }
  const bytes = new Uint8Array(await data.arrayBuffer())
  // The row said how big it should be; only the download says how big it is (the bundle
  // route's lesson). A result is capped at upload time, so anything past the ceiling is a
  // corrupt object, not a big visa.
  if (!bytes.length || bytes.length > VISA_RESULT_MAX_BYTES) {
    console.error('[visa-result] stored object has an implausible size')
    return refuse('result_unavailable', 503)
  }

  // Best-effort, and deliberately NOT a gate — unlike the handover pack, where an unlogged
  // export of a decrypted dossier is the thing the audit exists to prevent. This is the
  // applicant's own document; refusing to hand it over because an event row would not
  // write is the wrong trade. Actor id only; no address, no filename, no path.
  try {
    await recordVisaEvent(id, admin && application.user_id !== userId ? 'admin' : 'applicant', 'result_downloaded', (admin && application.user_id !== userId ? admin : userId) || undefined, { documentId: document.id })
  } catch {
    console.error('[visa-result] download audit write failed')
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // ASCII-safe by construction: visaResultFilename re-emits only `EV`, `-` and digits
      // (src/lib/visa/reference.ts), so no quote, newline or applicant value can reach this
      // header — no RFC 5987 encoding needed, and nothing about the person in the name their
      // browser saves.
      'Content-Disposition': `attachment; filename="${visaResultFilename(application.reference)}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
