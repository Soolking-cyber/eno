import 'server-only'
import { logError } from '@/lib/log'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { TriangleAlert } from '@/components/ui/icons'
import { formatMoneyFull } from '@/lib/vnd'
import { adminBankOrders } from '@/lib/ads/bank'
import { AdBankOrderActions } from '@/components/admin/ad-bank-order-actions'

/**
 * ADS › AWAITING TRANSFER (owner 2026-11-25: ads paid by VietQR bank transfer, "ADMIN CONFIRMS"). Every order whose money has
 * not been confirmed, newest first, with what an admin matches against the bank statement: the reference, the amount,
 * the shop, what it advertises, the period and when it was made. Mark paid starts the ad (src/lib/ads/bank.ts
 * markBankOrderPaid); Cancel closes the order for good. Orders that lapsed, or that the shop cancelled (it may have paid
 * first), in the last 30 days stay listed, so a transfer that lands on one is still found by its reference. Server-rendered behind the Catalogue page's getAdmin(); the buttons' API re-checks
 * it. Admin chrome: English only.
 */
const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
const PERIOD = { week: 'Week', month: 'Month', quarter: 'Quarter' } as const

export async function AdBankOrders() {
  let orders: Awaited<ReturnType<typeof adminBankOrders>>
  try {
    orders = await adminBankOrders()
  } catch (e) {
    logError(e, { op: 'admin.adBankOrders' })
    return (
      <Alert tone="destructive" icon={<TriangleAlert className="h-4 w-4" />} title="The bank-transfer orders could not be read">
        The database read failed — reload.
      </Alert>
    )
  }
  return (
    <section aria-labelledby="ad-bank-orders-title" className="space-y-3">
      <div>
        <h2 id="ad-bank-orders-title" className="text-base font-semibold text-foreground">Awaiting transfer</h2>
        <p className="text-sm text-muted-foreground">
          Ads paid by VietQR bank transfer. Match the reference and the amount on the bank statement, then Mark paid: the ad
          starts now, or after the same target&apos;s running ad, and the shop is told. Expired orders and ones the shop
          cancelled stay here for 30 days: if money arrived on one, Mark paid or refund it; Cancel closes an order for good.
        </p>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No order is awaiting a transfer.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Card className="space-y-1.5 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-foreground">{o.reference}</span>
                  <span className="font-semibold tabular-nums text-foreground">{formatMoneyFull(o.amountVnd, '₫')}</span>
                  {o.status === 'expired' && <Badge variant="warning">Expired</Badge>}
                  {o.status === 'cancelled' && <Badge variant="neutral">Cancelled by the shop</Badge>}
                  {o.payerPaidAt && o.status === 'awaiting_transfer' && <Badge variant="warning">Shop says paid {utc(o.payerPaidAt)}</Badge>}
                </div>
                <p className="text-foreground">
                  {o.kind === 'creative' ? 'Own ad' : 'Listing'}: {o.target ?? o.targetId} · {PERIOD[o.period]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {o.shop ?? 'Shop'} ({o.sellerId}) · ordered {utc(o.createdAt)}{o.status === 'awaiting_transfer' ? ` · expires ${utc(o.expiresAt)}` : o.status === 'expired' ? ` · lapsed ${utc(o.expiresAt)}` : ''}
                </p>
                <AdBankOrderActions adId={o.id} reference={o.reference} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
