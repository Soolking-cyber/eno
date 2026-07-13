'use client'

import { TriangleAlert } from 'lucide-react'
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

/** One-time safety hint at the start of a thread — a system note, not a bubble. */
export function FirstContactNote() {
  const { tr } = useLanguage()
  return (
    <div className="mx-auto max-w-md rounded-xl bg-warning/10 px-3.5 py-2.5 text-center text-xs leading-relaxed text-warning">
      {tr(
        'First chat — never pay or ship before meeting. Meet in public, inspect, then pay.',
        'Lần đầu trò chuyện — đừng chuyển tiền hay gửi hàng trước khi gặp mặt. Hẹn nơi công cộng, kiểm tra hàng rồi mới thanh toán.',
      )}
    </div>
  )
}

/** Rendered under the first incoming message that lures the deal off eno.vn. */
export function OffPlatformWarning() {
  const { tr } = useLanguage()
  return (
    <div className="flex max-w-[92%] items-start gap-2 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-xs leading-relaxed text-destructive">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {tr(
          'Careful — scammers move deals off eno.vn to erase evidence. Keep the conversation here.',
          'Cẩn thận — kẻ lừa đảo thường kéo giao dịch ra ngoài eno.vn để xóa dấu vết. Hãy tiếp tục trao đổi tại đây.',
        )}
      </span>
    </div>
  )
}
