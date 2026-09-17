'use client'

import { useLanguage } from '@/context/language-context'
import { EmptyState } from '@/components/ui/empty-state'
import { Mascot } from '@/components/marketplace/mascot'

// Right-pane placeholder shown on desktop when no conversation is open. On mobile
// this route renders only the list (the layout hides this pane), so users never
// see it there. Uses the shared mascot-led EmptyState (tone="bare") so it matches
// the saved page's empty treatment exactly.
export default function MessagesPage() {
  const { tr } = useLanguage()
  return (
    <EmptyState
      tone="bare"
      size="lg"
      className="h-full w-full"
      media={<Mascot name="chat" className="h-56 w-56" />}
      title={tr('Select a conversation to start chatting.', 'Chọn một cuộc trò chuyện để bắt đầu.')}
    />
  )
}
