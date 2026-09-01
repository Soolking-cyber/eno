import { getCurrentProfile } from '@/lib/admin'
import { db } from '@/lib/db'

/**
 * applicationId → the conversation each case LIVES IN. Extracted from the visa dashboard page when
 * Trips + e-Visa were merged into the /dashboard/services section (2026-09-01) so both the section
 * page and anything else can resolve it without duplicating the read. Behaviour is unchanged:
 * immutable `visa_applications.conversation_id` first, live `Conversation.visaApplicationId`
 * binding as the legacy fallback, both viewer-scoped, both fail-soft to whatever the other produced.
 */
export async function visaThreadsForViewer(): Promise<Record<string, string>> {
  const profile = await getCurrentProfile().catch(() => null)
  // Guests are handled by the client's own sign-in gate (the sibling dashboard
  // sections' idiom) — no server redirect here, so a cold native start with a
  // still-warming cookie cannot bounce between /signin and the dashboard.
  if (!profile) return {}
  const threads: Record<string, string> = {}
  try {
    const rows = await db.conversation.findMany({
      where: { buyerProfileId: profile.id, visaApplicationId: { not: null }, sellerProfileId: { not: null } },
      select: { id: true, visaApplicationId: true },
    })
    for (const row of rows) if (row.visaApplicationId) threads[row.visaApplicationId] = row.id
  } catch (error) {
    // Ids only, never an applicant value — this page is one hop from passport data.
    console.error('[dashboard/visa] live thread map read failed', (error as Error)?.message?.slice(0, 200))
  }
  try {
    const { getVisaDb } = await import('@/lib/visa/db')
    const { data, error } = await getVisaDb()
      .from('visa_applications')
      .select('id,conversation_id')
      .eq('user_id', profile.id)
    if (error) throw error
    for (const row of (data || []) as Array<{ id?: string; conversation_id?: string | null }>) {
      // Immutable wins over the live binding — it names the thread the case's own cards
      // (result PDF included) actually live in, rebinds notwithstanding.
      if (row.id && typeof row.conversation_id === 'string' && row.conversation_id) threads[row.id] = row.conversation_id
    }
  } catch (error) {
    console.error('[dashboard/visa] immutable thread map read failed', (error as Error)?.message?.slice(0, 200))
  }
  return threads
}

