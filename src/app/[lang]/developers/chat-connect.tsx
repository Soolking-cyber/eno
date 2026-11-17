import { buttonVariants } from '@/components/ui/button'
import { ArrowUpRight } from '@/components/ui/icons'
import { CHAT_APP_CONNECTS } from '@/lib/ai-chat-connect'
import { cn } from '@/lib/utils'

/**
 * "Add to Claude" (and each chat app as its directory approves eno.vn — src/lib/ai-chat-connect.ts): the app's own page, whose
 * Connect signs in with eno.vn. Plain links in the outline button's look, not <Button>: these pages ship no client script.
 */
export function ChatAppConnect({ className }: { className?: string }) {
  if (!CHAT_APP_CONNECTS.length) return null
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {CHAT_APP_CONNECTS.map(({ app, href }) => (
        <li key={app}>
          <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>
            Add to {app}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
