'use client'

import { useLanguage } from '@/context/language-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'

/**
 * The signed-out /messages state — ONE component, so the list pane (phones) and the right pane
 * (desktop) show the same gate, and each shows it exactly once (the pages decide where it goes).
 *
 * It says what messaging here is FOR before asking for anything: the chat stays in the app and the
 * visitor's phone number is not handed to a stranger. The same line rides into the sign-in card as its
 * context note (SignInContext.note), so the reason does not vanish on the tap.
 *
 * ⚠️ `className` carries the pre-hydration switch: callers render it `hidden no-session:flex` while
 * auth is still `loading`, so a guest (html.no-session, set pre-paint in [lang]/layout.tsx) sees the
 * gate from the first frame instead of skeletons that turn into a gate a second later.
 */
export function MessagesGuestGate({ className }: { className?: string }) {
  const { tr } = useLanguage()
  const why = tr('Chat with sellers in the app — your phone number stays private.', 'Nhắn tin với người bán ngay trong ứng dụng — số điện thoại của bạn được giữ kín.')
  return (
    <div className={cn('flex flex-col items-center px-4 py-10 text-center', className)}>
      <Mascot name="chat" className="h-40 w-40" />
      <p className="mt-3 text-base font-bold text-foreground">{tr('Sign in to see your messages.', 'Đăng nhập để xem tin nhắn của bạn.')}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{why}</p>
      <div className="mt-4"><SignInPrompt note={why} /></div>
    </div>
  )
}
