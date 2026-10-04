'use client'

import { TriangleAlert } from '@/components/ui/icons'
import { Alert } from '@/components/ui/alert'
import { useLanguage } from '@/context/language-context'
import { IS_SERVICES } from '@/lib/edition'
import { fold } from '@/lib/fold'
import { VEHICLE_RENTAL_SUBCATS } from '@/lib/rental-places'
import { cn } from '@/lib/utils'

// Off-platform lure detection: bare URLs (link shorteners for Telegram/WhatsApp/
// Zalo included) or "move the chat" phrases, matched case-insensitively. The
// diacritic class covers both "chuyen sang zalo" and the properly typed "chuyển".
const OFF_PLATFORM =
  /https?:\/\/|www\.|t\.me\b|wa\.me\b|zalo\.me\b|telegram|whatsapp|viber|qua zalo|qua telegram|chuy[eêể]n sang zalo/i

// Hosts that must NEVER trip the warning: our own links (people paste listings
// and storefronts at each other constantly) and map links (arranging the meetup
// is the SAFE behavior we're nudging toward). Stripped before the generic test.
const SAFE_HOSTS =
  /(?:https?:\/\/)?(?:www\.)?(?:eno\.vn|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\S*/gi

/** First INCOMING message that tries to move the deal off-platform (null if none).
 *  Only counterpart messages are scanned — warning the user about their own text
 *  would be noise — and only the first hit anchors a warning, never one per link. */
export function findOffPlatformMessageId(messages: { id: string; mine: boolean; body: string }[]): string | null {
  const hit = messages.find((m) => !m.mine && OFF_PLATFORM.test(m.body.replace(SAFE_HOSTS, '')))
  return hit ? hit.id : null
}

// Payment / deposit lure (UX program 2, A7 item 8 — from the research sweep): the counterpart asking for
// money up front, a bank account number, or a one-time code. Matched on the FOLDED body (src/lib/fold.ts:
// lower-case, no diacritics, đ→d), so "chuyển khoản", "chuyen khoan" and "CHUYỂN KHOẢN" are one spelling —
// Vietnamese typed on a phone without a Telex IME is the common case, not the edge. Word-bounded where a
// bare substring would misfire ("stk" inside a word, "otp" inside "hotpot").
// ⚠️ NOT "ck" / "coc" alone: both are everyday words or abbreviations in a normal chat and would turn
// the warning into noise. The phrases below are the ones a scam actually needs.
// ⚠️ "WIRE" ONLY AS A PAYMENT: "wire transfer" / "wire money". A bare `wire` fired on "the wire is frayed"
// in a listing for a lamp or a charger — goods talk, not a lure.
export const PAYMENT_LURE =
  /chuyen khoan|dat coc|coc truoc|\bstk\b|so tai khoan|\botp\b|ma xac (?:nhan|thuc)|bank transfer|\bdeposit|\bwire (?:transfer|money)\b/

/** First INCOMING message that asks for money up front, an account number or a code (null if none).
 *  Same contract as findOffPlatformMessageId: counterpart messages only, one anchor, never one per hit. */
export function findPaymentLureMessageId(messages: { id: string; mine: boolean; body: string }[]): string | null {
  const hit = messages.find((m) => !m.mine && !!m.body && PAYMENT_LURE.test(fold(m.body)))
  return hit ? hit.id : null
}

// ── ONE SENTENCE, TWO MOMENTS ───────────────────────────────────────────────────
//
// "Meet in public, inspect, then pay." / "Hẹn nơi công cộng, kiểm tra hàng rồi mới thanh
// toán." is the instruction this whole file exists to deliver, and it is now said at two
// moments: the start of a thread (FirstContactNote) and the moment a price is agreed
// (OfferAcceptedNote). The two Vietnamese renderings below are CHARACTER-IDENTICAL and must
// stay that way — two wordings of one safety rule is how a marketplace ends up telling the
// same buyer two slightly different things.
//
// ⚠️ WRITTEN OUT TWICE ON PURPOSE — DO NOT HOIST IT INTO A CONSTANT AND INTERPOLATE IT.
// scripts/gen-ui-strings.mjs harvests the pre-warm catalogue with `/\btr\(\s*'…'/` — a regex
// over STRING LITERALS. A template literal or a constant is invisible to it, so hoisting
// would silently drop BOTH sentences from src/generated/ui-strings.ts and ship them English
// to the machine-translated languages until someone noticed a safety note in the wrong one.
// The duplication is the price of being in the catalogue; the comment is the seam.

/** One-time safety hint at the start of a thread — a system note, not a bubble.
 *
 *  ⚠️ YIELDS TO OfferAcceptedNote. The caller suppresses this one while the thread holds an
 *  accepted offer — see the note above `showFirstContactNote` in the thread page for why the
 *  later moment wins. */
export function FirstContactNote() {
  const { tr } = useLanguage()
  return (
    <Alert
      tone="warning"
      appearance="flat"
      size="xs"
      className="mx-auto max-w-md rounded-xl px-3.5 py-2.5 text-center"
    >
      {tr(
        'First chat — never pay or ship before meeting. Meet in public, inspect, then pay.',
        'Lần đầu trò chuyện — đừng chuyển tiền hay gửi hàng trước khi gặp mặt. Hẹn nơi công cộng, kiểm tra hàng rồi mới thanh toán.',
      )}
    </Alert>
  )
}

/**
 * THE MOMENT MONEY IS AGREED (§10.2) — rendered inside the ACCEPTED offer card, to BOTH
 * parties, immediately above the seller's Mark-as-sold action.
 *
 * The other two interjections fire at the start of a thread and at the first off-platform
 * lure. Neither speaks at the point where a number has just been agreed and one of the two
 * is about to hand over cash — which is the point the sentence is actually about, and the
 * one where it is read rather than skimmed.
 *
 * No icon and the quiet `warning` tint, not `destructive`: nothing has gone wrong here. The
 * lure warning owns the alarming end of the scale, and a red box on a deal that just closed
 * would read as an accusation. Sits inside the card's rounded-2xl box, so rounded-xl is the
 * inner tier (docs/design-language.md §2).
 */
export function OfferAcceptedNote() {
  const { tr } = useLanguage()
  return (
    <Alert tone="warning" appearance="flat" size="xs" className="mt-2 rounded-xl">
      {tr(
        'Meet in public, inspect, then pay.',
        'Hẹn nơi công cộng, kiểm tra hàng rồi mới thanh toán.',
      )}
    </Alert>
  )
}

/**
 * "eno is not a party to this offer" (2026-10-01) — said where the BUYER makes or sees a price offer:
 * the chat's offer composer, a pending offer card in the thread, and the PDP's offer panel.
 *
 * Why it exists: an offer here is a structured chat message with Accept / Decline (offers.ts). Nothing
 * about accepting it forms a purchase on the platform — eno takes no payment and holds no money (Terms,
 * src/app/[lang]/terms/page.tsx: "We process no payments between buyers and sellers and we hold no money
 * at any point") — and a buyer who reads "Accepted" as a binding sale on eno is the one who pays a stranger
 * in advance. So the note says who is NOT in the deal, and where the deal actually happens.
 *
 * ⛔ NEVER "AN OFFER IS NOT A CONTRACT" — the first wording, withdrawn in review the same day. Whether an
 * offer binds the person who makes it, and whether accepting it concludes a contract, is a question of
 * civil law the repo cannot answer (it is with counsel), and a buyer could read that line as "my offer is
 * not binding even once accepted". What IS verifiable, from the Quy chế (src/app/[lang]/regulations/
 * page.tsx, Article 7 step 5 and Article 11): the operator is not the seller or the buyer, and the parties
 * agree and carry out the transaction themselves, off the platform. The note says only that.
 *
 * ⚠️ BUYER-WORDED ("you and the seller"), so the callers show it to the buyer only.
 * ⚠️ TWO LITERAL PAIRS BEHIND THE EDITION, NEVER `${SITE_NAME}` INSIDE THE COPY: gen-ui-strings harvests
 * literals only (see the note at the top of this section), and a chat on eno.forum must not name
 * eno.vn. A LABEL ONLY — it renders no control and changes no send path.
 */
export function OfferPartiesNote({ className }: { className?: string }) {
  const { tr } = useLanguage()
  return (
    <p data-offer-parties="" className={cn('text-2xs leading-snug text-ink-4', className)}>
      {IS_SERVICES
        ? tr(
            'eno.forum is not a party to this offer — you and the seller agree and complete any deal yourselves, off eno.forum.',
            'eno.forum không phải là một bên của đề nghị giá này — hai bên tự thoả thuận và hoàn tất giao dịch, ngoài eno.forum.',
          )
        : tr(
            'eno.vn is not a party to this offer — you and the seller agree and complete any deal yourselves, off eno.vn.',
            'eno.vn không phải là một bên của đề nghị giá này — hai bên tự thoả thuận và hoàn tất giao dịch, ngoài eno.vn.',
          )}
    </p>
  )
}

/** Rendered under the first incoming message that lures the deal off eno.vn. */
export function OffPlatformWarning() {
  const { tr } = useLanguage()
  return (
    <Alert
      tone="destructive"
      appearance="flat"
      size="xs"
      className="max-w-[92%] rounded-xl px-3.5 py-2.5"
      icon={<TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />}
    >
      <span>
        {tr(
          'Careful — scammers move deals off eno.vn to erase evidence. Keep the conversation here.',
          'Cẩn thận — kẻ lừa đảo thường kéo giao dịch ra ngoài eno.vn để xóa dấu vết. Hãy tiếp tục trao đổi tại đây.',
        )}
      </span>
    </Alert>
  )
}

/** Which advice the payment-lure warning gives — see `paymentLureKind`. */
export type PaymentLureKind = 'rental' | 'job' | 'goods'

/**
 * The advice follows the thing being paid for. A place to live is paid for after it has been SEEN with its
 * papers; a job is never paid for at all (the same line the listing page's SafetyStrip gives a candidate —
 * a job is not a sale, owner 2026-10-01); everything else is paid for after it has been inspected. A cached
 * thread written before the payload carried a category falls to 'goods', the general rule.
 */
export function paymentLureKind(listing: { listingType?: string | null; categorySlug?: string | null; subcategorySlug?: string | null } | null | undefined): PaymentLureKind {
  if (listing?.listingType === 'job') return 'job'
  // Vehicle hire lives under `rentals` too but is not somewhere you "view in person" — the one list of its
  // subcategories is rental-places.ts's, the same the rentals hubs use to keep cars out of "places".
  if (listing?.categorySlug === 'rentals' && !VEHICLE_RENTAL_SUBCATS.includes(listing.subcategorySlug ?? '')) return 'rental'
  return 'goods'
}

/**
 * Rendered under the first incoming message that asks for a transfer, a deposit, an account number or
 * a code (PAYMENT_LURE). The OTP clause sits on the goods line because that is where the "send me the
 * code so I can pay you" scam runs; a rental scam asks for the deposit itself.
 * ⚠️ THREE LITERAL PAIRS, NOT A LOOKUP — gen-ui-strings harvests `tr('…')` literals only (see the note
 * at the top of the safety section).
 */
export function PaymentLureWarning({ kind }: { kind: PaymentLureKind }) {
  const { tr } = useLanguage()
  return (
    <Alert
      tone="destructive"
      appearance="flat"
      size="xs"
      data-payment-lure={kind}
      className="max-w-[92%] rounded-xl px-3.5 py-2.5"
      icon={<TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />}
    >
      <span>
        {kind === 'rental'
          ? tr(
              'Only pay a deposit after you have viewed the place in person and seen the papers.',
              'Chỉ đặt cọc sau khi đã xem nhà tận nơi và xem giấy tờ.',
            )
          : kind === 'job'
            ? tr(
                'Never pay a fee or a deposit to get a job — eno never asks for one.',
                'Đừng bao giờ trả phí hay đặt cọc để được nhận việc — eno không bao giờ yêu cầu.',
              )
            : tr(
                'Meet, inspect, then pay — eno never asks for an OTP code.',
                'Gặp trực tiếp, kiểm tra hàng rồi mới trả tiền — eno không bao giờ yêu cầu bạn cung cấp mã OTP.',
              )}
      </span>
    </Alert>
  )
}
