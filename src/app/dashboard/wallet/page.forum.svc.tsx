import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SITE_NAME } from '@/lib/edition'
import { WalletClient } from './wallet-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Wallet | ${SITE_NAME}`,
  // ⛔ NEVER INDEXED. The page names a wallet address and a balance belonging to one person.
  robots: { index: false, follow: false },
}

/**
 * THE SETTLEMENT WALLET A VERIFIED SELLER HOLDS.
 *
 * ⛔ `.forum.svc.`, NOT `.svc.` — the second tier, which no marketplace build lists at any flag
 * setting. Production eno.vn builds with `MARKETPLACE_HOSTS_SERVICES=true` so it can host the
 * partner's visa chat, and that flag pulls every plain `.svc.` route INTO the licensed company's
 * build. Written first as `page.svc.tsx`, this page was measured serving `Wallet | eno.vn` on a
 * clean marketplace build. Payments keep the stricter infix — see the route file next to it.
 *
 * ⚠️ A SHELL, LIKE `/dashboard/payout`. Everything here is per-session and `no-store` — an address,
 * a live balance, and a reason that changes the moment counsel opens a jurisdiction — so it is
 * fetched by the client rather than threaded through the RSC payload.
 */
export default function WalletPage() {
  return (
    <Suspense>
      <WalletClient />
    </Suspense>
  )
}
