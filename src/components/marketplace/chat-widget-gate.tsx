'use client'

import dynamic from 'next/dynamic'
import { useAuth } from '@/context/auth-context'

// The chat widget pulls Supabase realtime; a logged-out visitor never sees it
// (it returns null for anon). Gate the IMPORT behind auth so its chunk only
// loads once the user is signed in — keeping it off the anonymous home page.
const ChatWidget = dynamic(() => import('./chat-widget').then((m) => m.ChatWidget), { ssr: false })

export function ChatWidgetGate() {
  const { user } = useAuth()
  return user ? <ChatWidget /> : null
}
