import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/log'
import { recordVisaEvent } from '@/lib/visa/records'

/**
 * ABANDONED DRAFTS EXPIRE (security review 2026-10-22, item 30).
 *
 * retention_until is written only on the terminal transitions, so a draft nobody submits or cancels — its passport
 * scan, portrait and encrypted answers — was kept for ever. The desk never sees one either: its queue lists only cases
 * that left `draft` or were paid (visa-admin.ts). The retention cron calls this once a day. An UNPAID draft with no
 * activity for STALE_DRAFT_DAYS is cancelled — the same transition as the applicant's own Cancel — with
 * retention_until = now, and the cron's next sweep deletes it through its fail-closed path (objects first, then the
 * row). Nothing here deletes anything.
 *
 * "No activity" is three facts, because no single column records it:
 *   · visa_applications.updated_at and last_applicant_action_at — answers saved, the AI read, a submit;
 *   · visa_documents.created_at — an upload commits through visa_commit_document, which locks the application row
 *     but touches neither timestamp;
 *   · visa_events.created_at — every other step either side takes, a refused upload included.
 * Any one inside the window keeps the case. So does a paid payment row (a draft should never have one; checked
 * anyway), and the cancel itself re-asserts draft + unpaid + the updated_at it read (CAS), so a case edited or
 * submitted between the read and the write is left alone.
 */
export const STALE_DRAFT_DAYS = 30
const PAGE = 100
const MAX_PAGES = 20 // runaway stop, as the sweep's MAX_BATCHES

type DraftRow = { id: string; updated_at: string; last_applicant_action_at: string | null }

export async function expireStaleVisaDrafts(db: SupabaseClient, now: Date): Promise<{ expired: number; failed: number }> {
  const nowIso = now.toISOString()
  const cutoffMs = now.getTime() - STALE_DRAFT_DAYS * 86_400_000
  const cutoff = new Date(cutoffMs).toISOString()
  let expired = 0
  let failed = 0
  // Keyset on updated_at: a draft kept for recent activity stays old by that column, and would otherwise sit at the
  // head of every page and starve the drafts behind it.
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    let query = db.from('visa_applications')
      .select('id,updated_at,last_applicant_action_at')
      .eq('status', 'draft')
      .is('paid_at', null)
      .lt('updated_at', cutoff)
    if (after) query = query.gt('updated_at', after)
    const { data, error } = await query.order('updated_at', { ascending: true }).limit(PAGE)
    if (error) throw new Error(`stale_draft_query_failed:${error.code ?? 'unknown'}`)
    const rows = (data ?? []) as DraftRow[]
    if (!rows.length) break
    after = rows[rows.length - 1].updated_at

    const idle = rows.filter((r) => !r.last_applicant_action_at || Date.parse(r.last_applicant_action_at) < cutoffMs)
    if (idle.length) {
      const ids = idle.map((r) => r.id)
      const [documents, events, payments] = await Promise.all([
        db.from('visa_documents').select('application_id').in('application_id', ids).gte('created_at', cutoff),
        db.from('visa_events').select('application_id').in('application_id', ids).gte('created_at', cutoff),
        db.from('visa_payments').select('application_id').in('application_id', ids).eq('status', 'paid'),
      ])
      if (documents.error || events.error || payments.error) {
        // "Could not look" is not "nothing happened": keep the whole page, count it, try again tomorrow.
        failed += idle.length
      } else {
        const keep = new Set(
          [...(documents.data ?? []), ...(events.data ?? []), ...(payments.data ?? [])].map((r) => (r as { application_id: string }).application_id),
        )
        for (const row of idle) {
          if (keep.has(row.id)) continue
          const cancelled = await db.from('visa_applications')
            .update({ status: 'cancelled', resolved_at: nowIso, retention_until: nowIso, updated_at: nowIso })
            .eq('id', row.id)
            .eq('status', 'draft')
            .is('paid_at', null)
            .eq('updated_at', row.updated_at)
            .select('id')
            .maybeSingle()
          if (cancelled.error) { failed++; continue }
          if (!cancelled.data) continue // edited, submitted or paid since the read: not stale any more
          expired++
          try {
            await recordVisaEvent(row.id, 'system', 'application_cancelled', undefined, { reason: 'idle', idleDays: STALE_DRAFT_DAYS })
          } catch (e) {
            logError(e, { op: 'visa.staleDraft.event', applicationId: row.id })
          }
        }
      }
    }
    if (rows.length < PAGE) break
  }
  return { expired, failed }
}
