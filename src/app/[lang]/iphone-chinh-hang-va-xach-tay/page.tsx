import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * iPHONE CHÍNH HÃNG VÀ XÁCH TAY — the Vietnamese half.
 *
 * ⛔ IT DIVERGES FROM THE ENGLISH PAGE DELIBERATELY. The English article has to establish what the
 * two words even mean; a Vietnamese reader knows that and is weighing something narrower — máy lock
 * vs quốc tế, which suffix is worth avoiding, what a shop's own warranty is actually worth, and how
 * much of the price gap comes back at resale. Translating the English page would spend half its
 * length explaining vocabulary the reader already has.
 */
const SLUG = 'iphone-chinh-hang-va-xach-tay'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'iPhone chính hãng và xách tay khác nhau thế nào',
  intro:
    'Cùng một model, cùng dung lượng, chênh nhau vài triệu đồng. Phần cứng giống hệt nhau — thứ khác biệt là ai có nghĩa vụ sửa khi máy hỏng, và bao nhiêu trong khoản chênh đó lấy lại được khi bán lại. Bài này giải thích các đuôi mã máy, giá trị thật của bảo hành cửa hàng, và trường hợp nào nên chọn xách tay.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/chinh-hang-vs-xach-tay-vietnam' },
  sections: [
    {
      id: 'duoi-ma-may',
      title: 'Đuôi mã máy nói lên điều gì',
      body: (
        <>
          <P>
            Mã máy nằm ở <strong>Cài đặt › Cài đặt chung › Giới thiệu</strong>, dòng Số hiệu kiểu máy.
            Đuôi mã cho biết máy được phân phối cho thị trường nào, và nó được ghi từ nhà máy nên
            không cửa hàng nào sửa được.
          </P>
          <Ul>
            <li><code>VN/A</code> &mdash; Apple Việt Nam phân phối, bảo hành 12 tháng tại mọi trung tâm ủy quyền trong nước.</li>
            <li><code>LL/A</code> &mdash; thị trường Mỹ. Phổ biến nhất trong hàng xách tay.</li>
            <li><code>ZA/A</code> &mdash; Singapore. Thường là máy hai SIM vật lý ở một số đời.</li>
            <li><code>J/A</code> &mdash; Nhật Bản. ⚠️ Không tắt được tiếng chụp ảnh, do quy định bên đó.</li>
            <li><code>ZP/A</code> &mdash; Hồng Kông. <code>KH/A</code> &mdash; Hàn Quốc.</li>
          </Ul>
          <P>
            Không có đuôi nào là hàng giả. Tất cả đều là máy chính hãng Apple sản xuất; khác nhau ở
            chỗ Apple Việt Nam có nhận bảo hành hay không.
          </P>
        </>
      ),
    },
    {
      id: 'may-lock-va-quoc-te',
      title: 'Máy lock và máy quốc tế — khác biệt quan trọng hơn đuôi mã',
      body: (
        <>
          <P>
            <strong>Máy quốc tế</strong> không khóa mạng, lắp SIM nào cũng chạy. <strong>Máy lock</strong>{' '}
            bị khóa theo nhà mạng nước ngoài (Verizon, AT&amp;T, Docomo…), phải dùng SIM ghép hoặc chỉ
            hoạt động với một nhà mạng. Giá máy lock rẻ hơn hẳn, và đó là khoản giảm giá cho một
            phiền phức kéo dài suốt đời máy: SIM ghép có thể lỗi sau mỗi lần cập nhật iOS, sóng chập
            chờn, và bán lại rất khó.
          </P>
          <P>
            Khi đọc tin rao, <em>QT</em> hoặc <em>quốc tế</em> là thứ cần tìm. Nếu tin không ghi rõ,
            hãy hỏi thẳng trước khi đi xem máy.
          </P>
        </>
      ),
    },
    {
      id: 'bao-hanh-cua-hang',
      title: 'Bảo hành cửa hàng đáng giá bao nhiêu',
      body: (
        <>
          <P>
            Bảo hành xách tay là cam kết của chính cửa hàng, thường 6&ndash;12 tháng, và giá trị của
            nó đúng bằng độ tin cậy của cửa hàng đó. Có ba câu hỏi nên hỏi và nên yêu cầu ghi vào
            phiếu:
          </P>
          <Ul>
            <li>Đổi máy mới trong bao nhiêu ngày đầu, hay chỉ sửa?</li>
            <li>Lỗi màn hình và lỗi pin có nằm trong bảo hành không? Đây là hai lỗi tốn kém nhất.</li>
            <li>Sửa tại chỗ hay gửi đi? Gửi đi nghĩa là bạn mất máy vài tuần.</li>
          </Ul>
          <P>
            Máy VN/A không cần những câu hỏi này: trung tâm ủy quyền nào cũng nhận, không phụ thuộc
            cửa hàng bán. Đó chính là thứ khoản chênh lệch giá mua được.
          </P>
        </>
      ),
    },
    {
      id: 'ban-lai',
      title: 'Bán lại: phần chênh lệch lấy lại được bao nhiêu',
      body: (
        <>
          <P>
            Thị trường máy cũ trong nước trả giá cao hơn cho máy VN/A, vì người mua tiếp theo cũng
            đang tính đúng bài toán này. Nghĩa là một phần đáng kể khoản chênh khi mua sẽ quay lại khi
            bán &mdash; chi phí thực của việc chọn chính hãng nhỏ hơn con số trên hóa đơn.
          </P>
          <P>
            Ngược lại, máy lock mất giá mạnh nhất và lâu bán nhất. Nếu có ý định đổi máy sau một hai
            năm, đây là yếu tố nên tính từ đầu chứ không phải lúc rao bán.
          </P>
          <P>
            Giá các đời máy mới nhất tại các nhà bán lẻ có trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Máy xách tay có phải hàng giả không?',
      a: 'Không. Đó là máy chính hãng Apple sản xuất, nhập về ngoài kênh phân phối chính thức. Phần cứng và phần mềm giống hệt máy VN/A. Khác biệt duy nhất là Apple Việt Nam không nhận bảo hành, cửa hàng bán tự bảo hành.',
    },
    {
      q: 'Làm sao biết iPhone là VN/A?',
      a: 'Vào Cài đặt › Cài đặt chung › Giới thiệu và đọc Số hiệu kiểu máy. Đuôi VN/A là máy Apple Việt Nam phân phối. Con số này ghi từ nhà máy, người bán không sửa được, nên đáng tin hơn mọi lời cam kết miệng.',
    },
    {
      q: 'Máy xách tay có dùng được eSIM ở Việt Nam không?',
      a: 'Được, nếu là máy quốc tế không khóa mạng. Viettel, VinaPhone, MobiFone và Vietnamobile đều cấp eSIM. Hai ngoại lệ: máy lock thường không kích hoạt được profile trong nước, và bản nội địa Trung Quốc của một số dòng không có phần cứng eSIM — nên kiểm tra trong Cài đặt › Di động trước khi mua.',
    },
    {
      q: 'Máy xách tay rẻ hơn bao nhiêu?',
      a: 'Thường vài triệu đồng với máy flagship đời mới, và khoảng cách thu hẹp dần khi các nhà bán lẻ chính hãng giảm giá sau đợt mở bán. Với đời máy cũ hơn, chênh lệch có thể gần như biến mất — nên kiểm tra trước khi chấp nhận đánh đổi bảo hành.',
    },
    {
      q: 'Mang máy mua ở nước ngoài về Việt Nam bảo hành được không?',
      a: 'Thường là không. Bảo hành iPhone của Apple gắn với quốc gia mua máy, nên trung tâm ủy quyền trong nước phần lớn từ chối máy LL/A hay ZA/A. Đây chính là ý nghĩa thực tế của khoản chênh lệch giá.',
    },
    {
      q: 'Máy J/A có nhược điểm gì?',
      a: 'Không tắt được tiếng màn trập khi chụp ảnh, do quy định của Nhật. Máy vẫn hoạt động bình thường mọi mặt khác, nhưng đây là điều gây khó chịu hằng ngày với nhiều người và làm máy khó bán lại hơn.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `iPhone chính hãng và xách tay khác nhau thế nào — VN/A, LL/A, ZA/A | ${SITE_NAME}`,
  description:
    'Giải thích đuôi mã VN/A, LL/A, ZA/A, J/A; phân biệt máy lock và máy quốc tế; bảo hành cửa hàng đáng giá bao nhiêu; và phần chênh lệch giá lấy lại được bao nhiêu khi bán lại.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function IPhoneChinhHangVaXachTayPage() {
  return <SeoArticle content={CONTENT} />
}
