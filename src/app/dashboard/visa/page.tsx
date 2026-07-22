import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getCurrentProfile } from '@/lib/admin'
import { db } from '@/lib/db'
import { Spinner } from '@/components/ui/spinner'
import { VisaCasesClient } from './cases-client'

// /dashboard/visa — the applicant's e-Visa CASES, and the way back into the thread each
// one lives in. There is no form here any more (owner 2026-07-22: "only 1 way should exist
// through the chat"); the 1,960-line wizard that used to render at this route is deleted
// and every question it asked now belongs to the five step cards in the conversation.
// The section still exists because three things are not the chat's: seeing your cases, the
// provider payment return, and the final prefill authorization — see cases-client.tsx.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vietnam e-Visa | eno.vn',
  robots: { index: false, follow: false },
}

/**
 * applicationId → the conversation bound to it.
 *
 * The binding is `Conversation.visaApplicationId` (@unique, written server-side only after
 * visa_applications.user_id has been proved to equal the buyer), so this is a plain scoped
 * read of the VIEWER'S OWN threads — it touches no visa row, decrypts nothing, and can
 * never expose a case id that is not already the caller's.
 *
 * FAILS SOFT to an empty map: a missing link degrades to the picker, which reuses the same
 * draft (startVisaDmFlow prefers the newest editable case) and re-binds it. A dead page
 * would be the worse failure.
 */
async function visaThreadsForViewer(): Promise<Record<string, string>> {
  try {
    const profile = await getCurrentProfile()
    // Guests are handled by the client's own sign-in gate (the sibling dashboard
    // sections' idiom) — no server redirect here, so a cold native start with a
    // still-warming cookie cannot bounce between /signin and the dashboard.
    if (!profile) return {}
    const rows = await db.conversation.findMany({
      where: { buyerProfileId: profile.id, visaApplicationId: { not: null }, sellerProfileId: { not: null } },
      select: { id: true, visaApplicationId: true },
    })
    const threads: Record<string, string> = {}
    for (const row of rows) if (row.visaApplicationId) threads[row.visaApplicationId] = row.id
    return threads
  } catch (error) {
    // Ids only, never an applicant value — this page is one hop from passport data.
    console.error('[dashboard/visa] thread map read failed', (error as Error)?.message?.slice(0, 200))
    return {}
  }
}

async function VisaCasesBody() {
  return <VisaCasesClient threads={await visaThreadsForViewer()} />
}

export default function VisaPage() {
  return (
    // Suspense: the client reads useSearchParams for the payment-return params.
    <Suspense
      fallback={
        <div role="status" className="flex min-h-[50vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      <VisaCasesBody />
    </Suspense>
  )
}
