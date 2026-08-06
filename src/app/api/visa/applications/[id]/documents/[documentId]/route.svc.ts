import { NextResponse } from 'next/server'
import { getAdmin, getCurrentProfileId } from '@/lib/admin'
import { getVisaDb } from '@/lib/visa/db'
import { signVisaFile } from '@/lib/visa/storage'

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/documents/[documentId]/route.ts —
// short-lived signed URL for a private visa document. Owner OR eno.vn admin (ADMIN_EMAILS,
// mirroring the forum's owner-or-visa-admin gate). No payload access → no crypto gate.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ⚠️ WS6 — NOT MIGRATED: THE 401 PREDICATE IS A DISJUNCTION OVER TWO IDENTITIES, AND THE WRAPPER
// RESOLVES EXACTLY ONE. The gate is `!userId && !admin` over `Promise.all([getCurrentProfileId(),
// getAdmin()])`, and `admin` is then load-bearing again three lines down (it is what lets the desk
// read a case it does not own). Neither mode reproduces those bytes:
//   · `auth: 'userId'` refuses on `!userId` alone, so a caller whose getClaims() path yields
//     nothing while getUser() still resolves an ADMIN_EMAILS session — the two calls are different
//     verifications of the same cookie, one local-JWKS and one round-trip — gets 401 where today
//     they are served. It also serialises the two calls that are deliberately parallel here.
//   · `auth: 'admin'` answers `{"error":"Forbidden"}` 403 (capital F, handler.ts:189) where every
//     non-admin caller — including the applicant who OWNS the document — currently gets
//     `{"error":"auth_required"}` 401. Two changed bytes and a changed status on the main path.
// With auth pinned in the handler there is no rate limit, no JSON body and no invalidBodyCode
// left to give the wrapper: all four options would be empty, which is churn.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const [userId, admin] = await Promise.all([getCurrentProfileId(), getAdmin()])
  if (!userId && !admin) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id, documentId } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(documentId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const db = getVisaDb()
  const { data: application } = await db.from('visa_applications').select('id,user_id').eq('id', id).maybeSingle()
  if (!application || (!admin && application.user_id !== userId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { data: document } = await db.from('visa_documents').select('storage_path').eq('id', documentId).eq('application_id', id).maybeSingle()
  if (!document) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ url: await signVisaFile(document.storage_path) })
}
