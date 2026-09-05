import { listKycQueue } from '@/lib/kyc/review'
import { Card } from '@/components/ui/card'
import { IdentityReviewPanel } from '@/app/admin/identity/review-panel'

/**
 * THE IDENTITY REVIEW QUEUE — STAGE 1 OF TWO. A person verifies themselves here; their business is
 * verified separately under the Business tab of the same section.
 *
 * ⛔ THIS QUEUE IS WHY STAGE 1 CAN BE TURNED ON AT ALL. `reviewKycCase()` and `listKycQueue()` were
 * both written, tested and reachable only by curl; without a screen every submission parks at
 * `pending` for ever. It DID happen: the page existed at /admin/identity but was never in the admin
 * navigation, and by 2026-09-05 two passports had sat pending for two days with nobody able to find
 * the queue (owner: "the admin has no way to verify kyc currently"). It is a tab of Verification now.
 *
 * ⚠️ BOTH TIERS LAND HERE. Tier B is a foreign passport; tier A is a Vietnamese CCCD, reviewed by
 * eye in v1 (owner, 2026-08-31) until VNPT eKYC is hooked up.
 */
export async function IdentityQueue() {
  const cases = await listKycQueue()
  return (
    <section aria-labelledby="identity-queue">
      <h2 id="identity-queue" className="sr-only">Identity verification queue</h2>
      {/*
        ⛔ THE LEGAL CEILING, STATED ON THE SCREEN WHERE THE DECISION IS MADE. Decree 69/2024 Art 3.6
        reserves "xác thực điện tử" to the national system, so what an admin does here is a
        documentary check, not statutory authentication.
      */}
      <p className="mb-4 rounded-xl bg-tint p-3 text-xs text-muted-foreground">
        This is a documentary check, not <span className="italic">xác thực điện tử</span> under Decree
        69/2024 — that runs only through the national system. Approving here records that a person
        presented a document and matched it; it does not assert the State has confirmed them.
      </p>
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
    </section>
  )
}
