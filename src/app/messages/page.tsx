'use client'

import { useLanguage } from '@/context/language-context'
import { Mascot } from '@/components/marketplace/mascot'

// Right-pane placeholder shown on desktop when no conversation is open. On mobile
// this route renders only the list (the layout hides this pane), so users never
// see it there.
export default function MessagesPage() {
  const { tr } = useLanguage()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center">
      <Mascot name="chat" className="h-32 w-32" />
      <p className="mt-3 text-sm text-muted-foreground">{tr('Select a conversation to start chatting.', 'Chọn một cuộc trò chuyện để bắt đầu.')}</p>
    </div>
  )
}
