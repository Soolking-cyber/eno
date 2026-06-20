'use client'

import dynamic from 'next/dynamic'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'

// The chat widget pulls Supabase realtime; a logged-out visitor never sees it.
// Gate the IMPORT behind auth so its chunk only loads once the user is signed in
// — keeping it off the anonymous home page.
const ChatWidget = dynamic(() => import('./chat-widget').then((m) => m.ChatWidget), { ssr: false })

export function ChatWidgetGate() {
  const { user, loading } = useAuth()
  const { open } = useChat()
  // Mount when signed in; also while auth is still resolving IF a panel was opened
  // (e.g. tapping Message), so the optimistic chat paints instantly. Anonymous idle
  // visitors never mount it → no launcher flash.
  return (user || (loading && open)) ? <ChatWidget /> : null
}
