'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Check, Copy } from '@/components/ui/icons'
import { formatTokenAmount } from '@/lib/payments/token-amount'

/**
 * THE WALLET PAGE.
 *
 *
 * ⛔ IT RENDERS NO `<main>` — `dashboard/layout.tsx` ALREADY OWNS ONE. This section mounts inside
 * `<main id="main" class="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8">`, so nesting a second
 * one put a landmark inside a landmark (two `<main>`s on one page, which breaks the skip link and
 * every screen-reader's "jump to main") AND doubled the horizontal padding — worst on the narrow
 * screens this is meant to serve. Every sibling section returns a fragment for exactly this reason.
 * `max-w-lg` stays, as a self-imposed measure on a short form inside a wide container.
 *
 * ⚠️ `<SectionHeader>` IS THE MOBILE CHROME AND IT IS `lg:hidden`. On a phone a dashboard section is
 * a pushed screen and needs a back affordance; on desktop the nav rail is always visible and the
 * bar would be redundant, so it disappears rather than being restyled.
 * ⛔ EVERY STATE SAYS WHAT IS ACTUALLY TRUE, INCLUDING THE BORING ONES. Today, in production,
 * essentially every verified user lands on `awaiting_residence` or `awaiting_allowlist` — nobody
 * has opened a settlement jurisdiction yet. A page that answered "not available" would be
 * indistinguishable from a page that was broken, and would send those users to support.
 *
 * ⚠️ THE REASON IS READ, NEVER CREATED, ON LOAD. The API's GET walks the same eligibility ladder
 * provisioning walks but stops before the provider call — so opening this page cannot cost money.
 */

type Balance = { token: string; rawAmount: string; decimals: number }
type View = {
  state: 'ready' | 'eligible' | 'blocked'
  address?: string
  chain?: string
  balances?: Balance[] | null
  reason?: string
  fundable?: boolean
}

export function WalletClient() {
  const { tr } = useLanguage()
  const [view, setView] = useState<View | null>(null)
  const [blocked, setBlocked] = useState<'signed_out' | null>(null)
  const [busy, setBusy] = useState<'provision' | 'fund' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * ⚠️ A FLAG, NOT A PRE-RENDERED SENTENCE. Storing the translated string would freeze it in the
   * language it failed in — a reader who then switches language keeps reading the old one. Every
   * other message here is produced during render for the same reason; this one has to be a flag
   * because `load` deliberately does not depend on `tr`.
   */
  const [failedToLoad, setFailedToLoad] = useState(false)
  const [copied, setCopied] = useState(false)
  // ⚠️ THE TIMER IS HELD SO IT CAN BE REPLACED AND CLEARED. codex found that repeated clicks each
  // started their own timeout, so an earlier one would clear the "Copied" state while a later
  // click was still fresh — and any pending one fired after unmount, setting state on a gone
  // component.
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  /**
   * ⛔ IT CANNOT REJECT. Both reviewers found the bare `fetch`: offline, a DNS failure or a torn
   * connection makes it throw, which here became an unhandled rejection AND left the page on
   * "Loading…" forever, with no error and no way back. A network failure is the ordinary case this
   * page must survive, not an exception.
   * ⚠️ AND A SUCCESS CLEARS A PREVIOUS ERROR. Both reviewers found that too — without it the first
   * failure's message stayed on screen under a perfectly good wallet after a retry succeeded.
   * ⚠️ NO `tr` IN THE DEPS. It is not stable across a language switch, so depending on it re-ran
   * the effect and fired a redundant request every time the reader changed language (agy). The
   * message is built inside the call, so the closure reads the current `tr` anyway.
   */
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/wallet', { cache: 'no-store' })
      if (r.status === 401) { setBlocked('signed_out'); return }
      if (!r.ok) { setFailedToLoad(true); return }
      setView((await r.json()) as View)
      setFailedToLoad(false)
      setError(null)
    } catch {
      setFailedToLoad(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function act(action: 'provision' | 'fund') {
    setBusy(action)
    setError(null)
    try {
      const r = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!r.ok) {
        // ⚠️ 429 IS ITS OWN SENTENCE. "Something went wrong" over a rate limit sends someone to
        // support for a wait; the limiter is strict and low precisely because these actions cost
        // money at a third party, so hitting it is an ordinary outcome and should read like one.
        setError(r.status === 429
          ? tr('Too many attempts. Please try again later.', 'Quá nhiều lần thử. Vui lòng thử lại sau.')
          : tr('That did not work. Please try again.', 'Chưa thực hiện được. Vui lòng thử lại.'))
        return
      }
      const body = (await r.json()) as View & { outcome?: string }
      setView(body)
      /**
       * ⚠️ A 200 IS NOT SUCCESS FOR PROVISIONING. `provisionWithinBudget` NEVER throws — it returns
       * 200 with `outcome: 'failed' | 'timed_out' | 'pending_provider'` when the provider is down,
       * slow, or unconfigured. Without this the button would just spin, stop, and show the
       * unchanged "Open my wallet" — the reviewer's finding — so the user retries and burns the
       * strict 6/hour limiter before ever seeing a word. A failure outcome gets its own sentence;
       * a success (`created`/`existing`) or an ordinary `awaiting_*`/`blocked` state does not (the
       * page's state cards already speak for those).
       */
      if (action === 'provision' && ['failed', 'timed_out', 'pending_provider'].includes(body.outcome ?? '')) {
        setError(tr(
          'We could not open your wallet just now. Please try again in a little while.',
          'Chưa mở được ví của bạn lúc này. Vui lòng thử lại sau ít phút.',
        ))
      }
    } catch {
      setError(tr('That did not work. Please try again.', 'Chưa thực hiện được. Vui lòng thử lại.'))
    } finally {
      setBusy(null)
    }
  }

  /**
   * ⚠️ EVERY OUTCOME HAS A SENTENCE, AND THE `awaiting_*` ONES ARE ABOUT US, NOT ABOUT THE READER.
   * `on-verified.ts` draws that line deliberately — "the law says no, never re-drive" is a
   * different fact from "counsel has not added your country yet" — and a UI that blurred them
   * would tell a perfectly eligible person they had been refused.
   */
  function reasonText(reason: string): { title: string; body: string } {
    switch (reason) {
      case 'awaiting_residence':
        return {
          title: tr('We need to confirm where you live', 'Chúng tôi cần xác nhận nơi bạn cư trú'),
          body: tr(
            'Your identity is verified. Confirming your country of residence is the last step before a wallet can be opened.',
            'Danh tính của bạn đã được xác minh. Xác nhận quốc gia cư trú là bước cuối trước khi mở ví.',
          ),
        }
      case 'awaiting_allowlist':
      case 'awaiting_jurisdiction':
        return {
          title: tr('Not open in your country yet', 'Chưa mở tại quốc gia của bạn'),
          body: tr(
            'Wallets are being opened country by country. Yours is not enabled yet — nothing is wrong with your account, and we will let you know when it is.',
            'Ví đang được mở lần lượt theo từng quốc gia. Quốc gia của bạn chưa được bật — tài khoản của bạn hoàn toàn bình thường, và chúng tôi sẽ báo khi có thể dùng.',
          ),
        }
      case 'skipped_unverified':
        return {
          title: tr('Verify your identity first', 'Xác minh danh tính trước'),
          body: tr(
            'A wallet can only be opened for a verified account.',
            'Ví chỉ có thể mở cho tài khoản đã xác minh danh tính.',
          ),
        }
      case 'skipped_ineligible':
        return {
          title: tr('Not available for your account', 'Không khả dụng cho tài khoản của bạn'),
          body: tr(
            'A wallet cannot be opened for your country. You can still be paid by bank transfer.',
            'Không thể mở ví cho quốc gia của bạn. Bạn vẫn có thể nhận tiền qua chuyển khoản ngân hàng.',
          ),
        }
      case 'unmappable_nationality':
        return {
          title: tr('We need to check your details', 'Chúng tôi cần kiểm tra lại thông tin'),
          body: tr(
            'Something on your verified record needs a person to look at it. Please contact support.',
            'Một số thông tin đã xác minh cần được kiểm tra thủ công. Vui lòng liên hệ hỗ trợ.',
          ),
        }
      case 'wrong_chain':
        return {
          title: tr('We need to check your wallet', 'Chúng tôi cần kiểm tra ví của bạn'),
          body: tr(
            'Your wallet was opened on a different network and cannot be used here. Please contact support.',
            'Ví của bạn được mở trên một mạng khác và không dùng được ở đây. Vui lòng liên hệ hỗ trợ.',
          ),
        }
      /**
       * ⚠️ `pending_provider`, `timed_out` AND `failed` ARE OURS TO FIX AND SAY SO. The first is an
       * environment without credentials, the others a call that did not land — none of them is
       * anything the reader did, and none should read as a refusal.
       */
      default:
        return {
          title: tr('Not ready yet', 'Chưa sẵn sàng'),
          body: tr(
            'Wallets are not switched on yet. Nothing is needed from you.',
            'Ví chưa được bật. Bạn không cần làm gì thêm.',
          ),
        }
    }
  }

  if (blocked === 'signed_out') {
    return (
      <>
      {/* Native stack-nav title bar (mobile only) — the same string the desktop heading uses. */}
      <SectionHeader title={tr('Your wallet', 'Ví của bạn')} />
      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>{tr('Please sign in', 'Vui lòng đăng nhập')}</CardTitle>
            <CardDescription>{tr('Sign in to see your wallet.', 'Đăng nhập để xem ví của bạn.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* ⚠️ `asChild`, NOT `render` — ui/button is the documented exception that bridges the
                two conventions. And `/signin`, not `/sign-in`: the latter is not a route. */}
            <Button variant="cta" asChild className="w-full">
              <a href={`/signin?next=${encodeURIComponent('/dashboard/wallet')}`}>{tr('Sign in', 'Đăng nhập')}</a>
            </Button>
          </CardContent>
        </Card>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Native stack-nav title bar (mobile only) — the same string the desktop heading uses. */}
      <SectionHeader title={tr('Your wallet', 'Ví của bạn')} />
      <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>{tr('Your wallet', 'Ví của bạn')}</CardTitle>
          <CardDescription>
            {tr(
              'Buyers outside Vietnam can pay you in US dollars. The money arrives here.',
              'Người mua ở nước ngoài có thể thanh toán bằng đô la Mỹ. Tiền sẽ về đây.',
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {failedToLoad && (
            <p role="alert" className="text-sm text-muted-foreground">
              {tr('We could not load your wallet. Please try again.', 'Không tải được ví của bạn. Vui lòng thử lại.')}
            </p>
          )}

          {!view && !failedToLoad && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {tr('Loading…', 'Đang tải…')}
            </p>
          )}

          {view?.state === 'ready' && (
            <>
              <div className="rounded-xl bg-tint p-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  {tr('Balance', 'Số dư')}
                </p>
                {/**
                  * ⛔ THREE STATES, NOT TWO. `null` means the provider did not answer or answered in
                  * a shape we do not recognise — agy's finding. Rendering that as "0" would tell a
                  * funded seller their money is gone, which is the worst sentence on this page.
                  */}
                {view.balances === null ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tr('We could not read your balance just now.', 'Hiện chưa đọc được số dư của bạn.')}
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {/* ⚠️ AN EMPTY LIST IS RENDERED AS AN EXPLICIT ZERO ROW, not as a bare "0"
                        literal in the markup. Crossmint returns no row at all for a token the
                        wallet has never held, and a new wallet holds nothing — so this is the
                        FIRST thing every seller sees, and "0 USDC" says more than an unlabelled
                        numeral. It also keeps every amount on this page coming from
                        `formatTokenAmount`, so there is one formatter, not one plus a special
                        case. */}
                    {(view.balances && view.balances.length > 0
                      ? view.balances
                      : [{ token: 'usdc', rawAmount: '0', decimals: 6 }]
                    ).map((b) => {
                      const amount = formatTokenAmount(b.rawAmount, b.decimals)
                      return (
                        <li key={b.token} className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold tabular-nums">
                            {/* ⚠️ `null` HERE IS AN UNREADABLE AMOUNT, NOT A ZERO — same rule as
                                above, one level down. */}
                            {amount ?? tr('Unavailable', 'Không đọc được')}
                          </span>
                          <span className="text-sm font-semibold uppercase text-muted-foreground">{b.token}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  {tr('Wallet address', 'Địa chỉ ví')}
                </p>
                {/* ⚠️ `break-all` — an EVM address is 42 unbroken characters and overflows a phone
                    without it. It is shown in full on purpose: this is the reader's own wallet, the
                    address is public on-chain, and a truncated one cannot be checked against a
                    block explorer. */}
                <p className="mt-1 font-mono text-xs break-all">{view.address}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      // ⚠️ GUARDED. `navigator.clipboard` is absent over plain http and can reject
                      // when the document is not focused; an unhandled rejection here would be an
                      // error in the console and no feedback at all on the page.
                      try {
                        await navigator.clipboard.writeText(view.address ?? '')
                        setCopied(true)
                        if (copyTimer.current) clearTimeout(copyTimer.current)
                        copyTimer.current = setTimeout(() => setCopied(false), 1500)
                      } catch { /* the address is on screen and selectable — copying is a convenience */ }
                    }}
                  >
                    {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                    {copied ? tr('Copied', 'Đã sao chép') : tr('Copy', 'Sao chép')}
                  </Button>
                  <span className="text-xs text-muted-foreground">{view.chain}</span>
                </div>
              </div>

              {/* ⛔ TEST MONEY, AND IT SAYS SO. The server only offers this on a staging API key —
                  a production key cannot reach the endpoint at all — but the button still names
                  what it does, because a button that adds money without saying it is test money is
                  the one a person screenshots. */}
              {view.fundable && (
                <div className="rounded-xl border border-dashed border-line-strong p-3">
                  <p className="text-xs text-muted-foreground">
                    {tr('Test environment', 'Môi trường thử nghiệm')}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    disabled={busy !== null}
                    onClick={() => void act('fund')}
                  >
                    {busy === 'fund' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    {tr('Add 10 test USD', 'Thêm 10 USD thử nghiệm')}
                  </Button>
                </div>
              )}
            </>
          )}

          {view?.state === 'eligible' && (
            <>
              <p className="text-sm text-muted-foreground">
                {tr(
                  'You can open a wallet now. It takes a moment and costs nothing.',
                  'Bạn có thể mở ví ngay. Chỉ mất một chút thời gian và hoàn toàn miễn phí.',
                )}
              </p>
              <Button
                variant="cta"
                className="w-full"
                disabled={busy !== null}
                onClick={() => void act('provision')}
              >
                {busy === 'provision' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {tr('Open my wallet', 'Mở ví của tôi')}
              </Button>
            </>
          )}

          {view?.state === 'blocked' && view.reason && (
            <div className="rounded-xl bg-tint p-4">
              <p className="text-sm font-semibold">{reasonText(view.reason).title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{reasonText(view.reason).body}</p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs font-semibold text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>
      </div>
    </>
  )
}
