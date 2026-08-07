import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getCurrentProfile } from '@/lib/admin'
import { db } from '@/lib/db'
import { VisaCasesSkeleton } from './cases-client'
import { VisaCasesClient } from './cases-client'

// /dashboard/visa — the applicant's e-Visa CASES, and the way back into the thread each
// one lives in. There is no form here any more (owner 2026-07-22: "only 1 way should exist
// through the chat"); the 1,960-line wizard that used to render at this route is deleted
// and every question it asked now belongs to the five step cards in the conversation.
// The section still exists because three things are not the chat's: seeing your cases, the
// provider payment return, and the final prefill authorization — see cases-client.tsx.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Vietnam e-Visa | ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

/**
 * applicationId → the conversation each case LIVES IN — every case, not just the newest.
 *
 * ⚠️ THE IMMUTABLE LINK IS AUTHORITATIVE (Phase 3). `Conversation.visaApplicationId` is
 * the LIVE binding and holds at most ONE case per thread: a repeat applicant's second
 * case REBINDS the pointer, so mapping by it alone made every earlier case's "Open chat"
 * vanish — including the thread its result PDF was delivered into. The permanent handle
 * is `visa_applications.conversation_id` (stamped once at bind, never overwritten), so
 * that column is read FIRST and the live binding only fills legacy rows that predate it.
 *
 * Both reads are scoped to the viewer (user_id / buyerProfileId), decrypt nothing, and
 * FAIL SOFT to whatever the other produced: a missing link degrades to the generic-start
 * CTA, which reuses the newest editable draft and re-binds it. A dead page would be the
 * worse failure.
 */
async function visaThreadsForViewer(): Promise<Record<string, string>> {
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

async function VisaCasesBody() {
  return <VisaCasesClient threads={await visaThreadsForViewer()} />
}

export default function VisaPage() {
  return (
    // Suspense: the client reads useSearchParams for the payment-return params.
    // ⚠️ ONE skeleton for this surface, imported — not a second hand-written copy. The
    // Suspense fallback here and the client's own auth gate both used to render the same
    // centred `min-h-[50vh]` Spinner, duplicated across two files, and neither had the shape
    // of the case list it hands over to.
    <Suspense fallback={<VisaCasesSkeleton />}>
      <VisaCasesBody />
    </Suspense>
  )
}
