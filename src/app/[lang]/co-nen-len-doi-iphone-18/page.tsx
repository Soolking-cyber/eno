import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * CÓ NÊN LÊN ĐỜI iPHONE 18 — the Vietnamese half.
 *
 * ⛔ NO PRICES IN THE PROSE, same rule as the English page: the live figures live on
 * /iphone-18-vietnam and a number typed here goes stale silently.
 *
 * ⚠️ THE ANGLE DIFFERS. The English page argues the upgrade as a subtraction for someone who may
 * leave the country; this one is written for a reader who will resell locally and cares about
 * giá thu lại, thu cũ đổi mới, and whether to wait for the spring non-Pro models — the questions
 * that actually get typed in Vietnamese.
 */
const SLUG = 'co-nen-len-doi-iphone-18'

const CONTENT: ArticleContent = {
  eyebrow: 'So sánh',
  h1: 'Có nên lên đời iPhone 18',
  intro:
    'Với phần lớn người đang dùng iPhone 17 Pro, câu trả lời là chưa cần. Câu hỏi đáng quan tâm hơn là nên làm gì thay vào đó. Thị trường máy cũ trong nước rất sâu, nên chi phí thật của việc lên đời không phải giá máy mới, mà là khoản chênh giữa giá máy mới và số tiền bán được máy đang dùng trong tháng này.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/iphone-18-vs-iphone-17-vietnam' },
  sections: [
    {
      id: 'thay-doi-gi',
      title: 'iPhone 18 thay đổi những gì',
      body: (
        <>
          <P>
            Apple chia năm 2026 làm hai đợt. iPhone 18 Pro và Pro Max ra mắt ngày 9 tháng 9, bán tại
            Việt Nam từ 18 tháng 9; máy gập iPhone Duo mở bán sau, từ 23 tháng 10. ⚠️ Mùa thu này{' '}
            <strong>không có bản iPhone 18 thường</strong> &mdash; các bản không Pro dời sang mùa xuân
            &mdash; nên &ldquo;iPhone 18&rdquo; ở cửa hàng hiện nay đồng nghĩa với Pro hoặc Pro Max.
          </P>
          <P>
            So với 17 Pro, khác biệt là mức nâng cấp một đời thông thường: chip nhanh hơn, xử lý ảnh
            tốt hơn, màn hình và pin tinh chỉnh. Có thật và đo được, nhưng không đủ để khiến một chiếc
            máy hai năm tuổi trở nên lỗi thời.
          </P>
        </>
      ),
    },
    {
      id: 'chi-phi-that',
      title: 'Tính chi phí thật: lấy giá mới trừ giá bán lại',
      body: (
        <>
          <P>
            Đừng nhìn giá máy mới, hãy nhìn khoản chênh. Hỏi giá thu lại thực tế cho đúng model, đúng
            dung lượng, đúng tình trạng máy bạn đang cầm &mdash; rồi lấy giá máy mới trừ đi. Con số đó
            mới là thứ cần cân nhắc.
          </P>
          <Ul>
            <li>Bán cho người dùng cuối được giá cao nhất nhưng mất công nhất; thu cũ đổi mới tại cửa hàng nhanh hơn và được ít tiền hơn.</li>
            <li>Pin trên 90%, còn hộp và phụ kiện làm tăng giá bán lại một cách rõ rệt.</li>
            <li>⚠️ Bán càng sớm càng tốt: máy đời cũ mất giá nhanh nhất trong vài tuần ngay sau khi đời mới mở bán.</li>
            <li>Máy VN/A giữ giá tốt hơn máy xách tay, vì người mua tiếp theo cũng tính đúng bài toán bảo hành.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'ai-nen-len-doi',
      title: 'Ai nên lên đời, ai nên chờ',
      body: (
        <>
          <P>
            <strong>Nên lên đời</strong> nếu đang dùng iPhone 15 trở về trước. Ba đời cộng dồn về
            camera, pin và độ sáng màn hình tạo ra khác biệt cảm nhận được hằng ngày. Cũng nên nếu bạn
            quay video để làm việc.
          </P>
          <P>
            <strong>Chưa cần</strong> nếu đang dùng 17 Pro, trừ khi bạn bán được máy cũ ngay và khoản
            chênh thực tế nhỏ. Nhảy một đời là trường hợp kinh điển nên bỏ qua.
          </P>
          <P>
            <strong>Nên chờ</strong> nếu bạn muốn bản không Pro. iPhone 18 thường, 18e và iPhone Air
            thế hệ hai dự kiến ra mắt nửa đầu 2027 &mdash; mua một máy tạm bây giờ để rồi đổi lần nữa
            sau nửa năm hiếm khi hợp lý.
          </P>
        </>
      ),
    },
    {
      id: 'phuong-an-thay-the',
      title: 'Phương án đáng cân nhắc: mua chính chiếc 17 Pro',
      body: (
        <>
          <P>
            Trong vài tuần sau mỗi đợt mở bán, flagship đời trước là món đáng tiền nhất trên thị
            trường Việt Nam: máy mới giảm giá mạnh, máy cũ dồi dào, và còn nhiều năm được cập nhật
            phần mềm phía trước. Khác biệt sử dụng hằng ngày so với 18 Pro là nhỏ với phần lớn người
            dùng.
          </P>
          <P>
            Nếu vẫn chọn máy mới, cân nhắc giữa Pro và Pro Max chủ yếu ở kích thước: máy 6,9 inch khá
            vướng khi đi xe máy, còn bản 6,3 inch dễ dùng một tay hơn; đổi lại Pro Max trụ lâu hơn hẳn
            khi chạy bản đồ và xem video cả ngày.
          </P>
          <P>
            Giá thực tế từng phiên bản có trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>, tách riêng{' '}
            <HereLink href="/iphone-18-pro-vietnam">bản Pro</HereLink> và{' '}
            <HereLink href="/iphone-18-pro-max-vietnam">bản Pro Max</HereLink> theo từng dung lượng.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Đang dùng iPhone 17 Pro có nên lên iPhone 18 Pro không?',
      a: 'Phần lớn là chưa cần. Đây là mức nâng cấp một đời — chip nhanh hơn, ảnh xử lý tốt hơn, pin và màn tinh chỉnh — trong khi 17 Pro vẫn còn nhiều năm được hỗ trợ. Chỉ nên cân nhắc nếu bán được máy cũ ngay và khoản chênh thực tế nhỏ.',
    },
    {
      q: 'Có bản iPhone 18 thường không?',
      a: 'Mùa thu 2026 thì không. Apple dời các bản không Pro sang mùa xuân, dự kiến iPhone 18 thường, 18e và iPhone Air thế hệ hai ra mắt nửa đầu 2027. Hiện tại "iPhone 18" ở cửa hàng là Pro hoặc Pro Max.',
    },
    {
      q: 'Nên mua iPhone 17 Pro giá giảm hay iPhone 18 Pro mới?',
      a: 'Với đa số người dùng, 17 Pro lúc này là món hời hơn: giảm giá mạnh sau khi đời mới ra, còn nhiều năm cập nhật, và khác biệt hằng ngày so với 18 Pro là nhỏ. Chọn máy mới nếu bạn quay video chuyên nghiệp hoặc muốn giữ máy thật lâu.',
    },
    {
      q: 'Bán iPhone 17 Pro cũ được bao nhiêu?',
      a: 'Tùy tình trạng máy, độ chai pin, máy VN/A hay xách tay, còn hộp hay không — và giá rơi nhanh nhất trong vài tuần ngay sau khi đời mới mở bán. Hãy tham khảo tin rao thực tế đúng model và dung lượng thay vì con số chung chung, và bán sớm.',
    },
    {
      q: 'iPhone 18 Pro và Pro Max nên chọn bản nào?',
      a: 'Hai máy chung chip, chung camera, chung các mức dung lượng, nên chỉ khác kích thước và pin. Bản 6,3 inch dễ cầm một tay và gọn khi đi xe máy; bản 6,9 inch trụ lâu hơn khi dùng nặng và đắt hơn khoảng 3 triệu đồng mỗi mức dung lượng.',
    },
    {
      q: 'iPhone 17 còn được cập nhật bao lâu nữa?',
      a: 'Apple thường hỗ trợ iPhone với các bản iOS lớn trong khoảng năm đến sáu năm kể từ khi ra mắt, cộng thêm các bản vá bảo mật sau đó. Một chiếc 17 Pro mua lúc này vẫn còn phần lớn khoảng thời gian đó.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Có nên lên đời iPhone 18 — tính chi phí thật trước khi đổi máy | ${SITE_NAME}`,
  description:
    'iPhone 18 Pro khác iPhone 17 Pro những gì, cách tính chi phí lên đời bằng giá bán lại máy cũ, khi nào nên chờ bản không Pro mùa xuân 2027, và vì sao 17 Pro lúc này thường là lựa chọn hợp lý hơn.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function CoNenLenDoiIPhone18Page() {
  return <SeoArticle content={CONTENT} />
}
