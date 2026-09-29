'use client'

import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { EmptyState } from '@/components/ui/empty-state'
import { Mascot } from '@/components/marketplace/mascot'
import { MessagesGuestGate } from '@/components/marketplace/messages-guest-gate'
import { cn } from '@/lib/utils'

// Right-pane placeholder shown on desktop when no conversation is open. On mobile
// this route renders only the list (the layout hides this pane), so users never
// see it there. Uses the shared mascot-led EmptyState (tone="bare") so it matches
// the saved page's empty treatment exactly.
// ⚠️ FOR A GUEST THIS PANE IS THE SIGN-IN GATE, AND THE LIST'S OWN COPY IS `lg:hidden` — so desktop shows
// ONE gate, here, instead of a sign-in prompt on the left and "Select a conversation to start chatting."
// on the right (an instruction a guest cannot follow). While auth is still `loading`, the pre-paint
// `html.no-session` class picks between the two with CSS, exactly as the list does.
export default function MessagesPage() {
  const { tr } = useLanguage()
  const { user, loading } = useAuth()
  if (!loading && !user) return <MessagesGuestGate className="h-full w-full justify-center" />
  return (
    <>
      <EmptyState
        tone="bare"
        size="lg"
        className={cn('h-full w-full', loading && 'no-session:hidden')}
        media={<Mascot name="chat" className="h-56 w-56" />}
        title={tr('Select a conversation to start chatting.', 'Chọn một cuộc trò chuyện để bắt đầu.')}
      />
      {loading && <MessagesGuestGate className="hidden h-full w-full justify-center no-session:flex" />}
    </>
  )
}
