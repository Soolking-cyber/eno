'use client'

import { useLanguage } from '@/context/language-context'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

/**
 * WHAT A BUYER SEES WHILE THEY PAY.
 *
 * ⛔ IT RECEIVES AN SVG STRING, NOT BANK DETAILS. The account number never crosses to the client as
 * data — only as the modules of a code. The holder's NAME does cross, because a buyer confirming a
 * transfer in their banking app is shown a name and needs something to compare it against; that is
 * the one field where showing it is the safety feature.
 *
 * ⚠️ NO POLLING, DELIBERATELY. A VietQR payment settles through a bank webhook seconds to minutes
 * later, and a spinner that promises to notice would be lying about latency it does not control.
 * The page states plainly what happens next instead. When the order list exists, that is where a
 * buyer sees the state change.
 */

export function CheckoutView({
  reference, status, rail, amount, currency, listingTitle, sellerName, qrSvg, accountName, memo,
}: {
  reference: string
  status: string
  rail: string | null
  amount: number
  currency: string
  listingTitle: string | null
  sellerName: string | null
  qrSvg: string | null
  accountName: string | null
  memo: string | null
}) {
  const { tr, lang } = useLanguage()
  const money = formatMoneyFull(amount, currency, moneyLocale(lang))

  /**
   * ⛔ THE PAYMENT UI RENDERS FOR ONE STATUS AND EVERY OTHER GETS A SAFE ANSWER — an ALLOW-LIST, not
   * a list of bad states. The first version enumerated the endings it knew about, and a reviewer
   * pointed out that shape is what produced the bug the comment underneath it claimed to fix:
   * `cancelled` fell through to a payment prompt, and so would `pending`, and so will whatever
   * status is added next. Naming the one state in which asking for money is correct cannot rot.
   */
  const shell = (title: string, body: string) => (
    <main className="mx-auto max-w-md px-3 py-10 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  )

  if (status === 'paid' || status === 'fulfilled') {
    return shell(
      tr('Payment received', 'Đã nhận thanh toán'),
      tr(
        `We have matched your transfer of ${money}. The seller has been notified.`,
        `Chúng tôi đã đối chiếu khoản chuyển ${money} của bạn. Người bán đã được thông báo.`,
      ),
    )
  }

  if (status === 'refunded' || status === 'refund_due') {
    return shell(
      tr('This order was refunded', 'Đơn hàng đã được hoàn tiền'),
      tr('Please do not send another payment.', 'Vui lòng không chuyển khoản thêm.'),
    )
  }

  if (status !== 'awaiting_payment') {
    /**
     * ⚠️ THE CATCH-ALL, AND IT SAYS THE ONE THING TRUE OF EVERY REMAINING STATE: do not pay yet.
     * `cancelled`, `disputed`, `pending` and anything added later land here. Inviting a payment on
     * an order that is not waiting for one is the failure worth being blunt about; the message is
     * deliberately vague about WHY, because guessing wrongly would be worse than saying little.
     */
    return shell(
      tr('This order is not ready for payment', 'Đơn hàng chưa sẵn sàng thanh toán'),
      tr('Please do not send a payment for it. Check your messages.', 'Vui lòng không chuyển khoản cho đơn này. Hãy xem tin nhắn.'),
    )
  }

  return (
    <main className="mx-auto max-w-md px-3 py-10 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{tr('Scan to pay', 'Quét để thanh toán')}</CardTitle>
          <CardDescription>
            {/* ⚠️ JOINED, NOT INTERPOLATED. `${title} — ${seller ?? ''}` leaves a dangling em-dash
                when the seller name is null, which it is allowed to be. A reviewer found it. */}
            {[listingTitle, sellerName].filter(Boolean).join(' — ')
              || tr('Complete your payment', 'Hoàn tất thanh toán')}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col items-center gap-6">
          <p className="text-3xl font-bold tabular-nums">{money}</p>

          {qrSvg ? (
            <>
              {/* ⚠️ `dangerouslySetInnerHTML` ON SERVER-BUILT SVG, and the danger is real enough to
                  name: the string is assembled in qr-svg.ts from a payload this app built, and the
                  only interpolated text — the aria-label — is escaped there. No user input reaches
                  it. An <img src=data:…> would cost a base64 round-trip and lose crispness. */}
              <div
                className="rounded-2xl bg-white p-3"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <ol className="w-full list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>{tr('Open your banking app and scan this code.', 'Mở ứng dụng ngân hàng và quét mã này.')}</li>
                <li>
                  {tr(
                    'Check the amount and the account name before confirming.',
                    'Kiểm tra số tiền và tên tài khoản trước khi xác nhận.',
                  )}
                </li>
                <li>
                  {/* ⛔ THE MEMO IS THE ONLY THING TYING THE TRANSFER TO THIS ORDER. If a buyer
                      clears it — some apps let them — nothing can match the payment automatically,
                      so it is stated rather than assumed to survive. */}
                  {tr(
                    'Leave the transfer note exactly as it is. It is how we match your payment.',
                    'Giữ nguyên nội dung chuyển khoản. Đó là cách chúng tôi đối chiếu thanh toán của bạn.',
                  )}
                </li>
              </ol>

              <dl className="w-full space-y-2 rounded-xl bg-tint p-3 text-sm">
                {accountName && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{tr('Account name', 'Tên tài khoản')}</dt>
                    <dd className="font-semibold">{accountName}</dd>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{tr('Transfer note', 'Nội dung')}</dt>
                  <dd className="font-mono font-semibold tabular-nums">{memo ?? reference}</dd>
                </div>
              </dl>

              <p className="text-center text-xs text-muted-foreground">
                {tr(
                  'Payments usually appear within a minute. You can close this page — we will match it automatically.',
                  'Thanh toán thường xuất hiện trong vòng một phút. Bạn có thể đóng trang này — chúng tôi sẽ tự động đối chiếu.',
                )}
              </p>
            </>
          ) : (
            /**
             * ⛔ AN HONEST DEAD END RATHER THAN A BROKEN CODE. This is reached when the seller has
             * not saved payout details, or the order is on a rail this page does not draw. Showing
             * a placeholder QR would be worse than showing none: a buyer would scan it.
             */
            <div className="w-full rounded-xl bg-tint p-4 text-center text-sm text-muted-foreground">
              {rail === 'vietqr'
                ? tr(
                    'This seller has not finished setting up payments yet. Please message them.',
                    'Người bán chưa hoàn tất thiết lập thanh toán. Vui lòng nhắn tin cho họ.',
                  )
                : tr(
                    'This order is paid a different way. Check your messages for instructions.',
                    'Đơn hàng này thanh toán theo cách khác. Vui lòng xem tin nhắn để biết hướng dẫn.',
                  )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
