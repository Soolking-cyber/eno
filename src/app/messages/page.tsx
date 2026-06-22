'use client'

import { MessageSquare } from 'lucide-react'
import { useLanguage } from '@/context/language-context'

// Right-pane placeholder shown on desktop when no conversation is open. On mobile
// this route renders only the list (the layout hides this pane), so users never
// see it there.
export default function MessagesPage() {
  const { tr } = useLanguage()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center">
      <MessageSquare className="h-10 w-10 text-line-strong" />
      <p className="mt-3 text-sm text-muted-foreground">{tr('Select a conversation to start chatting.', 'Chọn một cuộc trò chuyện để bắt đầu.')}</p>
    </div>
  )
}
