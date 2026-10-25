'use client'

import { useMemo, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel } from './panel'

/**
 * THE PARENT GATE (plan: "Parent controls … sit behind a simple parent gate"): children practise on the parent's phone, so
 * leaving a class, withdrawing consent or deleting a child's profile first asks a sum a young child cannot do at a glance —
 * the kids-app convention. A speed bump, not security: the account is the parent's.
 */
export function ParentGate({ open, onOpenChange, onPass }: { open: boolean; onOpenChange: (open: boolean) => void; onPass: () => void }) {
  const { tr } = useLanguage()
  const [answer, setAnswer] = useState('')
  const [wrong, setWrong] = useState(false)
  // A fresh sum each time the gate opens: two numbers 6–14, multiplied.
  const [a, b] = useMemo(() => (open ? [6 + Math.floor(Math.random() * 9), 6 + Math.floor(Math.random() * 9)] : [0, 0]), [open])
  // A sum, not words: the same in every language, so it is built here rather than translated.
  const question = `${a} × ${b} = ?`
  const check = () => {
    if (Number(answer.trim()) === a * b) { setAnswer(''); setWrong(false); onPass() } else setWrong(true)
  }
  return (
    <Panel open={open} onOpenChange={(o) => { setAnswer(''); setWrong(false); onOpenChange(o) }}
      title={tr('For parents', 'Dành cho phụ huynh')}
      description={tr('Answer to continue.', 'Trả lời để tiếp tục.')}
      footer={<Button variant="cta" className="flex-1" onClick={check} disabled={!answer.trim()}>{tr('Continue', 'Tiếp tục')}</Button>}>
      <label className="flex flex-col gap-2">
        <span className="text-base font-semibold text-ink">{question}</span>
        <Input inputMode="numeric" autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => { if (e.key === 'Enter') check() }} aria-invalid={wrong} />
        {wrong && <span role="alert" className="text-sm text-destructive">{tr('Not quite — try again.', 'Chưa đúng — thử lại nhé.')}</span>}
      </label>
    </Panel>
  )
}
