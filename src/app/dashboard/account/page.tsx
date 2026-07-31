import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { AccountClient } from './account-client'

// The mobile account DESTINATION (dashboard native-feel lane, owner 2026-07-24). See
// account-client.tsx for why this replaced a full-screen overlay, and why it lives here rather
// than at /dashboard — both external reviewers refused the /dashboard version, since desktop
// lands there and would have been dropped onto a link list instead of its listings.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Account | ${SITE_NAME}`,
  // A signed-in hub: never indexable, and nothing here should follow out.
  robots: { index: false, follow: false },
}

// No server auth gate on purpose. Every sibling section renders its own client shell and lets
// the shared auth context gate — a server redirect here would fight the client-side session
// restore and produce the signin↔dashboard bounce the /dashboard route's comment warns about.
export default function AccountPage() {
  return <AccountClient />
}
