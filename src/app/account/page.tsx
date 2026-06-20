import type { Metadata } from 'next'
import { AccountClient } from './account-client'

export const metadata: Metadata = { title: 'My account — ENO', robots: { index: false, follow: false } }

// Static shell → the client component paints instantly from a localStorage cache
// of the account (profile + my listings) and revalidates via /api/account, so
// businesses checking their offerings feel no lag.
export default function AccountPage() {
  return <AccountClient />
}
