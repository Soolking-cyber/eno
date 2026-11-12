import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell } from '@/components/admin/section-shell'
import { getAdmin } from '@/lib/admin'
import { partnerInboxCounts } from '@/lib/partner-inbox'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Partner inbox — eno.vn admin', robots: { index: false, follow: false } }

/**
 * THE PARTNER SHOPS' UNREAD CHATS, AS COUNTS (owner, 2026-11-12: "admins can check inbox messages for all partner shops from
 * one place"; then "Counter only, no reading" — src/lib/partner-inbox.ts). One row per partner shop: its unread chats and the
 * unread messages in them, as its own inbox counts them. ⛔ No message text, no customer, no thread link, no times: the partner
 * reads and answers in its own account; this page tells the team which shop has chats to answer.
 */
export default async function AdminPartnerInboxPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const inbox = await partnerInboxCounts()
  return (
    <AdminSectionShell
      title="Partner inbox"
      description="Unread customer chats in each partner shop. Counts only: partners read and answer in their own accounts."
      width="narrow"
    >
      <p className="mb-4 text-sm text-body">
        {inbox.unreadChats === 0
          ? 'No unread chat in any partner shop.'
          : `${inbox.unreadChats} unread chat${inbox.unreadChats === 1 ? '' : 's'} (${inbox.unreadMessages} unread message${inbox.unreadMessages === 1 ? '' : 's'}).`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink-4">
            <tr>
              <th className="py-2 pr-4 font-medium">Shop</th>
              <th className="py-2 pr-4 text-right font-medium">Unread chats</th>
              <th className="py-2 text-right font-medium">Unread messages</th>
            </tr>
          </thead>
          <tbody>
            {inbox.shops.map((s) => (
              <tr key={s.sellerId} className="border-t border-border">
                <td className="py-2 pr-4">
                  <Link href={`/sellers/${s.sellerId}`} className="text-foreground underline-offset-2 hover:underline">{s.name}</Link>
                </td>
                <td className={`py-2 pr-4 text-right tabular-nums ${s.unreadChats > 0 ? 'font-semibold text-foreground' : 'text-ink-4'}`}>{s.unreadChats}</td>
                <td className="py-2 text-right tabular-nums text-body">{s.unreadMessages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminSectionShell>
  )
}
