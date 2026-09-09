'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

/**
 * A comparable snapshot of what the wallet holds.
 *
 * ⚠️ `null` AND `[]` ARE DIFFERENT ANSWERS AND MUST NOT COLLAPSE HERE EITHER. `null` means the
 * provider could not be read; `[]` means it was read and the wallet is empty. Folding them together
 * would make a provider outage look like "the balance changed" the moment it recovered, and end the
 * poll on a lie. They get distinct keys.
 * ⚠️ BUILT FROM `rawAmount` — the base-unit field — for the same reason the parser is strict about
 * it: `amount` is a rounded display string and two different balances can share one.
 */
/** A USD amount for the card charge. Not `tr()`: there is no wording here, only a number. */
const usd = (v: string) => `$${v}`

function balanceKey(v: View | null): string {
  if (!v || v.balances === undefined) return 'unknown'
  if (v.balances === null) return 'unreadable'
  return v.balances.map((b) => `${b.token}:${b.rawAmount}`).sort().join('|')
}

export function WalletClient({ embedded = false }: { embedded?: boolean } = {}) {
  const { tr } = useLanguage()
  const [view, setView] = useState<View | null>(null)
  const [blocked, setBlocked] = useState<'signed_out' | null>(null)
  const [busy, setBusy] = useState<'provision' | 'fund' | 'topup' | null>(null)
  /**
   * ⛔ THE CHECKOUT IS AN IFRAME BECAUSE THERE IS NOWHERE TO COME BACK FROM. Crossmint's embedded
   * checkout URL takes exactly five parameters — orderId, clientSecret, apiKey, payment, appearance
   * — and NONE of them is a return, success or callback URL. A top-level redirect would strand the
   * buyer on crossmint.com with no documented way back and no way for this page to hear the result.
   * Keeping the page mounted is what makes the poll below possible.
   */
  const [topup, setTopup] = useState<{ orderId: string; checkoutUrl: string } | null>(null)
  const [topupAmount, setTopupAmount] = useState('25')
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

  async function startTopup() {
    setBusy('topup')
    setError(null)
    try {
      const r = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'topup', amountUsd: topupAmount }),
      })
      if (!r.ok) {
        setError(r.status === 429
          ? tr('Too many attempts. Please try again later.', 'Quá nhiều lần thử. Vui lòng thử lại sau.')
          : tr('Top-up is unavailable right now.', 'Hiện chưa thể nạp tiền.'))
        return
      }
      const body = (await r.json()) as { orderId: string; checkoutUrl: string }
      /**
       * ⛔ THE BASELINE IS READ FRESH, NOT TAKEN FROM `view`. `view` holds whatever was fetched on
       * MOUNT, so a balance that moved since page load — an earlier top-up settling late, an
       * incoming transfer, a faucet click in another tab — made the very first tick differ and tore
       * the checkout down at t+3s while the buyer was still typing their card number. The
       * unknown/unreadable guard covers a MISSING snapshot; this covers a STALE one, and they are
       * different bugs (the Opus seat, twice, 2026-09-09).
       */
      let baseline = 'unknown'
      try {
        const fresh = await fetch('/api/wallet', { cache: 'no-store' })
        if (fresh.ok) baseline = balanceKey((await fresh.json()) as View)
      } catch { /* an unreadable baseline is handled by pollBalance, not here */ }
      setTopup(body)
      void pollBalance(baseline)
    } catch {
      setError(tr('Top-up is unavailable right now.', 'Hiện chưa thể nạp tiền.'))
    } finally {
      setBusy(null)
    }
  }

  /**
   * ⛔ POLL THE USER'S OWN BALANCE, NOT THE ORDER — AND THE FIRST CUT GOT THIS BADLY WRONG TWICE.
   * It POSTed a `topup_status` action every 3 seconds against a route whose limiter is SIX PER HOUR
   * and strict, so the seventh request — at t+18s — 429'd and the loop exited silently, while card
   * entry plus 3-D Secure takes 30 to 120 seconds. The buyer never saw their balance update, the
   * iframe kept promising it would, and they were locked out of provision, fund and topup for the
   * rest of the hour. Calling that loop "bounded" because the limiter was low had it exactly
   * backwards (the Opus seat, on the diff, 2026-09-09).
   *
   * ⛔ AND POLLING AN ORDER ID WAS AN OWNERSHIP HOLE ON TOP OF THAT. Nothing persists an order, so
   * there was no profileId to check the id against — any signed-in user could read back any order.
   * The GET below is the session's OWN view: no id crosses the wire, so there is nothing to
   * authorise, and GET carries no limiter because it spends nothing.
   *
   * ⚠️ A GENERATION REF, NOT A BOOLEAN. Close must actually stop the loop — leaving it running let
   * a second click start a second real order with a second poll — and comparing a captured
   * generation is what makes a stale loop exit at its next tick rather than fight the new one.
   */
  const topupRun = useRef(0)

  const pollBalance = useCallback(async (snapshot: string) => {
    const mine = ++topupRun.current
    /**
     * ⛔ A NON-READABLE SNAPSHOT IS NOT A BASELINE, AND TREATING IT AS ONE UNMOUNTED THE CHECKOUT
     * MID-PAYMENT. If the balance was still loading (`unknown`) or the provider had blipped
     * (`unreadable`) at the moment of the click, the very first successful tick differed from it,
     * the poll declared success at t+3s and tore down the iframe while the buyer was in 3-D Secure
     * (the Opus seat, on the diff, 2026-09-09). So an unusable snapshot is REPLACED by the first
     * readable reading instead of being compared against.
     */
    let before = snapshot === 'unknown' || snapshot === 'unreadable' ? null : snapshot
    // ~4 minutes: comfortably past 3-D Secure, and short enough that a forgotten tab stops.
    for (let i = 0; i < 80 && topupRun.current === mine; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      if (topupRun.current !== mine) return
      const r = await fetch('/api/wallet', { cache: 'no-store' })
      // ⚠️ A SIGNED-OUT SESSION IS TERMINAL — retrying it 80 times is four minutes of noise that
      // can never succeed.
      if (r.status === 401 || r.status === 403) { setTopup(null); return }
      if (!r.ok) continue
      const body = (await r.json()) as View
      setView(body)
      const now = balanceKey(body)
      if (now === 'unknown' || now === 'unreadable') continue
      if (before === null) { before = now; continue }
      if (now !== before) { setTopup(null); return }
    }
    /**
     * ⛔ A DECLINED CARD LOOKS EXACTLY LIKE A SLOW ONE FROM HERE, so say that rather than spin
     * forever. Without an order row there is nothing to ask "did it fail?", and pretending
     * otherwise is how a spinner becomes the only thing a buyer ever sees.
     */
    if (topupRun.current === mine) {
      setTopup(null)
      setError(tr(
        'We did not see the money arrive. If your card was charged it can take a few minutes — reload to check.',
        'Chưa thấy tiền vào ví. Nếu thẻ đã bị trừ, có thể mất vài phút — hãy tải lại để kiểm tra.',
      ))
    }
    // ⚠️ `tr` IS A REAL DEPENDENCY — the timeout sentence is user-facing copy, and an empty array
    // would freeze it in whatever language was mounted first.
  }, [tr])

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
      {!embedded && <SectionHeader title={tr('Your wallet', 'Ví của bạn')} />}
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
      {!embedded && <SectionHeader title={tr('Your wallet', 'Ví của bạn')} />}
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
              {/*
                ⛔ REAL MONEY, AND IT SITS ABOVE THE TEST FAUCET SO THE TWO ARE NEVER CONFUSED. The
                faucet below is dashed-bordered and labelled "Test environment" for the same reason.
              */}
              <div className="rounded-xl border border-line p-3">
                <p className="text-sm font-medium">{tr('Add money', 'Nạp tiền')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tr(
                    'Pay by card. The amount arrives in your wallet as USDC.',
                    'Thanh toán bằng thẻ. Số tiền sẽ vào ví của bạn dưới dạng USDC.',
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/*
                    ⚠️ WHOLE DOLLARS AS A STRING, MATCHING THE SERVER'S CONTRACT EXACTLY. Crossmint's
                    Orders API takes a DISPLAY amount ("25" is twenty-five dollars), which is the
                    inverse of the base-unit rule the balance parser follows — so nothing here
                    converts, and a number input that could produce "25.001" is deliberately not used.
                  */}
                  {/* Base UI via the ui/* primitive — a raw <select> is a hand-roll the standing
                      policy refuses, and this control had no reason to be the exception. */}
                  <Select value={topupAmount} onValueChange={(v) => setTopupAmount(v as string)}>
                    <SelectTrigger aria-label={tr('Amount in USD', 'Số tiền USD')} className="h-9 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* A currency amount is a value, not copy — `usd()` formats it rather than
                          translating it, which is also what keeps it out of the string catalogue. */}
                      {['10', '25', '50', '100', '200'].map((v) => (
                        <SelectItem key={v} value={v}>{usd(v)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="cta"
                    size="sm"
                    disabled={busy !== null || topup !== null}
                    onClick={() => void startTopup()}
                  >
                    {busy === 'topup' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    {tr('Add money', 'Nạp tiền')}
                  </Button>
                </div>

                {/*
                  ⛔ THE CHECKOUT IS RENDERED IN AN IFRAME AND THE PAGE STAYS MOUNTED. Card entry,
                  3-D Secure and the provider's KYC all happen inside Crossmint's own component —
                  no card detail ever reaches this origin, which is the point of using theirs.
                  ⚠️ `allow="payment"` IS REQUIRED for Apple Pay / Google Pay inside a frame.
                */}
                {topup && (
                  <div className="mt-3">
                    <iframe
                      src={topup.checkoutUrl}
                      title={tr('Card payment', 'Thanh toán thẻ')}
                      allow="payment"
                      className="h-[32rem] w-full rounded-lg border border-line bg-surface"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden="true" />
                      <p className="text-xs text-muted-foreground">
                        {tr(
                          'Waiting for the payment to settle. Your balance updates here automatically.',
                          'Đang chờ thanh toán hoàn tất. Số dư của bạn sẽ tự cập nhật tại đây.',
                        )}
                      </p>
                      <Button variant="ghost" size="sm" onClick={() => { topupRun.current++; setTopup(null) }}>
                        {tr('Close', 'Đóng')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

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
