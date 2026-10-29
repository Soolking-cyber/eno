'use client'

import { useEffect, useState } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { Flag } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { appReviewGate } from '@/lib/app-review-gates'
import { sendAiReport } from '@/lib/ai-report'

/** How long "Reported" / "Not sent" shows beside the flag. */
const SAID_MS = 4_000

/**
 * Report the voice guide's line on screen (Google Play, AI-Generated Content — src/lib/ai-report.ts). One tap: no form fits
 * the guide's window. It files the line as it stands; while that report is on its way the flag waits (10 s at most:
 * sendAiReport gives up), then "Reported" or "Not sent" shows beside it for a moment. The flag itself stays, for whatever is
 * on screen next (codex, round 4). The note belongs to the tap, not to the line now on screen.
 * ⚠️ NOTHING TIES IT TO A LINE (commit review, rounds 1–3): state keyed to the caption, then to the reply, then to the text,
 * each left a case where the flag showed the wrong thing — a growing caption, a repeated one, overlapping sends. Its own
 * state, never the guide's notice slot, which it could wipe ("I can't hear right now"). Renders NOTHING unless the
 * `ugc-safety` gate is on.
 */
export function GuideLineFlag({ line, href }: { line: string; href: () => string }) {
  const { tr } = useLanguage()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  useEffect(() => {
    if (state !== 'sent' && state !== 'failed') return
    const t = setTimeout(() => setState('idle'), SAID_MS)
    return () => clearTimeout(t)
  }, [state])
  if (!appReviewGate('ugc-safety')) return null

  const flag = async () => {
    if (state === 'sending') return
    setState('sending')
    setState((await sendAiReport({ surface: 'voice-guide', answer: line, url: href() })) ? 'sent' : 'failed')
  }
  return (
    <>
      {state === 'sent' && <span className="shrink-0 text-3xs text-primary-foreground/85">{tr('Reported', 'Đã báo cáo')}</span>}
      {state === 'failed' && <span className="shrink-0 text-3xs text-primary-foreground/85">{tr('Not sent', 'Chưa gửi')}</span>}
      <IconButton
        size="xs"
        variant="overlay"
        disabled={state === 'sending'}
        aria-label={state === 'failed'
          ? tr('Not sent — report this answer again', 'Chưa gửi — báo cáo lại câu trả lời này')
          : tr('Report this answer', 'Báo cáo câu trả lời này')}
        onClick={() => void flag()}
      >
        <Flag className="size-3" aria-hidden />
      </IconButton>
    </>
  )
}
