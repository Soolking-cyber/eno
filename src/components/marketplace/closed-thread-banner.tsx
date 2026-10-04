'use client'

import Link from 'next/link'
import { Ban } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * The composer's stand-in on a thread CLOSED by a block (App Store gate `ugc-safety`; follow-up 2 of
 * 0a470ed98). Before it, the blocked side kept a live composer whose every send was refused with a
 * toast — the thread looked open and behaved shut. The server says which side closed it
 * (GET /api/conversations/[id] → `closed`), and the page renders this instead of the composer, the quick
 * replies and the armed reply.
 *
 * ⚠️ IT NAMES THE CONVERSATION, NEVER THE PERSON — the same rule as the Block button. The blocker gets
 * the way back (Settings › Privacy, where the block can be undone); the other side learns only that the
 * thread is closed, and is pointed at Report, which stays in the header for exactly this case.
 * Renders only when the server set `closed`, which it never does while the gate is off.
 */
export function ClosedThreadBanner({ closed, className }: { closed: 'you_blocked' | 'blocked'; className?: string }) {
  const { tr } = useLanguage()
  return (
    <div role="status" className={cn('flex items-start gap-2.5 border-t border-border bg-tint px-4 py-3', className)}>
      <Ban className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" aria-hidden />
      <p className="min-w-0 text-sm text-body">
        {closed === 'you_blocked' ? (
          <>
            {tr(
              'You blocked the other person in this conversation, so neither of you can send messages or offers here.',
              'Bạn đã chặn người kia trong cuộc trò chuyện này, nên cả hai bên đều không thể gửi tin nhắn hay trả giá ở đây.',
            )}{' '}
            <Link href="/dashboard/settings?tab=privacy" className="font-semibold text-accent-foreground hover:underline">
              {tr('Manage blocked users', 'Quản lý người đã chặn')}
            </Link>
          </>
        ) : (
          tr(
            'This conversation is closed. You can’t send messages or offers here. If something is wrong, use Report.',
            'Cuộc trò chuyện này đã đóng. Bạn không thể gửi tin nhắn hay trả giá ở đây. Nếu có vấn đề, hãy dùng Báo cáo.',
          )
        )}
      </p>
    </div>
  )
}
