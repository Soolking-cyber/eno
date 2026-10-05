import { Bilingual } from '@/components/marketplace/bilingual'
import { SITE_NAME } from '@/lib/edition'

/**
 * "How the ranking works" — the rules the code applies, in words a teacher can check.
 * ⚠️ AUTHORED IN BOTH LANGUAGES (<Bilingual>), not machine-translated: this is the statement of what
 * a vote, a review and a pay figure mean, and a mistranslation of it is a trust defect.
 * ⚠️ THE NUMBERS ARE WRITTEN OUT (7 days, 5 teachers, 3 years) so the copy is one stable template;
 * schools-methodology.test.ts fails if they drift from src/lib/schools/constants.ts.
 */
const ITEMS: { h: { en: string; vi: string }; p: { en: string; vi: string } }[] = [
  {
    h: { en: 'Votes', vi: 'Bình chọn' },
    p: {
      en: 'Teachers who worked or interviewed at a school vote it up or down. "Top rated" uses the lower bound of a 95% confidence interval on the share of up-votes, the method behind Reddit\'s "best" sort, so a school with 40 up-votes and 5 down-votes ranks above one with a single up-vote. A "% recommend" figure appears once a school has 5 votes.',
      vi: 'Giáo viên từng làm việc hoặc phỏng vấn tại trường bình chọn lên hoặc xuống. Mục "Được đánh giá cao" dùng cận dưới của khoảng tin cậy 95% cho tỷ lệ phiếu lên, cách Reddit dùng cho mục "best", nên trường có 40 phiếu lên và 5 phiếu xuống sẽ xếp trên trường chỉ có một phiếu lên. Tỷ lệ "% đề xuất" chỉ hiển thị khi trường có từ 5 phiếu.',
    },
  },
  {
    h: { en: 'Whose votes count', vi: 'Phiếu nào được tính' },
    p: {
      en: 'Anyone signed in to {site} with Google or email can vote: one vote per account, on each school. Votes count from individual accounts in good standing. Business accounts cannot vote, and a school\'s own account cannot vote on or review that school. Who voted is never shown.',
      vi: 'Bất kỳ ai đăng nhập {site} bằng Google hoặc email đều có thể bình chọn: mỗi tài khoản một phiếu cho mỗi trường. Phiếu được tính từ tài khoản cá nhân có uy tín tốt. Tài khoản doanh nghiệp không thể bình chọn, và tài khoản của chính trường không thể bình chọn hay đánh giá trường đó. Không ai thấy ai đã bình chọn.',
    },
  },
  {
    h: { en: 'Reviews', vi: 'Đánh giá' },
    p: {
      en: 'Anyone signed in can review a school they worked at, one review per school. Your name is never shown: each review shows only a broad description of the writer, such as "Former teacher · 1–2 years". A moderator reads every review before it appears. A review describes the writer\'s own experience; it may not name individuals, share personal details or include links.',
      vi: 'Bất kỳ ai đã đăng nhập đều có thể đánh giá nơi mình từng làm, mỗi trường một đánh giá. Tên của bạn không bao giờ hiển thị: mỗi đánh giá chỉ kèm mô tả chung về người viết, ví dụ "Giáo viên cũ · 1–2 năm". Mọi đánh giá đều được kiểm duyệt viên đọc trước khi hiển thị. Đánh giá kể trải nghiệm của chính người viết; không được nêu tên cá nhân, tiết lộ thông tin cá nhân hay chèn đường link.',
    },
  },
  {
    h: { en: 'Pay', vi: 'Lương' },
    p: {
      en: 'Pay comes from teachers\' reviews and is never shown next to a review or a name. A school shows a pay range only once at least 5 teachers have reported pay for the same period, per hour or per month, within the last 3 years, and the range updates once a week. It covers the middle 60% of what they reported, widened to the nearest 50,000 đ an hour or 1,000,000 đ a month; with only a few reports, an end of the range can be close to one teacher\'s pay. Pay in a job ad is shown exactly as the employer wrote it.',
      vi: 'Mức lương lấy từ đánh giá của giáo viên và không bao giờ hiển thị cạnh một đánh giá hay một cái tên. Trường chỉ hiển thị khoảng lương khi có ít nhất 5 giáo viên báo lương cho cùng một kỳ, theo giờ hoặc theo tháng, trong 3 năm gần nhất, và khoảng lương được cập nhật mỗi tuần một lần. Khoảng lương bao trùm 60% ở giữa các mức được báo, làm tròn ra ngoài theo bước 50.000 đ mỗi giờ hoặc 1.000.000 đ mỗi tháng; khi chỉ có ít báo cáo, một đầu của khoảng lương có thể gần với lương của một giáo viên. Lương trong tin tuyển dụng được giữ nguyên như nhà tuyển dụng ghi.',
    },
  },
  {
    h: { en: "Teachers' Choice", vi: 'Giáo viên bình chọn' },
    p: {
      en: "Each year, Teachers' Choice records the places teachers recommend, one category for each kind of place. A place qualifies when more of its voters recommend it than not, with votes from at least 10 teachers and at least 3 reviews, all during the year in Saigon time, and is ranked by the same score as Top rated. While the year is open, only the names of places that qualify are shown; the results are recorded when the year closes and never change.",
      vi: 'Mỗi năm, mục Giáo viên bình chọn ghi nhận những nơi được giáo viên đề xuất, mỗi loại hình một hạng mục. Một nơi đủ điều kiện khi số người đề xuất nhiều hơn số người không đề xuất, có phiếu của ít nhất 10 giáo viên và ít nhất 3 đánh giá, tất cả trong năm theo giờ Sài Gòn, và được xếp theo cùng cách tính với mục Được đánh giá cao. Khi năm còn mở, chỉ tên các nơi đủ điều kiện được hiển thị; kết quả được ghi lại khi năm khép lại và không thay đổi.',
    },
  },
  {
    h: { en: 'Open jobs', vi: 'Việc đang tuyển' },
    p: {
      en: 'Open jobs are live job listings in Ho Chi Minh City on {site} whose employer name matches the school, plus any job the school posts from its own account. Each one shows the name it was posted under.',
      vi: 'Việc đang tuyển là các tin tuyển dụng tại TP. Hồ Chí Minh đang hiển thị trên {site} có tên nhà tuyển dụng trùng với trường, cùng mọi tin trường tự đăng từ tài khoản của mình. Mỗi tin đều ghi tên được dùng khi đăng.',
    },
  },
  {
    h: { en: 'Schools can reply', vi: 'Trường có thể phản hồi' },
    p: {
      en: 'A school can reply to a review or ask for a correction from its page ("Is this your school?"). Reports never remove a review automatically; a moderator decides. Reviews are the opinions of individual teachers, not of {site}. Each logo belongs to its school and is shown only to identify it; {site} is not affiliated with the schools listed.',
      vi: 'Trường có thể phản hồi một đánh giá hoặc yêu cầu đính chính ngay trên trang của mình ("Đây là trường của bạn?"). Báo cáo không bao giờ tự động gỡ đánh giá; kiểm duyệt viên sẽ quyết định. Đánh giá là ý kiến của từng giáo viên, không phải của {site}. Mỗi logo thuộc về trường tương ứng và chỉ dùng để nhận diện trường; {site} không liên kết với các trường trong danh sách.',
    },
  },
]

export function SchoolsMethodology() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-h" className="mt-12 scroll-mt-24 rounded-2xl bg-tint p-4 sm:p-6">
      <h2 id="how-it-works-h" className="text-lg font-bold text-foreground sm:text-xl">
        <Bilingual en="How the ranking works" vi="Cách xếp hạng hoạt động" />
      </h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        {ITEMS.map((it) => (
          <div key={it.h.en}>
            <dt className="text-sm font-semibold text-foreground"><Bilingual en={it.h.en} vi={it.h.vi} /></dt>
            <dd className="mt-1 text-sm leading-relaxed text-body"><Bilingual en={it.p.en} vi={it.p.vi} values={{ site: SITE_NAME }} /></dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export const METHODOLOGY_ITEMS = ITEMS
