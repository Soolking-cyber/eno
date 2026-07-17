'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Loader2,
  MapPinned,
  MessageCircleQuestion,
  MessageSquareText,
  Route,
  Sparkles,
  Store,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { forumApi } from '@/lib/api'
import { formatVnd } from '@/components/itinerary/itinerary-data'
import { localeForLanguage } from '@/lib/languages'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn').replace(/\/$/, '')

type SavedItineraryDay = {
  id: string
  dayNumber: number
  area: string
  title: string
  morning: string
  afternoon: string
  evening: string
}

type SavedItinerary = {
  id: string
  title: string
  destinationId: string
  days: number
  budgetId: string
  interests: string[]
  estimatedBudget: number | null
  currency: string
  generatedAt: string | null
  updatedAt: string
  dayPlans: SavedItineraryDay[]
  stays: Array<{ id: string; name: string; area: string; note: string | null; estimatedNightly: number | null }>
}

type VisaSummary = {
  id: string
  status: string
  updatedAt: string
}

function ServiceCard({ href, icon: Icon, title, detail, external = false }: {
  href: string
  icon: LucideIcon
  title: string
  detail: string
  external?: boolean
}) {
  const content = <><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground"><Icon className="h-5 w-5" /></span><span className="min-w-0"><span className="block font-bold text-foreground">{title}</span><span className="mt-1 block text-xs leading-relaxed text-body">{detail}</span></span></>
  const className = 'flex min-h-24 items-start gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
  return external
    ? <a href={href} className={className}>{content}</a>
    : <Link href={href} className={className}>{content}</Link>
}

export function EnoDashboard() {
  const { user, loading: authLoading, openSignIn } = useAuth()
  const { tr, lang } = useLanguage()
  const [itineraries, setItineraries] = useState<SavedItinerary[]>([])
  const [visas, setVisas] = useState<VisaSummary[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setItineraries([])
      setVisas([])
      return
    }
    let active = true
    setLoading(true)
    void Promise.allSettled([
      forumApi<{ itineraries: SavedItinerary[] }>('/api/itineraries', { auth: 'required' }),
      forumApi<{ applications: VisaSummary[] }>('/api/visa/applications', { auth: 'required', direct: true }),
    ]).then(([itineraryResult, visaResult]) => {
      if (!active) return
      if (itineraryResult.status === 'fulfilled') setItineraries(itineraryResult.value.itineraries)
      else toast.error(tr('Saved itineraries could not be loaded.', 'Không thể tải lịch trình đã lưu.'))
      if (visaResult.status === 'fulfilled') setVisas(visaResult.value.applications)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [tr, user])

  if (authLoading) return <main className="mx-auto flex min-h-[55vh] w-full max-w-7xl items-center justify-center px-3"><Loader2 className="h-6 w-6 animate-spin text-accent-foreground" /><span className="sr-only">{tr('Loading account', 'Đang tải tài khoản')}</span></main>

  if (!user) return <main id="main" tabIndex={-1} className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-3 py-12 sm:px-6"><Card className="w-full items-center px-5 py-10 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground"><Sparkles className="h-6 w-6" /></span><h1 className="mt-4 text-3xl font-bold tracking-tight">{tr('Your eno dashboard', 'Bảng điều khiển eno của bạn')}</h1><p className="mt-2 max-w-lg text-sm leading-relaxed text-body">{tr('Sign in with your shared eno account to access itineraries, visa applications, forum activity, and marketplace tools in one place.', 'Đăng nhập bằng tài khoản eno dùng chung để truy cập lịch trình, hồ sơ visa, hoạt động diễn đàn và công cụ chợ mua bán tại một nơi.')}</p><Button type="button" variant="cta" className="mt-5 h-11" onClick={openSignIn}>{tr('Sign in to eno', 'Đăng nhập eno')}</Button></Card></main>

  const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || tr('eno member', 'thành viên eno')
  const dateFormatter = new Intl.DateTimeFormat(localeForLanguage(lang), { day: 'numeric', month: 'short', year: 'numeric' })

  return <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 sm:py-10 lg:px-8">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><Badge variant="brand">{tr('One eno account', 'Một tài khoản eno')}</Badge><h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{tr('Welcome', 'Chào')}, {displayName}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-body">{tr('Your Vietnam plans, applications, community, and marketplace tools—together.', 'Kế hoạch Việt Nam, hồ sơ, cộng đồng và công cụ chợ mua bán—tất cả tại một nơi.')}</p></div></div>

    <section aria-labelledby="eno-services" className="mt-7"><h2 id="eno-services" className="text-lg font-bold">{tr('eno services', 'Dịch vụ eno')}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <ServiceCard href="/" icon={MessageCircleQuestion} title={tr('Community forum', 'Diễn đàn cộng đồng')} detail={tr('Ask, answer, and share useful Vietnam experience.', 'Hỏi, trả lời và chia sẻ kinh nghiệm hữu ích tại Việt Nam.')} />
      <ServiceCard href="/itinerary" icon={Route} title={tr('Itinerary planner', 'Lập lịch trình')} detail={tr('Research a practical trip; every completed plan saves automatically.', 'Nghiên cứu chuyến đi thực tế; mọi kế hoạch hoàn tất đều tự động lưu.')} />
      <ServiceCard href="/visa" icon={FileCheck2} title={tr('Vietnam e-Visa', 'E-Visa Việt Nam')} detail={tr('Prepare, review, and track your private application.', 'Chuẩn bị, kiểm tra và theo dõi hồ sơ riêng tư.')} />
      <ServiceCard href={MARKETPLACE_URL} icon={Store} title={tr('eno marketplace', 'Chợ eno')} detail={tr('Find local products and services across Vietnam.', 'Tìm sản phẩm và dịch vụ địa phương trên khắp Việt Nam.')} external />
    </div></section>

    <div className="mt-7 grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
      <Card id="itineraries"><CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><div><CardTitle>{tr('Saved itineraries', 'Lịch trình đã lưu')}</CardTitle><p className="mt-1 text-xs text-body">{tr('Completed research appears here automatically.', 'Nghiên cứu hoàn tất sẽ tự động xuất hiện tại đây.')}</p></div><Button asChild variant="outline" size="sm"><Link href="/itinerary"><MapPinned className="h-4 w-4" />{tr('New plan', 'Kế hoạch mới')}</Link></Button></CardHeader><CardContent>
        {loading ? <div className="flex min-h-32 items-center justify-center text-sm text-body"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tr('Loading plans…', 'Đang tải kế hoạch…')}</div> : itineraries.length === 0 ? <div className="rounded-2xl bg-tint px-5 py-8 text-center"><Route className="mx-auto h-6 w-6 text-accent-foreground" /><p className="mt-3 font-bold">{tr('No saved itinerary yet', 'Chưa có lịch trình đã lưu')}</p><p className="mt-1 text-xs text-body">{tr('Research your first trip and it will appear here.', 'Nghiên cứu chuyến đi đầu tiên và lịch trình sẽ xuất hiện tại đây.')}</p></div> : <div className="space-y-3">{itineraries.map((itinerary) => {
          const expanded = expandedId === itinerary.id
          return <article key={itinerary.id} className="overflow-hidden rounded-2xl border border-line-strong bg-card"><button type="button" className="flex w-full items-start gap-3 p-4 text-left" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : itinerary.id)}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><CalendarDays className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block font-bold text-foreground">{itinerary.title}</span><span className="mt-1 block text-xs text-body">{itinerary.days} {tr('days', 'ngày')}{itinerary.estimatedBudget ? ` · ${formatVnd(itinerary.estimatedBudget)}` : ''} · {dateFormatter.format(new Date(itinerary.updatedAt))}</span></span>{expanded ? <ChevronUp className="mt-2 h-4 w-4 shrink-0 text-ink-4" /> : <ChevronDown className="mt-2 h-4 w-4 shrink-0 text-ink-4" />}</button>{expanded && <div className="border-t border-border px-4 py-4"><ol className="space-y-4">{itinerary.dayPlans.map((day) => <li key={day.id} className="border-l-2 border-brand/30 pl-3"><p className="text-xs font-bold uppercase tracking-wide text-accent-foreground">{tr('Day', 'Ngày')} {day.dayNumber} · {day.area}</p><h3 className="mt-1 font-bold text-foreground">{day.title}</h3><div className="mt-2 space-y-1 text-xs leading-relaxed text-body"><p><strong className="text-foreground">{tr('Morning', 'Sáng')}:</strong> {day.morning}</p><p><strong className="text-foreground">{tr('Afternoon', 'Chiều')}:</strong> {day.afternoon}</p><p><strong className="text-foreground">{tr('Evening', 'Tối')}:</strong> {day.evening}</p></div></li>)}</ol>{itinerary.stays.length > 0 && <div className="mt-5 rounded-xl bg-tint p-4"><p className="text-xs font-bold uppercase tracking-wide text-foreground">{tr('Stay shortlist', 'Danh sách chỗ ở')}</p><ul className="mt-2 space-y-2 text-xs text-body">{itinerary.stays.map((stay) => <li key={stay.id}><strong className="text-foreground">{stay.name}</strong> · {stay.area}{stay.estimatedNightly ? ` · ${formatVnd(stay.estimatedNightly)}/${tr('night', 'đêm')}` : ''}</li>)}</ul></div>}</div>}</article>
        })}</div>}
      </CardContent></Card>

      <div className="space-y-5">
        <Card id="visas"><CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><CardTitle>{tr('Visa applications', 'Hồ sơ visa')}</CardTitle><Button asChild variant="outline" size="sm"><Link href="/visa">{tr('Open', 'Mở')}</Link></Button></CardHeader><CardContent>{loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent-foreground" /> : visas.length ? <div className="space-y-2">{visas.slice(0, 5).map((visa) => <div key={visa.id} className="flex items-center justify-between gap-3 rounded-xl bg-tint px-3 py-3 text-sm"><span className="font-mono text-xs text-body">{visa.id.slice(0, 8)}</span><Badge variant={visa.status === 'approved' ? 'success' : visa.status === 'rejected' ? 'destructive' : 'neutral'} className="capitalize">{tr(visa.status.replaceAll('_', ' '))}</Badge></div>)}</div> : <p className="rounded-xl bg-tint px-4 py-5 text-center text-xs text-body">{tr('No visa application yet.', 'Chưa có hồ sơ visa.')}</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>{tr('Marketplace account', 'Tài khoản chợ')}</CardTitle></CardHeader><CardContent className="grid gap-2"><a href={`${MARKETPLACE_URL}/dashboard/listings`} className="flex h-11 items-center gap-2 rounded-xl bg-tint px-3 text-sm font-semibold text-foreground"><Store className="h-4 w-4 text-accent-foreground" />{tr('My listings', 'Tin của tôi')}</a><a href={`${MARKETPLACE_URL}/messages`} className="flex h-11 items-center gap-2 rounded-xl bg-tint px-3 text-sm font-semibold text-foreground"><MessageSquareText className="h-4 w-4 text-accent-foreground" />{tr('Messages', 'Tin nhắn')}</a></CardContent></Card>
      </div>
    </div>
  </main>
}
