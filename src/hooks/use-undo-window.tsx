'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * AN ACTION THAT WAITS OUT AN UNDO WINDOW BEFORE IT REACHES THE SERVER.
 *
 * Owner, 2026-09-25, on Accept/Decline for a price offer: "Undo toast, 5 seconds". The screen shows
 * the result on the tap; the request goes out only when the window closes. Emil's rule for it: fast
 * where the system responds (the card flips at once), deliberate where the user decides (five seconds
 * to take it back, without a confirm dialog taxing every correct tap).
 *
 * ⛔ THE WINDOW IS OURS, NOT SONNER'S. The toast is created with `duration: Infinity` and dismissed by
 * this hook when the window closes. Sonner's own timer PAUSES while the toast is hovered, while the
 * stack is expanded and while the document is hidden, so tying the commit to its `onAutoClose` would
 * make "when does the POST go out" depend on where a mouse rests; and a toast that outlived the commit
 * would offer an Undo that could no longer undo anything. One clock, and the toast is only its view.
 *
 * ⛔ AN ANSWER IS NEVER SILENTLY DROPPED. Everything that ends the window without an Undo commits:
 *   · the timer running out                                    → commit('timer')
 *   · the component unmounting (the user navigated in-app)       → commit('leave')
 *   · `pagehide` (a full navigation, a reload, closing the tab)  → commit('leave')
 *   · `visibilitychange` → hidden (switching apps, locking the phone). ⚠️ Deliberately MORE eager than
 *     chat-context's pagehide-only flush of conversation deletes: a phone is free to discard a
 *     backgrounded tab without ever firing pagehide, and `hidden` is the last moment a mobile page can
 *     reliably run code. Losing the rest of an undo window to an app switch costs far less than an
 *     answer the user watched happen and the other party never receives. A reviewer called this "too
 *     aggressive" at plan time; this is the trade, made on purpose.
 * The caller learns WHICH through `via`. A 'leave' commit may run while the page is being torn down,
 * so whatever it sends must survive that (fetch `keepalive`). The offer thread sends EVERY answer with
 * keepalive, because a timer commit can be followed a moment later by a reload that would abort a
 * plain fetch still in flight.
 *
 * ⚠️ ONE WINDOW PER KEY, and several can be open at once — answering a second offer does not cut the
 * first one's window short (reviewer-caught at plan time; a single slot would have committed the first
 * answer early the moment a second was tapped).
 */

export const UNDO_WINDOW_MS = 5000

export type UndoCommitVia = 'timer' | 'leave'

export type UndoableAction = {
  /** Toast headline — what just happened, in the past tense ("Offer accepted"). */
  title: string
  /** Optional second line — for an offer, the amount, so the toast names WHICH answer it can undo. */
  description?: string
  undoLabel: string
  /** Send it. Called exactly once unless the user undoes, and never after an undo or a cancel. */
  commit: (via: UndoCommitVia) => void
  /** Put the screen back. Called at most once, only from the toast's Undo, only inside the window. */
  undo: () => void
}

type Entry = UndoableAction & { timer: ReturnType<typeof setTimeout>; toastId: string | number }

export function useUndoWindow(windowMs: number = UNDO_WINDOW_MS) {
  const entries = useRef(new Map<string, Entry>())

  /** Close a window without deciding what it meant: stop its clock and take its toast down. */
  const take = useCallback((key: string): Entry | null => {
    const entry = entries.current.get(key)
    if (!entry) return null
    entries.current.delete(key)
    clearTimeout(entry.timer)
    toast.dismiss(entry.toastId)
    return entry
  }, [])

  const flush = useCallback((key: string, via: UndoCommitVia) => {
    take(key)?.commit(via)
  }, [take])

  const flushAll = useCallback((via: UndoCommitVia) => {
    for (const key of [...entries.current.keys()]) flush(key, via)
  }, [flush])

  /** Drop a window with NEITHER commit nor undo — for when the server has already decided the question
   *  (the offer changed under the window), so sending would be refused and "undo" would be a lie. */
  const cancel = useCallback((key: string): boolean => take(key) !== null, [take])

  const isOpen = useCallback((key: string): boolean => entries.current.has(key), [])

  const start = useCallback((key: string, action: UndoableAction): boolean => {
    if (entries.current.has(key)) return false
    const toastId = toast(action.title, {
      description: action.description,
      duration: Infinity,
      /**
       * A real <Button>, not sonner's `{ label, onClick }` action. Sonner draws that one 24px tall, and
       * this is the one control that exists to take back a money decision: `tap-44` gives it a 44px hit
       * area (the toast's 16px padding holds the reach), and `relative` is what keeps the pseudo on the
       * button — see the tap-44 note in globals.css. ⚠️ The offer answer row DROPPED its tap-44 because
       * there the reaches of wrapped neighbours met; here the reach ends 6px out, inside this toast's own
       * padding, where the only other control is the close ✕ in the opposite corner — nothing for it to
       * steal, and the toast stays one line tall. Sonner does not auto-close a custom action, so the
       * click closes the window itself, through `take`, which also makes a late second tap a no-op.
       */
      action: (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="relative ml-auto font-bold tap-44"
          onClick={() => take(key)?.undo()}
        >
          {action.undoLabel}
        </Button>
      ),
    })
    const timer = setTimeout(() => flush(key, 'timer'), windowMs)
    entries.current.set(key, { ...action, timer, toastId })
    return true
  }, [flush, take, windowMs])

  useEffect(() => {
    const onPageHide = () => flushAll('leave')
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushAll('leave') }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
      // Unmounting is leaving: an in-app navigation away from the thread sends what is still waiting.
      flushAll('leave')
    }
  }, [flushAll])

  // ⚠️ ONE STABLE OBJECT. Callers put it in the deps of callbacks that effects depend on (the thread's
  // load() feeds its realtime subscription), and a fresh literal per render would re-run those effects
  // on every render.
  return useMemo(() => ({ start, cancel, isOpen, flushAll }), [start, cancel, isOpen, flushAll])
}
