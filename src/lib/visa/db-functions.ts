import 'server-only'
import { db } from '@/lib/db'

export type VisaCommitResult = { ok?: boolean; code?: string; old_paths?: string[] }

/**
 * ⛔ visa_commit_document IS CALLED AS THE DATABASE OWNER, OVER PRISMA — NEVER THROUGH POSTGREST (2026-10-26).
 *
 * The documents route called it as `getVisaDb().rpc(...)`, which PostgREST resolves from its SCHEMA CACHE, by argument
 * NAME. That made every visa document upload depend on two things outside the code, and both have failed in production:
 *   · 2026-09-06 — the function was created with type-only arguments (proargnames NULL), so the named call matched
 *     nothing (scripts/visa-commit-document-fn.mjs);
 *   · 2026-10-26 — after the 10-25 lockdown revoked EXECUTE on the public SECURITY DEFINER functions, PostgREST answered
 *     PGRST202 "Could not find the function public.visa_commit_document(p_application_id, p_document, p_replace,
 *     p_user_id) in the schema cache" (eno-vn-app logs, 05:23–05:25Z) — the photo reached storage, the row never landed,
 *     and the applicant read "Something went wrong" on every try.
 * Positionally, as `postgres` (the function's owner — the same connection every other caller of these functions uses,
 * per the lockdown's own note), neither the cache nor the names matter, and no API role needs EXECUTE on it.
 * Every parameter is cast: node-postgres sends them untyped. A raise inside the function throws here, as before.
 */
export async function commitVisaDocument(a: { applicationId: string; userId: string; document: Record<string, unknown>; replace: boolean }): Promise<VisaCommitResult> {
  const rows = await db.$queryRaw<{ r: unknown }[]>`
    SELECT public.visa_commit_document(${a.applicationId}::uuid, ${a.userId}::uuid, ${JSON.stringify(a.document)}::jsonb, ${a.replace}::boolean) AS r`
  const r = rows[0]?.r
  return ((typeof r === 'string' ? JSON.parse(r) : r) ?? {}) as VisaCommitResult
}
