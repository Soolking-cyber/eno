'use client'

import Link from 'next/link'
import { useState } from 'react'
import { MessageCircle } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useOpenSupportThread } from './use-open-support-thread'

/** The Contact page's targets share one shape: a 44px outlined chip (contact/page.tsx's email and phone). */
const CHIP = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-base font-semibold text-accent-foreground transition-colors hover:bg-muted'

/**
 * CONTACT'S THIRD WAY TO A PERSON: the support chat (UI climb 2026-11-09, phone UX hunt). Since the support bubble left phones
 * (owner, 2026-11-08) the chat was reachable only from the very end of Help; on a phone, Contact — the page whose whole job is
 * reaching someone — listed email alone.
 * · Signed in: opens the reader's support thread in /messages (use-open-support-thread.ts — the same hook as Help's "Message
 *   support"). A failure shows the email line, never an error page: a person asking for support already has a problem.
 * · Guest: sign in first, then back to Contact.
 * · While auth loads: nothing, so a signed-in person never sees the guest chip flash (Help's StillNeedHelp does the same).
 * A client island so contact/page.tsx stays a server component.
 */
export function SupportChatChip() {
  const { tr } = useLanguage()
  const { user, loading } = useAuth()
  const { open, opening } = useOpenSupportThread()
  const [failed, setFailed] = useState(false)
  if (loading) return null
  const label = tr('Chat with support', 'Trò chuyện với đội hỗ trợ')
  if (!user) {
    return (
      <Link href="/signin?next=/contact" prefetch={false} className={CHIP}>
        <MessageCircle className="size-4" aria-hidden /> {label}
      </Link>
    )
  }
  return (
    <>
      <Button
        variant="bare"
        size="none"
        type="button"
        className={CHIP}
        aria-busy={opening || undefined}
        disabled={opening}
        onClick={async () => { setFailed(!(await open())) }}
      >
        <MessageCircle className="size-4" aria-hidden /> {label}
      </Button>
      {failed && (
        <p role="status" className="basis-full text-sm text-body">
          {tr('The chat did not open. Email us instead — it reaches the same team.', 'Không mở được cuộc trò chuyện. Hãy gửi email cho chúng tôi — email cũng đến đội hỗ trợ.')}
        </p>
      )}
    </>
  )
}
