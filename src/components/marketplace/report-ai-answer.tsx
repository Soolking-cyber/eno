'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Flag, CheckCircle2 } from '@/components/ui/icons'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'
import { Button } from '@/components/ui/button'
import { RadioGroup, Radio, RadioDot } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/context/language-context'
import { appReviewGate } from '@/lib/app-review-gates'
import { AI_REPORT_NOTE_MAX, AI_REPORT_REASONS, sendAiReport, type AiReportReason } from '@/lib/ai-report'
import { cn } from '@/lib/utils'

/**
 * "Report" under an answer eno AI gave in the chat (src/lib/ai-report.ts: where it goes and why). The quiet per-item Report
 * of reviews and help replies (report-content-button.tsx) and the same dialog (report-button.tsx), with the reasons an AI
 * answer can have. Renders NOTHING unless the `ugc-safety` gate is on.
 *
 * ⚠️ THE DIALOG MOUNTS ONLY WHEN ASKED FOR: one per answer would be a Base UI dialog root per bubble, for a control that
 * is almost never opened (report-content-button.tsx).
 */
export function ReportAiAnswer({ answer, className }: { answer: string; className?: string }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  if (!appReviewGate('ugc-safety')) return null
  return (
    <>
      <Button
        type="button"
        variant="bare"
        size="none"
        onClick={() => setOpen(true)}
        className={cn(
          'relative tap-44 gap-1 rounded-full px-2 py-1 text-2xs font-semibold text-ink-4 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40',
          className,
        )}
      >
        <Flag className="size-3" aria-hidden /> {tr('Report', 'Báo cáo')}
      </Button>
      {open && <ReportAiDialog answer={answer} onClose={() => setOpen(false)} />}
    </>
  )
}

function ReportAiDialog({ answer, onClose }: { answer: string; onClose: () => void }) {
  const { tr } = useLanguage()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const submit = async () => {
    if (!reason || state === 'sending') return
    setState('sending')
    const ok = await sendAiReport({ surface: 'assistant', reason: reason as AiReportReason, note, answer, url: window.location.href })
    setState(ok ? 'sent' : 'failed')
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="bg-popover rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-bold text-foreground">
            {tr('Report this answer', 'Báo cáo câu trả lời này')}
          </DialogTitle>
        </DialogHeader>

        {state === 'sent' ? (
          <div className="mt-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" strokeWidth={STROKE_DISPLAY} />
            <p className="mt-3 text-sm font-semibold text-foreground">{tr('Report sent', 'Đã gửi báo cáo')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {tr('Thank you. Our team reads every report about eno AI.', 'Cảm ơn bạn. Đội ngũ của chúng tôi đọc mọi báo cáo về eno AI.')}
            </p>
            <Button type="button" variant="soft" size="none" onClick={onClose} className="mt-4 w-full px-6 py-2 font-semibold text-muted-foreground transition-colors">
              {tr('Close', 'Đóng')}
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-center text-sm text-muted-foreground">
              {tr('What is wrong with this answer?', 'Câu trả lời này có vấn đề gì?')}
            </p>
            {/* `flex flex-col gap`, never `space-y`: Base UI's Radio renders a hidden input beside each row (report-button.tsx). */}
            <RadioGroup value={reason} onValueChange={setReason} aria-label={tr('Reason', 'Lý do')} className="flex flex-col gap-1.5">
              {AI_REPORT_REASONS.map((r) => (
                <Radio
                  key={r.value}
                  value={r.value}
                  className={cn(
                    'flex w-full items-center justify-start gap-2.5 whitespace-normal rounded-xl border px-3 py-2.5 text-left text-sm font-normal transition-colors',
                    reason === r.value ? 'border-brand font-semibold text-accent-foreground' : 'border-border text-foreground hover:bg-muted',
                  )}
                >
                  <RadioDot />
                  {tr(r.en, r.vi)}
                </Radio>
              ))}
            </RadioGroup>

            <Textarea
              variant="filled"
              size="compact"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={AI_REPORT_NOTE_MAX}
              placeholder={tr('Details (optional)', 'Chi tiết (không bắt buộc)')}
              className="px-3 py-2 focus:ring-brand/20"
            />

            {state === 'failed' && (
              <p role="alert" className="text-center text-xs font-semibold text-destructive">
                {tr('Could not send — please try again.', 'Chưa gửi được — vui lòng thử lại.')}
              </p>
            )}

            <Button
              variant="cta"
              size="none"
              onClick={() => void submit()}
              loading={state === 'sending'}
              disabled={!reason}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm disabled:opacity-40 transition-colors cursor-pointer"
            >
              {tr('Submit report', 'Gửi báo cáo')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
