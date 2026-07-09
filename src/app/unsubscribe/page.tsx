'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Mail, Check } from 'lucide-react'

// Public, token-scoped email-preference page (no login). The visible footer link in the
// digest lands here; a click POSTs to /api/unsubscribe so a link scanner's GET never
// unsubscribes anyone. Also offers a one-tap re-subscribe.
export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-muted" />}>
      <UnsubscribeInner />
    </Suspense>
  )
}

function UnsubscribeInner() {
  const token = useSearchParams().get('token') ?? ''
  const [state, setState] = useState<'idle' | 'saving' | 'unsubscribed' | 'resubscribed' | 'error'>('idle')

  const set = async (optIn: boolean) => {
    if (!token) { setState('error'); return }
    setState('saving')
    try {
      const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optIn }),
      })
      setState(res.ok ? (optIn ? 'resubscribed' : 'unsubscribed') : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-tint">
          {state === 'unsubscribed' ? <Check className="h-6 w-6 text-accent-foreground" /> : <Mail className="h-6 w-6 text-accent-foreground" />}
        </div>

        {state === 'unsubscribed' ? (
          <>
            <h1 className="mt-4 text-xl font-bold text-foreground">You're unsubscribed</h1>
            <p className="mt-2 text-sm text-muted-foreground">You won't get the weekly eno.vn digest anymore. Changed your mind?</p>
            <button onClick={() => set(true)} className="mt-5 rounded-xl border border-border px-5 py-2.5 text-sm font-bold text-accent-foreground transition-colors hover:bg-tint cursor-pointer">
              Re-subscribe
            </button>
          </>
        ) : state === 'resubscribed' ? (
          <>
            <h1 className="mt-4 text-xl font-bold text-foreground">You're back in</h1>
            <p className="mt-2 text-sm text-muted-foreground">You'll receive the weekly eno.vn digest again.</p>
          </>
        ) : state === 'error' ? (
          <>
            <h1 className="mt-4 text-xl font-bold text-foreground">That link didn't work</h1>
            <p className="mt-2 text-sm text-muted-foreground">The unsubscribe link is invalid or expired. You can manage email preferences from your account settings.</p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-xl font-bold text-foreground">Unsubscribe from the weekly digest?</h1>
            <p className="mt-2 text-sm text-muted-foreground">Stop receiving the weekly "top products & moving sales" email from eno.vn.</p>
            <Button
              variant="cta"
              size="none"
              onClick={() => set(false)}
              disabled={state === 'saving' || !token}
              className="mt-5 w-full py-2.5 cursor-pointer"
            >
              {state === 'saving' ? 'Saving…' : 'Unsubscribe'}
            </Button>
          </>
        )}

        <div className="mt-6">
          <Link href="/" className="text-xs font-medium text-muted-foreground hover:text-foreground">← Back to eno.vn</Link>
        </div>
      </div>
    </div>
  )
}
