'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { BANK_PERIOD } from '@/lib/ads/bank-periods'
import type { BankOrderView } from '@/lib/ads/bank'
import type { PaySummary } from '@/lib/ucp/checkout'
import { OrderPay, orderErrorText } from '../../ad-order'

/**
 * A UCP checkout's continue_url (src/lib/ucp/checkout.ts): the ad an AI agent put together, and one button that makes the
 * ads' own bank order (createBankOrder — only the listing's own shop can) and shows its VietQR and "I've paid" (OrderPay,
 * the dashboard's own). Once this shop has the order, it is shown again on every visit.
 */
class PayFetchError extends Error {
  constructor(public status: number) { super(`ucp pay ${status}`) }
}

export function UcpPayClient({ id }: { id: string }) {
  const { tr, lang } = useLanguage()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [made, setMade] = useState<BankOrderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { data, error: loadError, isLoading } = useQuery({
    // Keyed by who is signed in: signing in on this page reads it again (no reload needed).
    queryKey: ['ucp-pay', id, user?.id ?? null],
    queryFn: async (): Promise<PaySummary> => {
      const res = await fetch(`/api/ads/ucp/${encodeURIComponent(id)}`, { cache: 'no-store' })
      if (!res.ok) throw new PayFetchError(res.status)
      return ((await res.json()) as { checkout: PaySummary }).checkout
    },
    retry: (n, e) => !(e instanceof PayFetchError && (e.status === 401 || e.status === 404)) && n < 2,
    // While another press holds the checkout (it clears in seconds, or becomes an order), look again.
    refetchInterval: (q) => (q.state.data?.claimed ? 5_000 : false),
    staleTime: 0,
    gcTime: 0,
  })
  const status = loadError instanceof PayFetchError ? loadError.status : null
  const title = <PageHeader title={tr('Pay for your ad', 'Thanh toán quảng cáo')} />

  if (isLoading) return <>{title}<div className="h-40 animate-pulse rounded-2xl bg-muted" /></>
  if (status === 401) return <>{title}<EmptyState title={tr('Sign in with the shop that owns this listing.', 'Đăng nhập bằng cửa hàng sở hữu tin này.')} action={<SignInPrompt />} /></>
  if (!data) return <>{title}<EmptyState title={status === 404 ? tr('This payment link has expired.', 'Liên kết thanh toán này đã hết hạn.') : orderErrorText(tr, undefined)} /></>

  const order = made ?? data.order
  const amount = formatMoneyFull(order?.amount_vnd ?? data.amountVnd, '₫', moneyLocale(lang))
  const days = BANK_PERIOD[data.period].days
  const pay = async () => {
    setBusy(true); setError('')
    try {
      // The line this page shows: the server makes the order only for it, else answers `changed`.
      const res = await fetch(`/api/ads/ucp/${encodeURIComponent(id)}/order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId: data.listingId, period: data.period }) })
      const body = (await res.json().catch(() => ({}))) as { order?: BankOrderView; error?: string; reason?: string }
      if (res.ok && body.order) setMade(body.order)
      else {
        setError(payErrorText(tr, body.error, body.reason))
        if (body.error === 'changed') void qc.invalidateQueries({ queryKey: ['ucp-pay', id] })
      }
    } catch {
      // The network dropped: say so and give the button back (pressing again shows the order if one was made).
      setError(orderErrorText(tr, undefined))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {title}
      <Card className="mx-auto max-w-md space-y-4 p-4">
        <div>
          <p className="text-t-card font-semibold">{data.title}</p>
          <p className="text-t-meta text-muted-foreground">{tr('Ad', 'Quảng cáo')} · {days} {tr('days', 'ngày')} · {amount}</p>
          <p className="text-t-meta text-muted-foreground">{tr('Started by an AI assistant. Pay only if you asked for this ad.', 'Do một trợ lý AI tạo. Chỉ thanh toán nếu bạn đã yêu cầu quảng cáo này.')}</p>
        </div>
        {order ? <OrderPay key={order.id} order={order} />
          : data.canceled ? <p className="text-t-meta text-muted-foreground">{tr('This payment was cancelled.', 'Thanh toán này đã bị hủy.')}</p>
          : data.claimed ? <p className="text-t-meta text-muted-foreground">{tr('This ad is already being paid for.', 'Quảng cáo này đang được thanh toán.')}</p>
          : (
            <>
              {error && <p role="alert" className="text-t-meta text-destructive">{error}</p>}
              <Button type="button" variant="cta" className="w-full" loading={busy} disabled={busy} onClick={() => { void pay() }}>
                {tr('Pay by bank transfer', 'Thanh toán bằng chuyển khoản')} · {amount}
              </Button>
            </>
          )}
      </Card>
    </>
  )
}

function payErrorText(tr: (en: string, vi: string) => string, code?: string, reason?: string): string {
  switch (code) {
    case 'canceled': return tr('This payment was cancelled.', 'Thanh toán này đã bị hủy.')
    case 'taken': return tr('This ad is already being paid for.', 'Quảng cáo này đang được thanh toán.')
    case 'busy': return tr('Still working on it. Try again in a moment.', 'Đang xử lý. Hãy thử lại sau giây lát.')
    case 'not_found': return tr('This payment link has expired.', 'Liên kết thanh toán này đã hết hạn.')
    case 'changed': return tr('This ad changed. Check it, then pay.', 'Quảng cáo này đã thay đổi. Hãy kiểm tra rồi thanh toán.')
    case 'order_unavailable': return tr('This order can\'t be shown here. Contact eno.vn.', 'Không thể hiển thị đơn này tại đây. Hãy liên hệ eno.vn.')
    default: return orderErrorText(tr, code, reason)
  }
}
