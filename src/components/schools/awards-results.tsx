import Link from 'next/link'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Award, Users } from '@/components/ui/icons'
import type { AwardsPage } from '@/lib/schools/awards'
import { AWARD_MIN_REVIEWS, AWARD_MIN_VOTERS, KIND_LABEL, SCHOOL_KINDS, type SchoolKind } from '@/lib/schools/constants'
import { schoolLogo } from '@/lib/schools/logos'
import { formatInteger, moneyLocale } from '@/lib/vnd'
import { SchoolLogo } from './school-bits'

/**
 * The body of /schools/awards/[year]: the frozen places once a year is closed; while open, who qualifies so far —
 * by NAME, ALPHABETICALLY, with no score (src/lib/schools/awards.ts says why).
 * ⚠️ AUTHORED IN BOTH LANGUAGES, and NO SUPERLATIVE anywhere (Vietnamese advertising rules): "Teachers' Choice",
 * "recommended", never "best" / "tốt nhất" / "số 1".
 */
export function AwardsResults({ page, lang }: { page: AwardsPage; lang: string }) {
  const n = (v: number) => formatInteger(v, moneyLocale(lang))
  const y = String(page.year), next = String(page.year + 1)
  // The day it was ACTUALLY closed, in Saigon — the cron's night, or later if a moderator closed it by hand.
  const closed = page.state === 'final'
    ? new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(page.finalisedAt))
    : ''
  return (
    <>
      <h1 className="h-display mt-3 flex items-center gap-3 text-foreground">
        <Award aria-hidden className="size-8 shrink-0 text-accent-foreground" />
        <Bilingual en="Teachers' Choice {y}" vi="Giáo viên bình chọn {y}" values={{ y }} />
      </h1>
      <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
        <Bilingual
          en="The schools, English centres and recruiters in Ho Chi Minh City that teachers recommend working for, chosen only by teachers with a verified identity and reviews from teachers whose employment was checked. One category for each kind of place."
          vi="Các trường, trung tâm tiếng Anh và đơn vị tuyển dụng tại TP. Hồ Chí Minh được giáo viên đề xuất làm việc, chỉ do giáo viên đã xác minh danh tính bình chọn, cùng đánh giá của giáo viên đã được kiểm tra nơi làm việc. Mỗi loại hình có một hạng mục riêng."
        />
      </p>

      {page.state === 'final' ? (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            <Bilingual en="Closed on {closed}. {voters} verified teachers' votes and {reviews} reviews counted." vi="Đã khép lại ngày {closed}. Đã tính phiếu của {voters} giáo viên đã xác minh và {reviews} đánh giá." values={{ closed, voters: n(page.voters), reviews: n(page.reviews) }} />
          </p>
          {/* grid-cols-1, not an implicit column: an implicit track grows to the longest unwrapped (truncated) school
              name, which overflowed a 390px phone by 8px (measured on the preview). */}
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {SCHOOL_KINDS.map((kind) => <FinalCategory key={kind} kind={kind} year={y} places={page.places.filter((p) => p.category === kind)} withheld={page.withheld[kind] ?? 0} n={n} />)}
          </div>
        </>
      ) : (
        <>
          <p className="mt-4 rounded-2xl bg-tint px-4 py-3 text-sm text-foreground">
            {page.state === 'open'
              ? <Bilingual en="Voting is open until 31 December {y}, midnight in Saigon. Results in early January {next}, once the year's last reviews are read." vi="Bình chọn mở đến nửa đêm 31/12/{y} (giờ Sài Gòn). Kết quả công bố vào đầu tháng 1/{next}, sau khi các đánh giá cuối cùng của năm được đọc." values={{ y, next }} />
              : <Bilingual en="Voting closed on 31 December {y}. The results are being counted." vi="Bình chọn đã đóng ngày 31/12/{y}. Kết quả đang được tổng hợp." values={{ y }} />}
          </p>
          <section aria-labelledby="awards-take-part-h" className="mt-6 max-w-prose">
            <h2 id="awards-take-part-h" className="text-lg font-bold text-foreground"><Bilingual en="How to take part" vi="Cách tham gia" /></h2>
            <p className="mt-2 text-sm leading-relaxed text-body">
              <Bilingual
                en="Vote on the places you worked or interviewed at on the school list, and write a review of the ones you worked at. Votes count from teachers with a verified identity; one person, one vote. Each year starts fresh: votes cast in earlier years do not carry over."
                vi="Hãy bình chọn những nơi bạn từng làm việc hoặc phỏng vấn trong danh sách trường, và viết đánh giá về nơi bạn từng làm. Phiếu được tính từ giáo viên đã xác minh danh tính; mỗi người một phiếu. Mỗi năm bắt đầu lại từ đầu: phiếu của các năm trước không được chuyển sang."
              />{' '}
              <Link href="/schools" className="font-semibold text-accent-foreground hover:underline"><Bilingual en="Go to the school list" vi="Đến danh sách trường" /></Link>
            </p>
          </section>
          <h2 className="mt-8 text-lg font-bold text-foreground"><Bilingual en="Qualified so far" vi="Đã đủ điều kiện" /></h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            <Bilingual en="In alphabetical order: the order is decided only when the year closes." vi="Theo thứ tự chữ cái: thứ hạng chỉ được quyết định khi năm khép lại." />
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SCHOOL_KINDS.map((kind) => (
              <section key={kind} aria-labelledby={`q-${kind}`} className="rounded-2xl bg-card p-4 ring-1 ring-border">
                <h3 id={`q-${kind}`} className="text-sm font-semibold text-foreground"><Bilingual en={KIND_LABEL[kind].pluralEn} vi={KIND_LABEL[kind].pluralVi} /></h3>
                {page.qualified[kind].length ? (
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {page.qualified[kind].map((s) => <li key={s.slug}><Link href={`/schools/${s.slug}`} className="text-body hover:underline">{s.name}</Link></li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground"><Bilingual en="None yet." vi="Chưa có." /></p>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <section aria-labelledby="awards-how-h" className="mt-10 max-w-prose rounded-2xl bg-tint p-4 sm:p-6">
        <h2 id="awards-how-h" className="text-base font-bold text-foreground"><Bilingual en="How the winners are chosen" vi="Cách chọn ra kết quả" /></h2>
        <p className="mt-2 text-sm leading-relaxed text-body">
          <Bilingual
            en="Each place is compared only with places of its own kind. A place qualifies when more of its voters recommend it than not, with votes from at least {voters} teachers with a verified identity and at least {reviews} reviews from teachers whose employment a moderator checked and who also verified their identity, all cast during the year, Saigon time. Each teacher's last vote of the year counts. Qualified places are ranked by the lower bound of a 95% confidence interval on the share of up-votes, the same score as the list's Top rated, so a place cannot win on a handful of friendly votes; ties go to more voters. The teachers' choice and up to two finalists are recorded when the year closes and never change afterwards."
            vi="Mỗi nơi chỉ được so với các nơi cùng loại hình. Một nơi đủ điều kiện khi số người đề xuất nhiều hơn số người không đề xuất, có phiếu của ít nhất {voters} giáo viên đã xác minh danh tính và ít nhất {reviews} đánh giá của giáo viên đã được kiểm duyệt viên kiểm tra nơi làm việc và cũng đã xác minh danh tính, tất cả trong năm, theo giờ Sài Gòn. Phiếu cuối cùng trong năm của mỗi giáo viên được tính. Các nơi đủ điều kiện được xếp theo cận dưới của khoảng tin cậy 95% cho tỷ lệ phiếu lên, cùng cách tính với mục Được đánh giá cao của danh sách, nên không nơi nào thắng nhờ vài phiếu quen biết; nếu bằng điểm, nơi có nhiều người bình chọn hơn xếp trên. Lựa chọn của giáo viên và tối đa hai nơi vào chung kết được ghi lại khi năm khép lại và không thay đổi sau đó."
            values={{ voters: String(AWARD_MIN_VOTERS), reviews: String(AWARD_MIN_REVIEWS) }}
          />
        </p>
      </section>
    </>
  )
}

function FinalCategory({ kind, year, places, withheld, n }: { kind: SchoolKind; year: string; places: Extract<AwardsPage, { state: 'final' }>['places']; withheld: number; n: (v: number) => string }) {
  return (
    <section aria-labelledby={`cat-${kind}`} className="rounded-2xl bg-card p-4 ring-1 ring-border sm:p-6">
      <h2 id={`cat-${kind}`} className="text-base font-bold text-foreground"><Bilingual en={KIND_LABEL[kind].pluralEn} vi={KIND_LABEL[kind].pluralVi} /></h2>
      {places.length === 0 && withheld === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground"><Bilingual en="No place met the threshold in {year}." vi="Không nơi nào đạt ngưỡng trong năm {year}." values={{ year }} /></p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {places.map((p) => {
            const name = <Link href={`/schools/${p.school.slug}`} className="font-semibold text-foreground hover:underline">{p.school.name}</Link>
            return (
              <li key={p.rank} className="flex items-center gap-3">
                <SchoolLogo slug={p.school.slug} logo={schoolLogo(p.school.slug)} name={p.school.name} kind={kind} size={p.rank === 1 ? 'md' : 'sm'} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-accent-foreground">
                    {p.rank === 1
                      ? <Bilingual en="Teachers' Choice {year}" vi="Giáo viên bình chọn {year}" values={{ year }} />
                      : <Bilingual en="Finalist" vi="Vào chung kết" />}
                  </p>
                  <p className="truncate text-sm">{name}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users aria-hidden className="size-3.5" />
                    <Bilingual en="{up} of {voters} verified teachers recommend · {reviews} reviews" vi="{up}/{voters} giáo viên đã xác minh đề xuất · {reviews} đánh giá" values={{ up: n(p.up), voters: n(p.up + p.down), reviews: n(p.reviews) }} />
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {withheld > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {withheld === 1
            ? <Bilingual en="One place in this category is no longer listed." vi="Một nơi trong hạng mục này không còn được liệt kê." />
            : <Bilingual en="{n} places in this category are no longer listed." vi="{n} nơi trong hạng mục này không còn được liệt kê." values={{ n: String(withheld) }} />}
        </p>
      )}
    </section>
  )
}
