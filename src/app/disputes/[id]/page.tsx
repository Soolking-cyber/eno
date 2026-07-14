'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { Check, CheckCircle2, Clock, ImagePlus, Info, Loader2, Scale, Shield, X, XCircle } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { compressImageFile } from '@/lib/normalize-image'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

// The dispute case room (Binance-P2P style): one shared timeline where the reporter,
// the respondent and the eno.vn team exchange statements + evidence during the
// evidence window, then the team decides. Identity rules are enforced server-side:
// the respondent never sees who filed the report; admin rows render as "eno.vn".
// Polling (20s + focus) — deliberately no realtime at this volume.

type TimelineItem = {
  id: string
  kind: 'message' | 'system' | 'decision'
  role: 'reporter' | 'respondent' | 'admin' | 'system'
  body: string
  images: string[]
  at: string
}

type CaseData = {
  id: string
  role: 'reporter' | 'respondent'
  reason: string
  status: string
  stage: 'evidence' | 'review' | 'decided'
  canPost: boolean
  submitted: boolean
  withdrawn: boolean
  createdAt: string
  evidenceUntil: string | null
  resolvedAt: string | null
  decisionNote: string | null
  conversationId: string | null
  listing: { id: string; title: string; image: string | null } | null
  counterparty: string | null
  timeline: TimelineItem[]
}

const REASON_LABELS: Record<string, [string, string]> = {
  scam: ['Scam', 'Lừa đảo'],
  counterfeit: ['Counterfeit', 'Hàng giả / nhái'],
  sold: ['Already sold', 'Đã bán / hết hàng'],
  'wrong-info': ['Wrong info', 'Thông tin sai'],
  duplicate: ['Duplicate', 'Tin trùng lặp'],
  offensive: ['Offensive / harassment', 'Phản cảm / quấy rối'],
  other: ['Other', 'Khác'],
}

function useCountdown(iso: string | null): string | null {
  const [, force] = useState(0)
  useEffect(() => {
    if (!iso) return
    const t = setInterval(() => force((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [iso])
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`
}

export default function DisputeRoomPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const t = (en: string, vi: string) => tr(en, vi)

  const [data, setData] = useState<CaseData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<{ url: string; file: File }[]>([])
  const [sending, setSending] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/disputes/${id}`)
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) return
      const d = (await res.json()) as CaseData
      setData(d)
    } catch { /* poll again */ }
  }, [id])

  useEffect(() => {
    if (!user) return
    load()
    const poll = setInterval(load, 20_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(poll); window.removeEventListener('focus', onFocus) }
  }, [user, load])

  const countdown = useCountdown(data?.stage === 'evidence' ? data.evidenceUntil : null)

  const addFiles = async (list: FileList | null) => {
    if (!list) return
    const arr = Array.from(list).slice(0, 6 - files.length)
    const next = await Promise.all(arr.map(async (f) => ({ url: URL.createObjectURL(f), file: await compressImageFile(f) })))
    setFiles((p) => [...p, ...next].slice(0, 6))
  }

  const send = async () => {
    if (!data || (text.trim().length === 0 && files.length === 0)) return
    setSending(true); setError('')
    try {
      let paths: string[] = []
      if (files.length) {
        const form = new FormData()
        for (const f of files) form.append('files', f.file)
        const up = await fetch(`/api/disputes/${data.id}/evidence`, { method: 'POST', body: form })
        const uj = (await up.json().catch(() => null)) as { paths?: string[]; error?: string } | null
        if (!up.ok || !uj?.paths) {
          if (uj?.error === 'already_submitted') { await load(); return } // already spoke — show the locked state
          setError(uj?.error === 'window_closed'
            ? t('The evidence window has closed.', 'Đã hết thời gian nộp bằng chứng.')
            : t('Could not upload the photos — try again.', 'Không tải được ảnh — thử lại.'))
          return
        }
        paths = uj.paths
      }
      const res = await fetch(`/api/disputes/${data.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text.trim(), images: paths }),
      })
      if (!res.ok) {
        const code = (await res.json().catch(() => null))?.error as string | undefined
        if (code === 'already_submitted') { setText(''); setFiles([]); await load(); return } // one-shot done — show locked state
        setError(code === 'window_closed'
          ? t('The evidence window has closed.', 'Đã hết thời gian nộp bằng chứng.')
          : code === 'rate_limited'
            ? t('Too many messages — try again later.', 'Quá nhiều tin nhắn — thử lại sau.')
            : t('Could not send — try again.', 'Không gửi được — thử lại.'))
        return
      }
      setText(''); setFiles([])
      await load()
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    } catch {
      setError(t('Could not send — try again.', 'Không gửi được — thử lại.'))
    } finally {
      setSending(false)
    }
  }

  const withdraw = async () => {
    if (!data) return
    setWithdrawing(true); setError('')
    try {
      const res = await fetch(`/api/disputes/${data.id}/withdraw`, { method: 'POST' })
      if (!res.ok) { setError(t('Could not withdraw — try again.', 'Không rút lại được — thử lại.')); return }
      setConfirmWithdraw(false)
      await load()
    } finally {
      setWithdrawing(false)
    }
  }

  // Who is the OTHER party, from the viewer's seat? (Reporter identity is never
  // shown to the respondent — role label only.)
  const otherLabel = data?.role === 'reporter'
    ? (data.counterparty || t('Seller', 'Người bán'))
    : t('Reporter', 'Người báo cáo')

  const reasonLabel = (r: string) => { const [en, vi] = REASON_LABELS[r] || REASON_LABELS.other; return t(en, vi) }

  const decisionCopy = (d: CaseData) => {
    if (d.withdrawn) return { icon: XCircle, cls: 'text-ink-4', text: t('Case withdrawn by the reporter.', 'Người báo cáo đã rút lại hồ sơ.') }
    if (d.status === 'confirmed') return { icon: CheckCircle2, cls: 'text-success', text: t('Resolved — the report was upheld and action was taken.', 'Đã xử lý — báo cáo được xác nhận và đã có biện pháp.') }
    if (d.status === 'abusive') return { icon: XCircle, cls: 'text-destructive', text: t('Closed — the report was found inaccurate or abusive.', 'Đã đóng — báo cáo bị xác định là sai sự thật.') }
    return { icon: CheckCircle2, cls: 'text-ink-4', text: t('Closed — no violation was found.', 'Đã đóng — không phát hiện vi phạm.') }
  }

  const STAGES: { key: string; en: string; vi: string }[] = [
    { key: 'filed', en: 'Filed', vi: 'Đã gửi' },
    { key: 'evidence', en: 'Evidence', vi: 'Bằng chứng' },
    { key: 'review', en: 'Review', vi: 'Xem xét' },
    { key: 'decision', en: 'Decision', vi: 'Quyết định' },
  ]
  const stageIndex = data ? (data.stage === 'evidence' ? 1 : data.stage === 'review' ? 2 : 3) : 0

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-accent-foreground" /></div>
        ) : !user ? (
          <div className="mt-10 text-center">
            <Scale className="mx-auto h-10 w-10 text-ink-4" />
            <p className="mt-3 text-sm text-muted-foreground">{t('Sign in to view this dispute case.', 'Đăng nhập để xem hồ sơ khiếu nại này.')}</p>
            <div className="mt-4"><SignInPrompt /></div>
          </div>
        ) : notFound ? (
          <div className="mt-10 text-center">
            <Scale className="mx-auto h-10 w-10 text-ink-4" />
            <p className="mt-3 text-sm font-semibold text-foreground">{t('Case not found', 'Không tìm thấy hồ sơ')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('It may have been removed, or it belongs to another account.', 'Hồ sơ có thể đã bị xóa hoặc thuộc tài khoản khác.')}</p>
            <Link href="/disputes" className="mt-4 inline-block rounded-xl px-4 py-2 text-sm font-bold text-accent-foreground transition-colors hover:bg-muted">{t('All disputes', 'Tất cả khiếu nại')}</Link>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-accent-foreground" /></div>
        ) : (
          <>
            {/* ── Case header ── */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href="/disputes" className="text-xs font-bold text-accent-foreground hover:underline">{t('← All disputes', '← Tất cả khiếu nại')}</Link>
                <h1 className="h-title mt-1 text-foreground">
                  {reasonLabel(data.reason)}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {data.role === 'reporter'
                    ? t('You reported', 'Bạn đã báo cáo') + (data.counterparty ? ` ${data.counterparty}` : '')
                    : t('A report concerns you — share your side below.', 'Có báo cáo liên quan đến bạn — hãy trình bày phía bạn bên dưới.')}
                </p>
              </div>
              <Scale className="mt-1 h-6 w-6 shrink-0 text-accent-foreground" />
            </div>

            {/* ── Status stepper ── */}
            <ol className="mt-5 flex items-center gap-0">
              {STAGES.map((s, i) => (
                <li key={s.key} className={cn('flex items-center', i > 0 && 'flex-1')}>
                  {i > 0 && <span className={cn('mx-1.5 h-px flex-1', i <= stageIndex ? 'bg-brand' : 'bg-line-strong')} />}
                  <span className="flex flex-col items-center gap-1">
                    <span className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-3xs font-bold',
                      i < stageIndex ? 'bg-primary text-white' : i === stageIndex ? 'bg-primary text-white' : 'bg-tint text-ink-4',
                    )}>
                      {i < stageIndex ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className={cn('text-3xs font-semibold', i <= stageIndex ? 'text-foreground' : 'text-ink-4')}>{t(s.en, s.vi)}</span>
                  </span>
                </li>
              ))}
            </ol>

            {/* ── Window / decision banner ── */}
            {data.stage === 'evidence' && countdown && (
              <p className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-accent-foreground">
                <Clock className="h-4 w-4" />
                {t('Evidence window:', 'Thời hạn nộp bằng chứng:')} {countdown} {t('left', 'còn lại')}
              </p>
            )}
            {data.stage === 'review' && (
              <p className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-warning">
                <Shield className="h-4 w-4" />
                {t('Under review — the eno.vn team is deciding. Reviews typically finish within 48 hours.', 'Đang xem xét — đội ngũ eno.vn sẽ quyết định, thường trong vòng 48 giờ.')}
              </p>
            )}
            {data.stage === 'decided' && (() => {
              const d = decisionCopy(data)
              return (
                <div className="mt-4">
                  <p className={cn('flex items-center gap-1.5 text-sm font-bold', d.cls)}>
                    <d.icon className="h-4 w-4" /> {d.text}
                  </p>
                  {data.decisionNote && <p className="mt-1 whitespace-pre-wrap pl-6 text-sm text-body">{data.decisionNote}</p>}
                  {data.role === 'respondent' && data.status === 'confirmed' && (
                    <Link href={`/appeal/${data.id}`} className="mt-2 inline-block pl-6 text-sm font-bold text-accent-foreground hover:underline">
                      {t('Appeal with proof →', 'Khiếu nại kèm bằng chứng →')}
                    </Link>
                  )}
                </div>
              )
            })()}

            {/* ── Context row: listing + conversation ── */}
            {(data.listing || data.conversationId) && (
              <div className="mt-4 flex items-center gap-3">
                {data.listing && (
                  <Link href={`/listings/${data.listing.id}`} className="flex min-w-0 items-center gap-2.5 -ml-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted">
                    {data.listing.image
                      ? <Image src={data.listing.image} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                      : <span className="h-9 w-9 shrink-0 rounded-lg bg-tint" />}
                    <span className="truncate text-sm font-semibold text-foreground">{data.listing.title}</span>
                  </Link>
                )}
                {data.conversationId && (
                  <Link href={`/messages/${data.conversationId}`} className="shrink-0 text-sm font-bold text-accent-foreground hover:underline">
                    {t('View conversation', 'Xem trò chuyện')}
                  </Link>
                )}
              </div>
            )}

            {/* ── Timeline ── */}
            <div className="mt-6 space-y-4">
              {data.timeline.length === 0 && (
                <p className="text-center text-sm text-ink-4">{t('No statements yet.', 'Chưa có nội dung nào.')}</p>
              )}
              {data.timeline.map((item) => {
                if (item.kind === 'system' || item.kind === 'decision') {
                  return (
                    <div key={item.id} className="text-center">
                      <Badge size="md" className="px-3 py-1 font-semibold text-body whitespace-normal">
                        {item.kind === 'decision' ? (decisionCopy(data).text + (item.body ? ` — ${item.body}` : '')) : item.body}
                      </Badge>
                      <p className="mt-0.5 text-3xs text-ink-4">{new Date(item.at).toLocaleString()}</p>
                    </div>
                  )
                }
                const mine = item.role === data.role
                const who = mine ? t('You', 'Bạn') : item.role === 'admin' ? 'eno.vn' : otherLabel
                return (
                  <div key={item.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                    <div className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5',
                      item.role === 'admin' ? 'bg-accent' : mine ? 'bg-primary/10' : 'bg-tint',
                    )}>
                      {item.role === 'admin' && (
                        <p className="mb-1 flex items-center gap-1 text-2xs font-bold text-accent-foreground"><Shield className="h-3 w-3" /> eno.vn</p>
                      )}
                      {item.body && <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{item.body}</p>}
                      {item.images.length > 0 && (
                        <div className={cn('flex flex-wrap gap-2', item.body && 'mt-2')}>
                          {item.images.map((src, i) => (
                            <a key={i} href={src} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-xl bg-background/50">
                              {/* Signed URLs expire hourly — plain <img>, never the Next image cache. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="mt-0.5 px-1 text-3xs text-ink-4">{who} · {new Date(item.at).toLocaleString()}</span>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>

            {/* ── Composer (one-shot: each side submits a single statement) ── */}
            {data.canPost ? (
              <div className="mt-6">
                {/* One-shot notice — you submit ONCE, so put everything in now. */}
                <div className="mb-2 flex items-start gap-2 rounded-xl bg-tint px-3 py-2 text-xs text-body">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
                  <span>{t('You can submit your statement once — add all your details and photos before sending. The reviewer decides from what both sides submit.', 'Bạn chỉ gửi được một lần — hãy bổ sung đầy đủ chi tiết và ảnh trước khi gửi. Người xem xét sẽ quyết định dựa trên nội dung cả hai bên gửi.')}</span>
                </div>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  aria-label={t('Your statement', 'Trình bày của bạn')}
                  placeholder={data.role === 'reporter'
                    ? t('Explain what happened and attach any proof — this is your one statement.', 'Giải thích sự việc và đính kèm bằng chứng — đây là lần trình bày duy nhất của bạn.')
                    : t('Share your side and attach any proof — this is your one statement.', 'Trình bày phía bạn và đính kèm bằng chứng — đây là lần trình bày duy nhất của bạn.')}
                  className="min-h-0 resize-none"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {files.map((f, i) => (
                    <div key={i} className="relative h-16 w-16 overflow-hidden rounded-xl bg-tint">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt="" className="h-full w-full object-cover" />
                      {/* NOT IconButton: its xs box is h-7 and it bakes a 44px tap target,
                          which would spill onto the neighbouring gap-2 thumbnail. */}
                      <Button
                        variant="bare" size="none"
                        onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}
                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {files.length < 6 && (
                    <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl text-ink-4 transition-colors hover:bg-muted">
                      <ImagePlus className="h-5 w-5" />
                      <span className="text-3xs font-semibold">{t('Evidence', 'Bằng chứng')}</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
                    </label>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="cta" size="none"
                      onClick={send}
                      disabled={sending || (text.trim().length === 0 && files.length === 0)}
                      className={cn(
                        'px-5 py-2.5 active:scale-[0.98] cursor-pointer',
                        (sending || (text.trim().length === 0 && files.length === 0)) && 'opacity-40 cursor-default',
                      )}
                    >
                      {sending && <Loader2 className="h-4 w-4 animate-spin" />} {t('Send', 'Gửi')}
                    </Button>
                  </div>
                </div>
                {error && <p role="alert" className="mt-2 text-xs font-semibold text-destructive">{error}</p>}
                <p className="mt-3 text-xs leading-relaxed text-ink-4">
                  {t('Screenshots of payments, chats or the item help most. The other party and the eno.vn team can see what you post. Photos are stored privately and only visible inside this case.', 'Ảnh chụp thanh toán, trò chuyện hoặc sản phẩm là hữu ích nhất. Bên còn lại và đội ngũ eno.vn sẽ thấy nội dung bạn gửi. Ảnh được lưu riêng tư và chỉ hiển thị trong hồ sơ này.')}
                </p>
              </div>
            ) : data.submitted && data.status === 'open' ? (
              // One-shot done: this party has spoken; they wait for the other side + review.
              <div className="mt-6 rounded-2xl bg-tint px-4 py-4 text-center">
                <Check className="mx-auto h-6 w-6 text-success" />
                <p className="mt-1.5 text-sm font-semibold text-foreground">{t('Your statement is in', 'Đã nhận phần trình bày của bạn')}</p>
                <p className="mt-0.5 text-xs text-ink-4">
                  {t('The other side has until the window closes to add theirs, then the eno.vn team reviews and decides. If they add nothing, your account stands.', 'Bên còn lại có thời gian đến khi hết hạn để bổ sung, sau đó đội ngũ eno.vn xem xét và quyết định. Nếu họ không bổ sung, phần trình bày của bạn được giữ nguyên.')}
                </p>
              </div>
            ) : data.status === 'open' ? (
              <p className="mt-6 text-center text-sm text-ink-4">
                {t('The evidence window has closed — the case is with the review team.', 'Đã hết thời gian nộp bằng chứng — hồ sơ đang chờ đội xem xét.')}
              </p>
            ) : null}
            {/* Withdraw — reporter-only, available for the whole time the case is open
                (independent of the one-shot composer, which closes once they've spoken). */}
            {data.role === 'reporter' && data.status === 'open' && (
              <div className="mt-3 text-center">
                {confirmWithdraw ? (
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-body">
                    {t('Withdraw this case?', 'Rút lại hồ sơ này?')}
                    <Button variant="bare" size="none" onClick={withdraw} disabled={withdrawing} className="disabled:opacity-100 text-xs font-bold text-destructive hover:underline cursor-pointer">{withdrawing ? '…' : t('Yes', 'Có')}</Button>
                    <Button variant="bare" size="none" onClick={() => setConfirmWithdraw(false)} className="text-xs font-bold text-ink-4 hover:underline cursor-pointer">{t('No', 'Không')}</Button>
                  </span>
                ) : (
                  <Button variant="soft" size="none" onClick={() => setConfirmWithdraw(true)} className="rounded-xl px-3 py-2 text-xs font-bold text-ink-4 cursor-pointer">
                    {t('Withdraw this case', 'Rút lại hồ sơ')}
                  </Button>
                )}
              </div>
            )}
            {error && !data.canPost && <p role="alert" className="mt-2 text-center text-xs font-semibold text-destructive">{error}</p>}
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
