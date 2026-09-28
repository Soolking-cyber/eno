'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Flag, Images, UserRound, ListChecks, Wallet, ScanLine, Scale, ChevronRight } from '@/components/ui/icons'
import { ICON_SIZE } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'
import { buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/**
 * The listing page's "Reports & disputes" row, and the sheet it opens (bottom sheet on a phone,
 * centred card on desktop) explaining how a report becomes a case and what can come of it.
 *
 * ⛔ EVERY SENTENCE HERE IS A CLAIM ABOUT CODE, AND EACH ONE WAS CHECKED AGAINST THE LINE THAT MAKES
 * IT TRUE (copy sheet CS-0, SEO wave B, 2026-09-28). The row this replaced said "ENO protects you —
 * disputes handled in 72h · listings screened", and all three halves were false: 72 hours is only
 * the evidence window (src/lib/dispute.ts, DISPUTE_WINDOW_MS), nothing in the code bounds how long a
 * decision takes, and listings go live the moment they pass the automatic checks, with nobody
 * reviewing them first (src/lib/core/listings.ts, `verified: true` on create). Before adding or
 * editing a sentence, find the code that makes it true; if there is none, the sentence does not
 * ship. In particular:
 *  - NO DEADLINE NUMBER. The Operating Regulations publish 7 working days for a reply and 15 (up
 *    to 30) for an answer; the code enforces 72 hours for the first and nothing for the second.
 *    Until the owner reconciles them (plan decisions P0-a, P0-c), the sheet points to the
 *    Regulations instead of quoting either.
 *  - NO PROTECTION, GUARANTEE OR ESCROW WORDING, in either language. eno takes no payment, holds
 *    no money and cannot refund (terms, "a platform, not a party to the deal").
 *  - THE PHOTO LIMIT IS DISPUTE_IMAGES_MAX. `src/lib/dispute.ts` is server-only, so the number is
 *    written here and protections-row.test.ts pins it to the constant, in both languages.
 */

/**
 * Where the row goes when it cannot open the dialog yet: the /safety section that covers the same
 * ground (`<ContentSection id="protection">`, safety/page.tsx, whose id is kept so links keep landing
 * there). See the note at the trigger.
 */
export const PROTECTIONS_FALLBACK_HREF = '/safety#protection'

/** A store that never changes, read only to tell the server and hydration renders from the rest. */
const subscribeNothing = () => () => {}

/**
 * Until hydration the row is a plain link, so the attributes Base UI gives a dialog trigger are
 * withheld: nothing can open a popup yet, and `role="button"` or `aria-expanded` would announce one.
 * Each key is present with the value `undefined` on purpose. The render element's props are merged
 * last (Base UI mergeProps copies the key, value and all), and React then omits the attribute.
 */
const LINK_UNTIL_HYDRATED = {
  role: undefined,
  'aria-haspopup': undefined,
  'aria-expanded': undefined,
  'aria-controls': undefined,
} as const

export function ProtectionsRow({ inline = false }: {
  /**
   * Render as the quiet second line INSIDE the safety strip rather than as a row of its own
   * (owner, 2026-08-11: combine the two PDP trust blocks).
   *
   * ⚠️ `inline` DROPS THE MARK AND THE HAIRLINE, and both are deliberate. The strip it now lives in
   * already carries a glyph, and two marks in one block devalue each other.
   * The hairline goes because it was separating this row from the block BELOW it, and that
   * block is now its own container.
   * It opens the same dialog: what changes is its weight, not its job.
   */
  inline?: boolean
} = {}) {
  const { tr } = useLanguage()
  // false in the server render and in the hydration render, true in every render after those.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false)

  // Item leads are LINE-ONLY in surface ink (§6 — brand line is reserved for interactive
  // affordances; a static list glyph fits no brand bucket). All six leads are the same weight in
  // the same ink, and every glyph is one the sprite already draws.
  const items: { icon: React.ReactNode; title: string; body: string; link?: { href: string; label: string } }[] = [
    {
      icon: <Flag className={`${ICON_SIZE.lg} text-body`} aria-hidden />,
      title: tr("Report from the listing, the seller's page or a chat", 'Báo cáo ngay trên tin đăng, trang người bán hoặc cuộc trò chuyện'),
      body: tr(
        "Tap Report (you'll need to sign in). A report opens a private case between you, the seller and our team, which you can follow under Disputes.",
        'Bấm Báo cáo (cần đăng nhập). Báo cáo sẽ mở một hồ sơ riêng giữa bạn, người bán và đội ngũ của chúng tôi, và bạn theo dõi được trong mục Khiếu nại.',
      ),
    },
    {
      icon: <Images className={`${ICON_SIZE.lg} text-body`} aria-hidden />,
      title: tr('Both sides can send evidence', 'Hai bên đều được gửi bằng chứng'),
      body: tr(
        "You can send one statement with up to 6 photos before the deadline shown on the case. If the seller has an account, they're told about the case and can do the same, but we never tell them who reported it. If the seller doesn't respond before the deadline, the case is decided on what we have.",
        'Bạn được gửi một lần trình bày, kèm tối đa 6 ảnh, trước hạn chót ghi trên hồ sơ. Nếu người bán có tài khoản, họ được thông báo về hồ sơ và cũng được gửi như vậy, nhưng chúng tôi không bao giờ cho họ biết ai đã báo cáo. Nếu người bán không phản hồi trước hạn chót, hồ sơ được quyết định dựa trên những gì đã có.',
      ),
    },
    {
      // A person, not a gavel: the sprite draws Gavel and Scale as the same Solar glyph
      // (scripts/lucide-solar-map.mjs), and Scale is already the sheet's own mark. The sentence
      // beside it says a person decides.
      icon: <UserRound className={`${ICON_SIZE.lg} text-body`} aria-hidden />,
      title: tr('Our team decides', 'Đội ngũ của chúng tôi quyết định'),
      body: tr(
        'Decisions are made by a person on our team, not automatically. The deadlines for an answer are set out in our Operating Regulations.',
        'Quyết định do một người trong đội ngũ của chúng tôi đưa ra, không phải tự động. Thời hạn trả lời được quy định trong Quy chế hoạt động.',
      ),
      // Article 12 of the Regulations is where the published deadlines live; its section id is
      // `complaints` (regulations/page.tsx). The Regulations are the one place a number may appear.
      link: { href: '/regulations#complaints', label: tr('Read the Operating Regulations', 'Xem Quy chế hoạt động') },
    },
    {
      icon: <ListChecks className={`${ICON_SIZE.lg} text-body`} aria-hidden />,
      title: tr('What can happen', 'Kết quả có thể là gì'),
      body: tr(
        "If a report is upheld, we can take the listing down, lower the seller's Trust score, and warn, restrict or suspend their account. If it isn't, the case is closed with no action against the seller. If the seller has an account, they can appeal the decision with an explanation and any photos.",
        'Nếu báo cáo có căn cứ, chúng tôi có thể gỡ tin đăng, trừ điểm uy tín của người bán, và cảnh cáo, hạn chế hoặc khoá tài khoản của họ. Nếu không, hồ sơ được đóng và người bán không bị xử lý. Nếu người bán có tài khoản, họ có thể khiếu nại lại quyết định, kèm lời giải thích và ảnh (nếu có).',
      ),
    },
    {
      icon: <Wallet className={`${ICON_SIZE.lg} text-body`} aria-hidden />,
      title: tr("We don't handle your money", 'Chúng tôi không giữ tiền của bạn'),
      body: tr(
        "You pay the seller directly. We take no payment and hold no escrow, so we can't refund you or reverse a payment. Meet in a public place, check the item, and pay only when you're satisfied — never send a deposit to someone you haven't met. If money was lost, contact your bank and the police straight away.",
        'Bạn trả tiền trực tiếp cho người bán. Chúng tôi không thu tiền và không giữ tiền ký quỹ, nên không thể hoàn tiền hay huỷ một khoản thanh toán. Hãy gặp ở nơi công cộng, kiểm tra món hàng và chỉ trả khi hài lòng — đừng chuyển cọc cho người bạn chưa gặp. Nếu đã mất tiền, hãy liên hệ ngân hàng và công an ngay.',
      ),
    },
    {
      icon: <ScanLine className={`${ICON_SIZE.lg} text-body`} aria-hidden />,
      title: tr('Automatic checks on new listings', 'Kiểm tra tự động tin mới'),
      body: tr(
        "Before a listing goes live, its text is checked for banned items and contact details, it must have enough photos, and it's compared with the seller's other live listings to catch duplicates. After it goes live, some listings are checked again and can be hidden for review. Checks can miss things, so judge each listing yourself.",
        'Trước khi tin được đăng, nội dung được kiểm tra hàng cấm và thông tin liên hệ, tin phải có đủ ảnh, và được so với các tin đang đăng khác của người bán để phát hiện tin trùng. Sau khi đăng, một số tin được kiểm tra lại và có thể bị ẩn để xem xét. Việc kiểm tra có thể bỏ sót, nên hãy tự đánh giá từng tin.',
      ),
    },
  ]

  return (
    <Dialog>
      {/* ⛔ A LINK UNTIL HYDRATION, A BUTTON AFTER IT (SEO wave B, P0t). The row is in the server HTML,
          so a slow phone shows it well before React attaches a handler. As a <button>, a tap in that
          window did nothing and people had to tap twice (measured on a production build at 4× CPU;
          the e2e spec had to click until the dialog opened). Now:
          · Before hydration it is an <a href> to the /safety section that covers the same ground, so
            that tap lands somewhere useful, and assistive tech hears a link, which is what it is.
          · From hydration on, a click opens the dialog in place and preventDefault keeps the page.
            The render after hydration adds role="button", aria-haspopup and aria-expanded: activating
            it now opens a dialog and goes nowhere, and ARIA has to say what activation does. It is
            the same DOM node throughout, so nothing moves and focus stays put.
          · A click with ⌘, Ctrl or Shift stays a link, as a middle click already is, so opening the
            section in a new tab or window still works; preventBaseUIHandler keeps the dialog shut for
            it. Not Alt: on a link, Alt-click downloads the page (safety.html, measured in Chrome),
            which nobody wants from a row that opens a dialog, so Alt-click opens the dialog.
          · Keys: Enter on a link fires a click natively, which opens the dialog. Base UI opens it on
            Space's keyup, but on an <a href> it leaves Space's keydown alone, and that scrolls the
            page; onKeyDown stops the scroll.
          · Base UI returns focus to this trigger when the dialog closes, as it did for the <button>.
          · Hydration no longer scrolls the page out from under a finger on its way here: ScrollToTop
            skips the page the browser loaded (scroll-to-top.tsx).
          `buttonVariants` gives the classes <Button> rendered, minus `transition-colors`, which
          <Button> dropped too (ui/button.tsx, keepPressTransition): it would knock out the base's
          transition list and, with it, the tween on the press scale.
          `press`, not `active:scale-100`: a dialog trigger is not a floating-ui anchor (no rect read
          mid-press), so it gets the standard press feel; the base's active:scale-[0.97] supplies the
          pressed value (utilities outrank the components layer). */}
      <DialogTrigger
        nativeButton={false}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            event.preventBaseUIHandler()
            return
          }
          event.preventDefault()
        }}
        onKeyDown={(event) => {
          if (event.key === ' ') event.preventDefault()
        }}
        render={
          <a
            href={PROTECTIONS_FALLBACK_HREF}
            {...(hydrated ? {} : LINK_UNTIL_HYDRATED)}
            // The stable hook for tests (e2e/guest/listing.spec.ts, e2e/ci/protections-row.spec.ts):
            // they count this attribute rather than matching the words, so a copy change can never
            // blind the "not on a partner listing" check again.
            data-protections-row=""
            // ⚠️ A FLAT ROW, NOT A PANEL — IT WAS COMPETING WITH THE SCAM WARNING BELOW IT.
            // On the PDP this sits DIRECTLY above the deposit-fraud strip, and until now the two
            // were the same shape: identical rounded box, identical padding, near-identical tonal
            // value (bg-tint vs warning/10). An informational panel and the one sentence that can
            // stop a buyer losing money read as a single grey blob, and a design review put it
            // bluntly — the warning had less visual weight than the price.
            // Nothing here is downgraded in FUNCTION: same trigger, same dialog, still a
            // full-width tap target. What goes is the box. Canon §3b says a thing in normal flow is
            // a row with a hairline, not a panel — and losing the box is what lets the warning's
            // tinted strip and left rule read as the only emphasised thing in the block, which is
            // the correct hierarchy when one of the two can cost someone money.
            className={cn(
              buttonVariants({ variant: 'bare', size: 'none' }),
              // `min-h-11`: this row measured 312x37 — the one control in the safety block under
              // the 44px floor. A min-height, so a line that wraps still grows the row naturally.
              'press min-h-11 whitespace-normal text-left font-normal',
              inline
                // ⚠️ `inline-flex w-auto`, NOT `w-full justify-start`. As a full-width row the
                // chevron was flung to the far right of the strip, four hundred-odd pixels from
                // the words it points at — the exact defect fixed on /help, reintroduced here by
                // reusing the row's layout inside a much wider container. Sized to its content,
                // the glyph sits against the sentence and reads as one affordance.
                // No tint hover either: the strip is already tinted, and a second wash on top of
                // it looks like a rendering fault rather than a hover.
                ? 'inline-flex w-auto items-center gap-1 py-0.5 hover:bg-transparent'
                : 'flex w-full items-center justify-start gap-2.5 border-b border-border px-1 py-2.5 hover:bg-tint',
            )}
          />
        }
      >
          {/* The block's mark: Scale, the glyph the Disputes section wears in the dashboard nav
              (dashboard-nav.tsx). Not the shield — a shield is a promise of cover, and this row
              describes a process. Suppressed when inline: the safety strip already carries a
              glyph, and two in one box devalue both. */}
          {!inline && <Scale className={ICON_SIZE.lg} />}
          <span className={cn('min-w-0 text-xs leading-snug text-body', !inline && 'flex-1')}>
            <span className="font-bold text-foreground">{tr('Reports & disputes', 'Báo cáo & khiếu nại')}</span>
            {' — '}
            {tr('how they work', 'cách xử lý')}
          </span>
          <ChevronRight className={cn('shrink-0 text-muted-foreground', inline ? 'h-3.5 w-3.5' : 'h-4 w-4')} aria-hidden />
      </DialogTrigger>

      <DialogContent
        // ⚠️ Base UI emits data-open / data-closed — NOT Radix's data-[state=open|closed]. The old
        // data-[state=*] slide classes never matched, so this bottom-anchored sheet fell back to the
        // base DialogContent's zoom-in-95/zoom-out-95 and CENTER-ZOOMED instead of sliding up. These
        // Base UI variants make it slide from the bottom edge (with the base's subtle zoom riding
        // along, which reads fine on a full-width sheet). Found in the 3-reviewer Base UI audit.
        // ⚠️ ENTER AND EXIT ARE TRANSITIONS NOW (ui/dialog explains why), so the slide is written as
        // the start/end `transform` — each REPLACES the base's scale(0.95) through tailwind-merge — and
        // from sm up, where this is a centred dialog, the base's zoom comes back. Where the base falls
        // back to its keyframe entrance (Safari ≤ 17.3, no @starting-style), the slide rides it again.
        className="top-auto bottom-0 left-0 max-h-[85vh] w-full max-w-full translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-b-none rounded-t-2xl p-0 duration-200 motion-reduce:animate-none motion-reduce:transition-none starting:[transform:translateY(1rem)] data-starting-style:[transform:translateY(1rem)] data-ending-style:[transform:translateY(1rem)] sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:starting:[transform:scale(0.95)] sm:data-starting-style:[transform:scale(0.95)] sm:data-ending-style:[transform:scale(0.95)] not-supports-[transition-behavior:allow-discrete]:data-open:slide-in-from-bottom-4"
      >
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <Scale className={ICON_SIZE.lg} />
            <DialogTitle className="text-lg font-bold text-foreground">
              {tr('How reports and disputes work', 'Cách xử lý báo cáo và khiếu nại')}
            </DialogTitle>
          </div>
          <DialogDescription className="mt-1.5 text-sm leading-relaxed text-body">
            {tr(
              "We're a marketplace, not a payment or escrow service: we don't hold your money, and we can't refund you or promise how a case ends.",
              'Chúng tôi là sàn giao dịch, không phải dịch vụ thanh toán hay ký quỹ: chúng tôi không giữ tiền của bạn, không thể hoàn tiền và không cam kết kết quả của một khiếu nại.',
            )}
          </DialogDescription>
        </div>

        <ul className="space-y-4 px-5 pb-2">
          {items.map((it) => (
            <li key={it.title} className="flex gap-3">
              <span className="mt-0.5 shrink-0">{it.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{it.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-body">{it.body}</p>
                {it.link && (
                  // A DialogClose for the same reason as the safety-guide link below: the link IS
                  // the close action, and without nativeButton={false} Base UI expects a <button>.
                  <DialogClose nativeButton={false} render={
                    <Link
                      href={it.link.href}
                      className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline"
                    />
                  }>
                      {it.link.label}
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </DialogClose>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-2 border-t border-border px-5 py-4">
          {/* nativeButton={false}: the close action IS this <Link> — without the flag
              Base UI expects a native <button> and logs an a11y error on every open
              (the red dev-overlay badge that polluted the judged screenshots). */}
          <DialogClose nativeButton={false} render={
            <Link
              href="/safety"
              className="press flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand px-5 py-2.5 text-sm font-bold text-accent-foreground hover:bg-accent"
            />
          }>
              {tr('Read our safety guide', 'Xem hướng dẫn an toàn')}
              <ChevronRight className="h-4 w-4" aria-hidden />
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
