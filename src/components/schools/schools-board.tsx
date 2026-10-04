'use client'

import * as React from 'react'
import Link from 'next/link'
import { Briefcase, MessageSquareText, Search } from '@/components/ui/icons'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { useLanguage } from '@/context/language-context'
import { fold } from '@/lib/fold'
import { formatInteger, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { KIND_LABEL, SCHOOL_KINDS, isSchoolKind, type SchoolKind } from '@/lib/schools/constants'
import { compareSchools, isSchoolSort, normEmployer, positivePct, type SchoolSort } from '@/lib/schools/logic'
import type { SchoolListRow } from '@/lib/schools/queries'
import { SchoolLiveProvider, useSchoolLive } from './school-live'
import { VoteControl } from './vote-control'
import { KindLabel, PayRange, PCT_MIN_VOTES, SchoolLogo } from './school-bits'

type BoardRow = SchoolListRow

const ALL = 'all'

/**
 * The ranking board on /schools. The page hands over EVERY active school (server-rendered, so each is a
 * crawlable link); search, kind, area and sort run here, in the browser, and are mirrored into the URL
 * with replaceState so a filtered view can be shared. ⚠️ The filters are read from `location` AFTER
 * hydration, not with useSearchParams — that hook would put the whole list behind a Suspense boundary,
 * which hides it from crawlers (crawler-visible-html-contract.test.ts).
 * ⚠️ Rows are ORDERED by the counts the page was rendered with, and only re-ordered when a filter or the
 * sort changes: re-sorting on every live vote would move the row out from under the visitor's finger.
 */
export function SchoolsBoard({ rows, areas }: { rows: BoardRow[]; areas: string[] }) {
  const initial = React.useMemo(() => Object.fromEntries(rows.map((r) => [r.id, { up: r.up, down: r.down }])), [rows])
  return (
    <SchoolLiveProvider schoolIds={rows.map((r) => r.id)} initial={initial}>
      <Board rows={rows} areas={areas} />
    </SchoolLiveProvider>
  )
}

function Board({ rows, areas }: { rows: BoardRow[]; areas: string[] }) {
  const { tr, lang } = useLanguage()
  const [q, setQ] = React.useState('')
  const [kind, setKind] = React.useState<SchoolKind | typeof ALL>(ALL)
  const [area, setArea] = React.useState<string>(ALL)
  const [sort, setSort] = React.useState<SchoolSort>('top')

  // Read a shared/filtered URL once, after hydration (see the component note).
  React.useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const k = sp.get('kind'), a = sp.get('area'), s = sp.get('sort'), text = sp.get('q')
    if (isSchoolKind(k)) setKind(k)
    if (a && areas.includes(a)) setArea(a)
    // 'net' has no tab: a shared ?sort=net shows as Top rated, so it IS Top rated (Wilson), never a label lie.
    if (isSchoolSort(s) && s !== 'net') setSort(s)
    if (text) setQ(text.slice(0, 80))
  }, [areas])

  // Mirror the filters into the URL without a navigation (no re-render of the server page). Only OUR keys
  // are written: utm_*/fbclid and anything else on a shared link stay for analytics (diff review). And
  // `.toString()`, not `.size`, which older iOS Safari does not have.
  React.useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const put = (k: string, v: string | null) => { if (v) sp.set(k, v); else sp.delete(k) }
    put('kind', kind !== ALL ? kind : null)
    put('area', area !== ALL ? area : null)
    put('sort', sort !== 'top' ? sort : null)
    put('q', q.trim() || null)
    const qs = sp.toString()
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', next)
  }, [kind, area, sort, q])

  // Ranked on the LIVE counts as of the moment a sort or filter is chosen (diff review), but not re-ranked
  // on every vote — a row must not jump from under the visitor's finger. The ref carries the latest counts
  // into the memo without making a vote one of its dependencies.
  const live = useSchoolLive()
  const countsRef = React.useRef(live.counts)
  countsRef.current = live.counts
  const shown = React.useMemo(() => {
    const needle = fold(q).trim()
    const alias = normEmployer(q)
    const c = countsRef.current
    return rows
      .map((r) => ({ ...r, up: c[r.id]?.up ?? r.up, down: c[r.id]?.down ?? r.down }))
      .filter((r) => kind === ALL || r.kind === kind)
      .filter((r) => area === ALL || r.districts.includes(area))
      .filter((r) => !needle || fold(r.name).includes(needle) || (alias.length > 1 && r.aliases.some((a) => a.includes(alias))))
      .sort(compareSchools(sort))
  }, [rows, q, kind, area, sort])

  const kindCounts = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.kind, (m.get(r.kind) ?? 0) + 1)
    return m
  }, [rows])

  const ranked = sort === 'top' || sort === 'net'
  return (
    <section aria-labelledby="schools-board-h" className="mt-8">
      <h2 id="schools-board-h" className="sr-only">{tr('Ranking', 'Bảng xếp hạng')}</h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">{tr('Search schools and centres', 'Tìm trường và trung tâm')}</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value.slice(0, 80))}
            placeholder={tr('Search by name, e.g. ILA, VUS, BIS', 'Tìm theo tên, ví dụ ILA, VUS, BIS')}
            className="min-h-11 w-full rounded-xl pl-9"
            enterKeyHint="search"
          />
        </label>
        <Select items={Object.fromEntries([[ALL, tr('All areas', 'Mọi khu vực')], ...areas.map((a) => [a, a])])} value={area} onValueChange={(v) => setArea(typeof v === 'string' ? v : ALL)}>
          <SelectTrigger aria-label={tr('Area', 'Khu vực')} className="min-h-11 w-full rounded-xl bg-card sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr('All areas', 'Mọi khu vực')}</SelectItem>
            {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={tr('Type', 'Loại')}>
        <Chip size="md" pressed={kind === ALL} onPressedChange={() => setKind(ALL)}>
          {tr('All', 'Tất cả')} <span className="tabular-nums opacity-70">{formatInteger(rows.length, moneyLocale(lang))}</span>
        </Chip>
        {SCHOOL_KINDS.filter((k) => kindCounts.get(k)).map((k) => (
          <Chip key={k} size="md" pressed={kind === k} onPressedChange={(p) => setKind(p ? k : ALL)}>
            {tr(KIND_LABEL[k].pluralEn, KIND_LABEL[k].pluralVi)} <span className="tabular-nums opacity-70">{formatInteger(kindCounts.get(k) ?? 0, moneyLocale(lang))}</span>
          </Chip>
        ))}
      </div>

      <Segmented
        className="mt-3 sm:max-w-lg"
        aria-label={tr('Sort', 'Sắp xếp')}
        value={sort === 'net' ? 'top' : sort}
        onValueChange={(v) => setSort(v)}
        // Short labels below `sm`: four segments at 390px leave ~85px each, and "Most reviewed" truncated.
        options={[
          { value: 'top', label: <><span className="sm:hidden">{tr('Top', 'Hàng đầu')}</span><span className="hidden sm:inline">{tr('Top rated', 'Được đánh giá cao')}</span></> },
          { value: 'reviews', label: <><span className="sm:hidden">{tr('Reviews', 'Đánh giá')}</span><span className="hidden sm:inline">{tr('Most reviewed', 'Nhiều đánh giá')}</span></> },
          { value: 'hiring', label: <><span className="sm:hidden">{tr('Hiring', 'Tuyển')}</span><span className="hidden sm:inline">{tr('Hiring now', 'Đang tuyển')}</span></> },
          { value: 'name', label: 'A–Z' },
        ]}
      />

      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {tr('{n} schools and centres', '{n} trường và trung tâm').replace('{n}', formatInteger(shown.length, moneyLocale(lang)))}
      </p>

      {shown.length ? (
        <ol className="mt-2 flex flex-col gap-2">
          {shown.map((r, i) => <BoardRowItem key={r.id} row={r} rank={ranked ? i + 1 : null} />)}
        </ol>
      ) : (
        <EmptyState
          className="mt-6"
          tone="dashed"
          icon={Search}
          title={tr('No school matches', 'Không có trường phù hợp')}
          subtitle={tr('Try another name or clear a filter. Missing a school? Tell us and we will add it.', 'Thử tên khác hoặc bỏ bớt bộ lọc. Thiếu trường? Hãy báo để chúng tôi bổ sung.')}
          action={<Link href="/contact" className="font-semibold text-accent-foreground hover:underline">{tr('Suggest a school', 'Đề xuất trường')}</Link>}
        />
      )}
    </section>
  )
}

function BoardRowItem({ row, rank }: { row: BoardRow; rank: number | null }) {
  const { tr, lang } = useLanguage()
  const live = useSchoolLive()
  const c = live.counts[row.id] ?? { up: row.up, down: row.down }
  const votes = c.up + c.down
  const pct = votes >= PCT_MIN_VOTES ? positivePct(c.up, c.down) : null
  const loc = moneyLocale(lang)
  const pay = row.pay.find((p) => p.period === 'hour') ?? row.pay[0]
  return (
    <li className="flex items-start gap-2 rounded-2xl bg-card p-2 ring-1 ring-border sm:gap-3 sm:p-3">
      <div className="flex w-10 shrink-0 flex-col items-center sm:w-12">
        <VoteControl schoolId={row.id} schoolName={row.name} />
      </div>
      <div className="flex min-w-0 flex-1 items-start gap-3 py-1">
        <SchoolLogo slug={row.slug} logo={row.logo} name={row.name} kind={row.kind} />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            {rank !== null && <span className="text-xs font-semibold tabular-nums text-muted-foreground">#{rank}</span>}
            <Link href={`/schools/${row.slug}`} className="line-clamp-2 text-base font-semibold text-foreground hover:underline">
              {row.name}
            </Link>
          </p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            <KindLabel kind={row.kind} />
            {row.districts.length > 0 && <> · {row.districts.slice(0, 2).join(', ')}{row.districts.length > 2 ? ` +${row.districts.length - 2}` : ''}</>}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className={cn('font-semibold', pct === null ? 'text-muted-foreground' : pct >= 60 ? 'text-success' : pct >= 40 ? 'text-foreground' : 'text-destructive')}>
              {pct !== null ? tr('{n}% recommend', '{n}% đề xuất').replace('{n}', String(pct))
                : votes === 0 ? tr('No votes yet', 'Chưa có bình chọn')
                : votes === 1 ? tr('1 vote so far', 'Mới có 1 phiếu') : tr('{n} votes so far', 'Mới có {n} phiếu').replace('{n}', String(votes))}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MessageSquareText aria-hidden className="size-4" />
              {row.reviews === 1 ? tr('1 review', '1 đánh giá') : tr('{n} reviews', '{n} đánh giá').replace('{n}', formatInteger(row.reviews, loc))}
            </span>
            {row.jobs > 0 && (
              <Link href={`/schools/${row.slug}#jobs`} className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
                <Briefcase aria-hidden className="size-4" />
                {row.jobs === 1 ? tr('1 open job', '1 việc đang tuyển') : tr('{n} open jobs', '{n} việc đang tuyển').replace('{n}', formatInteger(row.jobs, loc))}
              </Link>
            )}
            {pay && <PayRange s={pay} className="text-foreground" />}
          </p>
        </div>
      </div>
    </li>
  )
}
