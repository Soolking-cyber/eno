import { toast } from 'sonner'
import { readingTimeMs } from '@/lib/toast-timing'

/**
 * A REFUSAL — SOMETHING THE USER ASKED FOR DID NOT HAPPEN — STAYS LONG ENOUGH TO READ, AND TO ACT ON.
 *
 * The Toaster's 4s took these with it (Emil-skills audit, ask-sonner #2): a 26-word word-filter refusal, the
 * seller-identity block with its Verify button, "your answer to the offer may not have been sent" landing after
 * the user had already left the thread — and a phone has no hover to hold a toast open.
 *  · WITH a next step (Verify, Sign in, Open chat): 8–15s, the reading time plus the time to reach for it.
 *  · WITHOUT one: 4–10s, the reading time (src/lib/toast-timing.ts).
 *
 * ⚠️ BOUNDED, NOT `Infinity`, AND THAT WAS TRIED FIRST. A refusal parked until closed outlived the state it was
 * about: an "Open chat" into the previous account's thread after a sign-out, a "Sign in" offered to someone who
 * had just signed in from the header — and the toaster sits mid-screen (the owner's placement), so it parked
 * over the page as well. Every fix was another registry of toasts to sweep (review, 2026-10-07). A step missed
 * in 15s is not lost: the card shows the truth, Verify lives on the dashboard, Sign in in the header.
 *
 * ⚠️ `id` NAMES THE OPERATION, never the sentence: two threads refused with the same words must stay two toasts
 * (an id shared by sentence merged them, and the second's "Open chat" replaced the first's). The same operation
 * raised again replaces its own toast. `action` is always passed — undefined when there is no step — because
 * sonner MERGES an update into the toast with that id, and a missing key would keep the old button.
 */
export type ToastStep = { label: string; onClick: () => void }

export function refusalToast(message: string, opts: { id: string; step?: ToastStep | null }) {
  const step = opts.step ?? undefined
  return toast.error(message, {
    id: opts.id,
    action: step,
    duration: step ? readingTimeMs(message, 8000, 15_000) : readingTimeMs(message, 4000, 10_000),
  })
}
