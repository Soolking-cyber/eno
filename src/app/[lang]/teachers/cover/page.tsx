import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { pageShare } from '@/lib/site-identity'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Bilingual } from '@/components/marketplace/bilingual'
import { Button } from '@/components/ui/button'
import { LocalizedLink } from '@/components/marketplace/localized-link'
import { CalendarDays, Check, GraduationCap, MapPin, MessageSquare } from '@/components/ui/icons'

// COVER LESSONS — the two-sided landing to promote (owner, 2026-10-07: "we will promote it for both sides to
// teachers and schools to match for urgent covers"). Static: no listing data, nothing to revalidate. The school
// door is the explorer with the cover filter on; the teacher door is the profile form.
// ⚠️ Links stay RELATIVE (/teachers/join, never teacher.eno.vn): inside the apps only eno.vn may load, and a
// teacher.eno.vn link would leave the app (capacitor.config.ts allowNavigation).
// ⚠️ NO PROMISE OF INSTANT ALERTS: the apps' push is dormant (v1) and web push reaches only teachers who turned it
// on — the copy says "message", never "get notified instantly".
export const revalidate = 86400

// One bilingual title, the /schools convention: the page is ISR-shared by both server languages.
const PATH = '/teachers/cover'
const TITLE = `Cover teachers in Vietnam · Giáo viên dạy thay | ${SITE_NAME}`
const DESCRIPTION = 'Teachers show the periods they are usually free, the districts they can reach and their hourly rate. Schools filter by district and free period, then message them in the app. Giáo viên dạy thay theo quận và buổi rảnh.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  ...pageShare({ title: TITLE, description: DESCRIPTION, url: PATH }),
}

// ⚠️ `/` is the English-pinned home (lang-pinned.ts): this link goes through LocalizedLink so a Vietnamese reader
// lands on the `/vi` twin with the same filters (lang-links.ratchet.test.ts cannot see a constant — do not inline it raw).
const SCHOOLS_URL = '/?category=teachers&attr_cover=open'

// ⚠️ The icon is passed as a COMPONENT, not an element: scripts/gen-ui-strings.mjs harvests a tag's `en`/`vi` props
// only when the tag holds no nested `<…>`, so `icon={<MapPin />}` kept these lines from the nine machine-translated
// languages (gate review, 2026-10-07).
function Point({ Icon, en, vi }: { Icon: React.ComponentType<{ className?: string }>; en: string; vi: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-body">
      <span className="mt-0.5 shrink-0 text-brand"><Icon className="size-4" /></span>
      <span><Bilingual en={en} vi={vi} /></span>
    </li>
  )
}

export default function TeacherCoverPage() {
  return (
    <div className="flex min-h-page flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-8 pb-12">
        <h1 className="h-display text-foreground">
          <Bilingual en="Find a cover teacher — or offer cover lessons" vi="Tìm giáo viên dạy thay — hoặc nhận dạy thay" />
        </h1>
        <p className="mt-2 max-w-prose text-body">
          <Bilingual
            en="Teachers show the periods they are usually free, the districts they can reach and their hourly rate. Schools filter by district and free period, then message them in the eno app or on the website."
            vi="Giáo viên cho biết các buổi thường rảnh, các quận có thể đến và mức phí theo giờ. Các trường lọc theo quận và buổi rảnh, rồi nhắn tin cho giáo viên trong ứng dụng eno hoặc trên website."
          />
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section aria-labelledby="cover-schools" className="space-y-4 rounded-2xl bg-tint p-5">
            <h2 id="cover-schools" className="text-lg font-semibold text-foreground">
              <Bilingual en="For schools: a teacher for this week's lesson" vi="Cho các trường: giáo viên cho buổi học tuần này" />
            </h2>
            <ul className="space-y-2.5">
              <Point Icon={MapPin} en="Filter by district and by free period — Monday morning, Thursday evening…" vi="Lọc theo quận và theo buổi rảnh — sáng Thứ 2, tối Thứ 5…" />
              <Point Icon={GraduationCap} en="See each teacher's hourly rate, experience and qualifications — and their intro video, shown on the profile or sent on request." vi="Xem mức phí theo giờ, kinh nghiệm và bằng cấp của từng giáo viên — cùng video giới thiệu, hiển thị trên hồ sơ hoặc gửi khi được đề nghị." />
              <Point Icon={MessageSquare} en="Message them in the app. A teacher's phone, email and CV are shared only if they choose to." vi="Nhắn tin trong ứng dụng. Số điện thoại, email và CV của giáo viên chỉ được chia sẻ nếu họ đồng ý." />
            </ul>
            <Button variant="cta" asChild><LocalizedLink href={SCHOOLS_URL} rel="nofollow" prefetch={false}><Bilingual en="Find a cover teacher" vi="Tìm giáo viên dạy thay" /></LocalizedLink></Button>
            <p className="text-xs text-muted-foreground"><Bilingual en="Messaging teachers needs a school or company account." vi="Cần tài khoản trường học hoặc công ty để nhắn tin cho giáo viên." /></p>
          </section>

          <section aria-labelledby="cover-teachers" className="space-y-4 rounded-2xl bg-tint p-5">
            <h2 id="cover-teachers" className="text-lg font-semibold text-foreground">
              <Bilingual en="For teachers: fill your free periods" vi="Cho giáo viên: tận dụng giờ rảnh" />
            </h2>
            <ul className="space-y-2.5">
              <Point Icon={CalendarDays} en="Tap the periods you are usually free — it takes a minute." vi="Chạm vào các buổi bạn thường rảnh — chỉ mất một phút." />
              <Point Icon={MapPin} en="Choose the districts you can reach and set your hourly rate." vi="Chọn các quận bạn có thể đến và đặt mức phí theo giờ." />
              <Point Icon={Check} en="Schools message you; you decide what to share and which lessons to take. Switch it off any time." vi="Các trường nhắn tin cho bạn; bạn quyết định chia sẻ gì và nhận buổi nào. Có thể tắt bất cứ lúc nào." />
            </ul>
            <Button variant="secondary" asChild><Link href="/teachers/join"><Bilingual en="Offer cover lessons — free" vi="Nhận dạy thay — miễn phí" /></Link></Button>
          </section>
        </div>

        <p className="mt-8 max-w-prose text-xs text-muted-foreground">
          <Bilingual
            en="eno does not employ teachers and takes no fee for cover lessons: the school and the teacher agree the lesson, the place and the payment between themselves."
            vi="eno không tuyển dụng giáo viên và không thu phí cho các buổi dạy thay: trường và giáo viên tự thống nhất buổi học, địa điểm và thanh toán với nhau."
          />
        </p>
      </main>
      <Footer />
    </div>
  )
}
