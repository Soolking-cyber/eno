import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * eSIM VIETTEL, VINAPHONE, MOBIFONE — the Vietnamese half.
 *
 * ⛔ NO TARIFFS OR PACKAGE NAMES, same rule as the English page: operator pricing moves constantly
 * and a stale figure here is a claim a reader acts on at a counter.
 *
 * ⚠️ THE QUESTION IS DIFFERENT FROM ITS PAIR. The English page is about a foreigner getting a local
 * number at all; a Vietnamese reader already has one and is asking how to CONVERT a physical SIM to
 * eSIM, whether the number survives, and what happens when they change phones — which is where this
 * spends its length.
 */
const SLUG = 'esim-viettel-vinaphone-mobifone'

const CONTENT: ArticleContent = {
  eyebrow: 'Hướng dẫn',
  h1: 'eSIM Viettel, VinaPhone, MobiFone: chuyển đổi và lắp thế nào',
  intro:
    'Cả bốn nhà mạng trong nước đều đã hỗ trợ eSIM, và việc chuyển từ SIM vật lý sang eSIM giữ nguyên số cũ. Bài này nói về thủ tục chuyển đổi, máy nào dùng được, chuyện gì xảy ra khi bạn đổi điện thoại, và vài điểm cần biết trước khi tháo SIM cũ ra.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/esim-vietnam-guide' },
  sections: [
    {
      id: 'may-nao-dung-duoc',
      title: 'Máy nào dùng được eSIM',
      body: (
        <>
          <P>
            iPhone từ XS trở lên, các dòng Samsung Galaxy S và Z đời gần đây, Google Pixel, và ngày
            càng nhiều flagship của các hãng Trung Quốc. Kiểm tra nhanh trên iPhone: <strong>Cài đặt ›
            Di động</strong>, nếu có mục thêm eSIM là máy hỗ trợ.
          </P>
          <P>
            ⚠️ Hai trường hợp hay gặp vấn đề: <strong>bản nội địa Trung Quốc</strong> của một số dòng
            máy không có phần cứng eSIM, và <strong>máy lock</strong> khóa mạng nước ngoài thường
            không kích hoạt được profile của nhà mạng Việt Nam. Nếu đang mua máy cũ, đây là thứ nên
            thử ngay tại chỗ &mdash; xem thêm{' '}
            <HereLink href="/kinh-nghiem-mua-iphone-cu">bài kiểm tra iPhone cũ</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'chuyen-doi',
      title: 'Chuyển SIM vật lý sang eSIM: số cũ có giữ được không',
      body: (
        <>
          <P>
            Có. Đây là chuyển đổi hình thức SIM, không phải đổi số &mdash; số điện thoại, gói cước và
            thuê bao giữ nguyên. Thủ tục làm tại cửa hàng giao dịch của nhà mạng, và một số nhà mạng
            cho làm ngay trên ứng dụng nếu thuê bao đã chuẩn hóa thông tin.
          </P>
          <Ul>
            <li>Mang theo <strong>CCCD</strong> và chính chiếc điện thoại sẽ dùng eSIM.</li>
            <li>Thông tin thuê bao phải trùng khớp với giấy tờ; thuê bao đứng tên người khác thì chủ thuê bao phải đi cùng hoặc ủy quyền.</li>
            <li>Profile được cài bằng mã QR ngay tại quầy. ⚠️ Giữ lại mã QR &mdash; một số profile chỉ cài được một lần.</li>
            <li>⚠️ Đừng vứt SIM vật lý cũ ngay. Giữ vài ngày cho chắc, phòng trường hợp phải quay lại.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'doi-may',
      title: 'Đổi điện thoại thì eSIM đi theo kiểu gì',
      body: (
        <>
          <P>
            Đây là khác biệt lớn nhất so với SIM vật lý, và cũng là điều nhiều người chỉ phát hiện khi
            đã xóa máy cũ. SIM vật lý thì rút ra lắp sang máy mới là xong; eSIM thì profile gắn với
            thiết bị, nên phải chuyển hoặc cấp lại.
          </P>
          <P>
            Một số nhà mạng cho chuyển ngay trong ứng dụng hoặc bằng tính năng chuyển eSIM giữa hai
            iPhone; một số bắt ra cửa hàng cấp lại profile. ⚠️ Hãy hỏi trước khi đổi máy, và{' '}
            <strong>đừng khôi phục cài đặt gốc máy cũ</strong> cho đến khi eSIM đã chạy trên máy mới.
          </P>
        </>
      ),
    },
    {
      id: 'luu-y',
      title: 'Vài điểm nên biết',
      body: (
        <>
          <Ul>
            <li>
              <strong>Hai số trên một máy.</strong> Máy hỗ trợ eSIM cho phép dùng song song một SIM
              vật lý và một eSIM &mdash; tiện khi tách số công việc và số cá nhân mà không cần hai máy.
            </li>
            <li>
              <strong>Sóng và vùng phủ không đổi.</strong> eSIM chỉ là hình thức lưu thông tin thuê
              bao; chất lượng sóng vẫn là của nhà mạng đó, không tốt hơn cũng không kém đi.
            </li>
            <li>
              <strong>Thuê bao trả trước có thời hạn.</strong> Số không phát sinh hoạt động trong thời
              gian dài có thể bị thu hồi &mdash; đáng lưu ý nếu bạn đi nước ngoài vài tháng mà vẫn cần
              nhận OTP ngân hàng.
            </li>
            <li>
              <strong>Máy hỏng nặng thì lấy số lại thế nào.</strong> Ra cửa hàng nhà mạng với CCCD để
              cấp lại profile. Vì vậy thông tin thuê bao đứng đúng tên bạn là chuyện quan trọng.
            </li>
          </Ul>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Chuyển từ SIM thường sang eSIM có bị đổi số không?',
      a: 'Không. Đây là đổi hình thức SIM, số điện thoại, gói cước và thông tin thuê bao giữ nguyên. Thủ tục làm tại cửa hàng giao dịch của nhà mạng, một số nhà mạng cho làm trên ứng dụng nếu thuê bao đã chuẩn hóa thông tin.',
    },
    {
      q: 'Chuyển sang eSIM cần giấy tờ gì?',
      a: 'Cần CCCD và mang theo chính chiếc điện thoại sẽ dùng eSIM, vì profile được cài bằng mã QR ngay tại quầy. Nếu thuê bao đứng tên người khác thì chủ thuê bao phải đi cùng hoặc có ủy quyền.',
    },
    {
      q: 'Đổi điện thoại mới thì eSIM chuyển sang thế nào?',
      a: 'Tùy nhà mạng: có nơi cho chuyển ngay trong ứng dụng hoặc qua tính năng chuyển eSIM giữa hai iPhone, có nơi phải ra cửa hàng cấp lại profile. Quan trọng nhất là đừng khôi phục cài đặt gốc máy cũ cho đến khi eSIM đã chạy trên máy mới.',
    },
    {
      q: 'Máy nào dùng được eSIM?',
      a: 'iPhone từ XS trở lên, Samsung Galaxy S và Z đời gần đây, Google Pixel và nhiều flagship khác. Kiểm tra trong Cài đặt › Di động xem có mục thêm eSIM không. Bản nội địa Trung Quốc của một số dòng không có phần cứng eSIM, và máy lock thường không kích hoạt được.',
    },
    {
      q: 'Dùng eSIM sóng có yếu hơn SIM thường không?',
      a: 'Không. eSIM chỉ là cách lưu thông tin thuê bao trong máy; chất lượng sóng và vùng phủ vẫn là của nhà mạng, không khác gì SIM vật lý.',
    },
    {
      q: 'Máy hỏng mất eSIM thì lấy lại số thế nào?',
      a: 'Ra cửa hàng giao dịch của nhà mạng với CCCD để được cấp lại profile cho máy mới. Đây là lý do nên để thuê bao đứng đúng tên mình — thuê bao đứng tên người khác sẽ rắc rối đúng vào lúc bạn cần nhất.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `eSIM Viettel, VinaPhone, MobiFone — chuyển đổi và giữ nguyên số | ${SITE_NAME}`,
  description:
    'Cách chuyển SIM vật lý sang eSIM mà giữ nguyên số, giấy tờ cần mang, máy nào hỗ trợ eSIM, và điều quan trọng nhất khi đổi điện thoại mới để không mất số.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function EsimViettelVinaphoneMobifonePage() {
  return <SeoArticle content={CONTENT} />
}
