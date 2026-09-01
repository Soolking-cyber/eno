import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { listKycQueue } from '@/lib/kyc/review'
import { Card } from '@/components/ui/card'
import { IdentityReviewPanel } from './review-panel'

/**
 * ⛔ NEVER STATICALLY RENDERED AND NEVER CACHED. The rows carry 10-minute signed URLs to passport
 * and CCCD photographs, minted per request. A cached render is an expired link at best and, at
 * worst, one viewer's document URLs served to the next — which is why `force-dynamic` here is a
 * privacy control rather than a freshness preference. agy named framework caching as the most
 * likely thing to get wrong on this screen.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const metadata: Metadata = {
  title: 'Identity verification — eno.vn admin',
  robots: { index: false, follow: false },
}

/**
 * THE IDENTITY REVIEW QUEUE — STAGE 1 OF TWO.
 *
 * ⛔ THIS PAGE IS WHY STAGE 1 CAN BE TURNED ON AT ALL. `reviewKycCase()` and `listKycQueue()` were
 * both written, tested and reachable only by curl; without a screen, every submission would park at
 * `pending` for ever and nobody would ever reach stage 2. Both plan reviewers said the same thing
 * when asked which half to ship first: the admin side, because it is inert until a submission
 * arrives, whereas an applicant screen shipped alone manufactures a backlog of identity documents
 * nobody can action.
 *
 * ⚠️ EN-ONLY, by the repo convention that admin chrome is never localised.
 *
 * ⚠️ BOTH TIERS LAND HERE. Tier B is a foreign passport; tier A is a Vietnamese CCCD, reviewed by
 * eye in v1 (owner, 2026-08-31). The queue used to filter `tier: 'B'`, which would have accepted
 * CCCD submissions and then never shown them to anyone.
 */
export default async function AdminIdentityPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />

  const cases = await listKycQueue()

  return (
    <main className="mx-auto w-full max-w-4xl px-3 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="h-display text-foreground">Identity verification</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Stage 1 of two. A person verifies themselves here; their business is verified separately
          under Business verification.
        </p>
        {/*
          ⛔ THE LEGAL CEILING, STATED ON THE SCREEN WHERE THE DECISION IS MADE. Decree 69/2024
          Art 3.6 reserves "xác thực điện tử" to the national system, so what an admin does here is
          a documentary check, not statutory authentication. A reviewer who believes otherwise will
          over-trust their own approval — and the record, not the check, is the defence.
        */}
        <p className="mt-2 rounded-xl bg-tint p-3 text-xs text-muted-foreground">
          This is a documentary check, not <span className="italic">xác thực điện tử</span> under
          Decree 69/2024 — that runs only through the national system. Approving here records that a
          person presented a document and matched it; it does not assert the State has confirmed them.
        </p>
      </header>

      {cases.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Nothing waiting for review.</Card>
      ) : (
        <ul className="space-y-4">
          {cases.map((c) => (
            <li key={c.id}>
              <IdentityReviewPanel item={c} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
