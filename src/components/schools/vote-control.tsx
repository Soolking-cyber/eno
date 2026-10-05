'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { ArrowBigUp } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { formatInteger, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { ELIGIBLE_ACCOUNT_AGE_DAYS, VERIFY_IDENTITY_PATH } from '@/lib/schools/constants'
import { readVoteAck, useSchoolLive, writeVoteAck } from './school-live'

/**
 * ▲ score ▼ for one school — Reddit's control, with two eno rules on top (plan review 2026-10-04):
 * the first vote in a browser asks "I've worked or interviewed here as a teacher", and the answer says
 * when a young account's vote starts counting (read-time eligibility, src/lib/schools/queries.ts).
 */
export function VoteControl({ schoolId, schoolName, layout = 'column', size = 'md' }: {
  schoolId: string
  schoolName: string
  layout?: 'column' | 'row'
  size?: 'md' | 'lg'
}) {
  const { tr, lang } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const live = useSchoolLive()
  const [busy, setBusy] = React.useState(false)
  const [ackOpen, setAckOpen] = React.useState(false)
  const [ackChecked, setAckChecked] = React.useState(false)
  const pending = React.useRef<1 | -1 | null>(null)

  const c = live.counts[schoolId] ?? { up: 0, down: 0 }
  const net = c.up - c.down
  const mine = live.mine[schoolId] ?? 0

  async function send(value: 1 | -1 | 0) {
    const prev = mine
    const at = live.epoch // a late response from this session must not land in another account's
    setBusy(true)
    // A retraction does not move the public number optimistically: the vote may never have counted (a new
    // account), and the refresh below shows the real figure (diff review).
    if (value === 0) live.setMineOnly(schoolId, 0, at)
    else live.setMine(schoolId, value, prev, at)
    try {
      const res = await fetch(`/api/schools/${schoolId}/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value === 0 ? { value } : { value, confirm: true }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (value === 0) live.setMineOnly(schoolId, prev, at)
        else live.setMine(schoolId, prev, value, at)
        if (res.status === 401) { openSignIn({ note: tr('Sign in to vote on schools.', 'Đăng nhập để bình chọn trường.') }); return }
        toast.error(
          d.error === 'business_account' ? tr('Business accounts cannot vote on schools.', 'Tài khoản doanh nghiệp không thể bình chọn trường.')
          : d.error === 'account_restricted' ? tr('Your account cannot vote right now.', 'Tài khoản của bạn hiện không thể bình chọn.')
          : d.error === 'rate_limited' ? tr('Too many votes — try again later.', 'Bạn bình chọn quá nhiều — thử lại sau.')
          : tr('Your vote was not saved. Try again.', 'Chưa lưu được bình chọn. Thử lại nhé.'),
        )
        return
      }
      if (value !== 0 && d.countsNow === false) {
        // Stored, but not counted yet: the public number must not show it.
        live.undoCount(schoolId, value, prev, at)
        if (d.needsIdentity) {
          // One verified person, one vote (constants.ts VOTES_NEED_IDENTITY): say what makes it count — BOTH things
          // when a new account also has to wait for its age (diff review: "verify" alone was not the whole story).
          const young = typeof d.countsFrom === 'string' && new Date(d.countsFrom) > new Date()
          toast(young
            ? tr('Vote saved. It counts once you verify your identity and your account is {n} days old: one person, one vote.', 'Đã lưu bình chọn. Bình chọn sẽ được tính khi bạn xác minh danh tính và tài khoản được {n} ngày tuổi: mỗi người một phiếu.').replace('{n}', String(ELIGIBLE_ACCOUNT_AGE_DAYS))
            : tr('Vote saved. It counts once you verify your identity: one person, one vote.', 'Đã lưu bình chọn. Bình chọn sẽ được tính khi bạn xác minh danh tính: mỗi người một phiếu.'), {
            action: { label: tr('Verify', 'Xác minh'), onClick: () => { window.location.href = VERIFY_IDENTITY_PATH } },
          })
        } else {
          toast(tr(
            'Vote saved. It starts counting once your account is {n} days old.',
            'Đã lưu bình chọn. Bình chọn sẽ được tính khi tài khoản của bạn được {n} ngày tuổi.',
          ).replace('{n}', String(ELIGIBLE_ACCOUNT_AGE_DAYS)))
        }
      }
      live.refresh({ schools: [schoolId] })
    } catch {
      if (value === 0) live.setMineOnly(schoolId, prev, at)
      else live.setMine(schoolId, prev, value, at)
      toast.error(tr('Your vote was not saved. Try again.', 'Chưa lưu được bình chọn. Thử lại nhé.'))
    } finally {
      setBusy(false)
    }
  }

  function press(dir: 1 | -1) {
    // Not while the session is still resolving: a signed-in teacher must not be told to sign in.
    if (busy || loading) return
    if (!user) { openSignIn({ note: tr('Sign in to vote on schools.', 'Đăng nhập để bình chọn trường.') }); return }
    // Not before the visitor's own vote is known: a ▲ from someone who already voted ▲ must withdraw it.
    if (!live.ready) {
      if (live.failed) toast.error(tr('Your votes did not load. Refresh the page to vote.', 'Chưa tải được bình chọn của bạn. Hãy tải lại trang để bình chọn.'))
      return
    }
    const next = mine === dir ? 0 : dir
    if (next !== 0 && !readVoteAck(user.id, schoolId)) { pending.current = next; setAckChecked(false); setAckOpen(true); return }
    void send(next)
  }

  // Visibly waiting while a signed-in visitor's own votes load (a silent tap reads as broken).
  const loadingMine = loading || (!!user && !live.ready && !live.failed)
  const big = size === 'lg'
  const btn = 'text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50'
  return (
    <>
      <div className={cn('flex items-center', layout === 'column' ? 'flex-col gap-0.5' : 'flex-row gap-1.5')}>
        <IconButton
          size={big ? 'lg' : 'md'}
          className={cn(btn, mine === 1 && 'bg-brand-50 text-brand hover:bg-brand-100 dark:bg-brand/20')}
          aria-pressed={mine === 1}
          aria-label={tr('Recommend {name}', 'Đề xuất {name}').replace('{name}', schoolName)}
          onClick={() => press(1)}
          disabled={busy || loadingMine}
        >
          <ArrowBigUp aria-hidden className={big ? 'size-7' : 'size-6'} />
        </IconButton>
        <span className={cn('min-w-8 text-center font-bold tabular-nums', big ? 'text-lg' : 'text-sm', mine === 1 && 'text-brand', mine === -1 && 'text-destructive')}
          aria-label={tr('Score {n}', 'Điểm {n}').replace('{n}', String(net))}>
          {formatInteger(net, moneyLocale(lang))}
        </span>
        <IconButton
          size={big ? 'lg' : 'md'}
          className={cn(btn, mine === -1 && 'bg-destructive/10 text-destructive hover:bg-destructive/15')}
          aria-pressed={mine === -1}
          aria-label={tr("Don't recommend {name}", 'Không đề xuất {name}').replace('{name}', schoolName)}
          onClick={() => press(-1)}
          disabled={busy || loadingMine}
        >
          <ArrowBigUp aria-hidden className={cn(big ? 'size-7' : 'size-6', 'rotate-180')} />
        </IconButton>
      </div>

      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr('Votes are for teachers who were there', 'Bình chọn dành cho giáo viên từng làm việc tại đây')}</DialogTitle>
            <DialogDescription>
              {tr(
                'Vote only on schools and centres where you worked, or interviewed, as a teacher. One person, one vote: votes count from individual accounts with a verified identity, in good standing and at least {n} days old. Who voted is never shown.',
                'Chỉ bình chọn cho trường hoặc trung tâm nơi bạn từng làm việc hoặc phỏng vấn với vai trò giáo viên. Mỗi người một phiếu: bình chọn được tính từ tài khoản cá nhân đã xác minh danh tính, uy tín và đã tạo ít nhất {n} ngày. Không ai thấy bạn đã bình chọn.',
              ).replace('{n}', String(ELIGIBLE_ACCOUNT_AGE_DAYS))}
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 text-sm text-foreground">
            <Checkbox checked={ackChecked} onChange={setAckChecked} className="mt-0.5" />
            <span>{tr("I've worked or interviewed here as a teacher.", 'Tôi từng làm việc hoặc phỏng vấn tại đây với vai trò giáo viên.')}</span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckOpen(false)}>{tr('Cancel', 'Huỷ')}</Button>
            <Button
              variant="cta"
              disabled={!ackChecked}
              onClick={() => {
                if (user) writeVoteAck(user.id, schoolId)
                setAckOpen(false)
                const v = pending.current
                pending.current = null
                if (v) void send(v)
              }}
            >
              {tr('Vote', 'Bình chọn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
