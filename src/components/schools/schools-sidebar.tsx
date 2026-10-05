import type { ReactNode } from 'react'
import Link from 'next/link'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Button } from '@/components/ui/button'
import { Briefcase, GraduationCap, Plus } from '@/components/ui/icons'
import { formatInteger, moneyLocale } from '@/lib/vnd'
import type { SchoolListRow } from '@/lib/schools/queries'
import { SchoolLogo } from './school-bits'

/**
 * The /schools sidebar (owner, 2026-10-05: the page spans the header's width on desktop). Everything here is
 * computed from the same rows the board renders, at the same ISR moment, so the numbers never disagree with
 * the list beside them. Below `lg` it follows the list.
 */
export function SchoolsSidebar({ rows, lang }: { rows: SchoolListRow[]; lang: string }) {
  const loc = moneyLocale(lang)
  const n = (v: number) => formatInteger(v, loc)
  const reviews = rows.reduce((t, r) => t + r.reviews, 0)
  const jobs = rows.reduce((t, r) => t + r.jobs, 0)
  const withPay = rows.filter((r) => r.pay.length > 0).length
  const hiring = rows.filter((r) => r.jobs > 0).sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name)).slice(0, 6)
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="schools-glance-h" className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <h2 id="schools-glance-h" className="text-sm font-semibold text-muted-foreground"><Bilingual en="At a glance" vi="Tổng quan" /></h2>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Stat value={n(rows.length)} label={<Bilingual en="schools and centres" vi="trường và trung tâm" />} />
          <Stat value={n(reviews)} label={<Bilingual en="teacher reviews" vi="đánh giá của giáo viên" />} />
          <Stat value={n(jobs)} label={<Bilingual en="open jobs" vi="việc đang tuyển" />} />
          <Stat value={n(withPay)} label={<Bilingual en="with a pay range" vi="có khoảng lương" />} />
        </dl>
      </section>

      {hiring.length > 0 && (
        <section aria-labelledby="schools-hiring-h" className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <h2 id="schools-hiring-h" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Briefcase aria-hidden className="size-4" /> <Bilingual en="Hiring now" vi="Đang tuyển" />
          </h2>
          <ul className="mt-3 flex flex-col gap-1">
            {hiring.map((r) => (
              <li key={r.id}>
                <Link href={`/schools/${r.slug}#jobs`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-tint">
                  <SchoolLogo slug={r.slug} logo={r.logo} name={r.name} kind={r.kind} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.jobs === 1 ? <Bilingual en="1 open job" vi="1 việc đang tuyển" /> : <Bilingual en="{n} open jobs" vi="{n} việc đang tuyển" values={{ n: n(r.jobs) }} />}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/c/jobs" className="mt-3 inline-block text-sm font-semibold text-accent-foreground hover:underline"><Bilingual en="Browse all jobs" vi="Xem mọi việc làm" /></Link>
        </section>
      )}

      <section aria-labelledby="schools-teach-h" className="rounded-2xl bg-tint p-4">
        <h2 id="schools-teach-h" className="flex items-center gap-2 text-base font-bold text-foreground">
          <GraduationCap aria-hidden className="size-5 text-accent-foreground" /> <Bilingual en="Taught at one of these?" vi="Bạn từng dạy ở một trong những nơi này?" />
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-body">
          <Bilingual
            en="Vote it up or down and write what is good and bad. Your name is never shown, and a moderator reads every review before it appears."
            vi="Hãy bình chọn lên hoặc xuống và viết điểm tốt, điểm chưa tốt. Tên của bạn không bao giờ hiển thị, và mọi đánh giá đều được kiểm duyệt trước khi hiển thị."
          />
        </p>
        <p className="mt-4 text-sm leading-relaxed text-body">
          <Bilingual
            en="Looking for a teaching job? Create a free teacher profile: schools message you, and your contact stays private until you share it."
            vi="Đang tìm việc dạy học? Tạo hồ sơ giáo viên miễn phí: trường sẽ nhắn cho bạn, và thông tin liên hệ của bạn được giữ kín cho đến khi bạn chia sẻ."
          />
        </p>
        <Button variant="outline" className="mt-3 w-full" asChild>
          <Link href="/teachers/join"><Bilingual en="Create a teacher profile" vi="Tạo hồ sơ giáo viên" /></Link>
        </Button>
      </section>

      <section aria-labelledby="schools-suggest-h" className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <h2 id="schools-suggest-h" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Plus aria-hidden className="size-4" /> <Bilingual en="Missing a school?" vi="Thiếu trường?" />
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-body">
          <Bilingual
            en="Tell us about a school, centre or recruiter in Ho Chi Minh City that is not listed, and a moderator adds it."
            vi="Hãy cho chúng tôi biết một trường, trung tâm hay đơn vị tuyển dụng tại TP. Hồ Chí Minh chưa có trong danh sách, kiểm duyệt viên sẽ thêm vào."
          />
        </p>
        <Button variant="outline" className="mt-3 w-full" asChild>
          <Link href="/schools/suggest"><Bilingual en="Suggest a school" vi="Đề xuất trường" /></Link>
        </Button>
      </section>
    </div>
  )
}

/** The figure reads first on screen; the term stays first in the DOM, as a <dl> requires (term, then value). */
function Stat({ value, label }: { value: string; label: ReactNode }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
