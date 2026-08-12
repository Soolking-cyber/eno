'use client'

import { TriangleAlert } from '@/components/ui/icons'
import { Alert } from '@/components/ui/alert'
import { useLanguage } from '@/context/language-context'

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
