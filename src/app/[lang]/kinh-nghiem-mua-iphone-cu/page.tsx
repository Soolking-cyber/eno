import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * KINH NGHIỆM MUA iPHONE CŨ — the Vietnamese half.
 *
 * ⚠️ IT SHARES THE INSPECTION WITH THE ENGLISH PAGE AND LITTLE ELSE. The English article has to
 * explain what a "99%" grade is; this one can assume it and spend the space on what a Vietnamese
 * buyer actually gets caught by — máy dựng, màn hình lô, pin chai được "cấy" số liệu, và cách mặc cả
 * quanh những thứ đó. The overlap is the checklist itself, which is the same phone either way.
 */
const SLUG = 'kinh-nghiem-mua-iphone-cu'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Kinh nghiệm mua iPhone cũ: kiểm tra trong 10 phút',
  intro:
    'Thị trường iPhone cũ ở Việt Nam rất lớn và phần lớn người bán làm ăn đàng hoàng. Rủi ro tập trung vào vài lỗi cụ thể — máy dính iCloud, màn hình đã thay, pin đã bị can thiệp — và tất cả đều phát hiện được trong khoảng mười phút khi cầm máy trên tay. Đây là quy trình kiểm tra đó, xếp theo mức thiệt hại nếu bỏ qua.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/buying-a-used-iphone-vietnam' },
  sections: [
    {
      id: 'truoc-khi-di-xem',
      title: 'Trước khi đi xem máy',
      body: (
        <>
          <P>
            Chốt trước ba thứ: model và dung lượng, mức giá trần, và địa điểm gặp. Hẹn ở nơi công
            cộng, sáng sủa và <strong>có Wi-Fi</strong> &mdash; vài bước kiểm tra bên dưới cần mạng.
          </P>
          <P>
            So giá máy cũ với giá máy mới VN/A cùng model. Nếu máy cũ chỉ rẻ hơn khoảng 20%, khoản
            giảm đó chưa bù cho việc mất bảo hành chính hãng; khi ấy một máy đời thấp hơn nhưng còn
            bảo hành thường là lựa chọn tốt hơn.
          </P>
        </>
      ),
    },
    {
      id: 'kiem-tra',
      title: 'Mười bước kiểm tra, theo thứ tự thiệt hại',
      body: (
        <>
          <Ul>
            <li>
              <strong>1. iCloud đã đăng xuất.</strong> Cài đặt › [tên] phải trống và Tìm (Find My) phải
              tắt. Máy còn dính iCloud là cục chặn giấy, không cửa hàng nào mở được. Kiểm tra đầu
              tiên, và nếu người bán trì hoãn thì dừng lại luôn.
            </li>
            <li>
              <strong>2. IMEI trùng ở ba nơi:</strong> trong Giới thiệu, trên vỏ hộp, và trên trang
              kiểm tra bảo hành của Apple. Lệch nhau nghĩa là vỏ, main hoặc câu chuyện đã bị thay.
            </li>
            <li>
              <strong>3. Tình trạng pin.</strong> Cài đặt › Pin › Tình trạng pin. Dưới 85% là sắp phải
              thay, phải trừ vào giá. ⚠️ Không hiện mục tình trạng pin thường là đã thay pin lô.
            </li>
            <li>
              <strong>4. Face ID.</strong> Đăng ký khuôn mặt ngay tại chỗ. Face ID hỏng là dấu hiệu
              máy đã bị mở, và cụm TrueDepth là một trong những thứ sửa đắt nhất.
            </li>
            <li>
              <strong>5. Màn hình.</strong> Máy đời mới hiện mục &ldquo;Lịch sử linh kiện và dịch
              vụ&rdquo; trong Giới thiệu nếu màn hoặc pin không phải hàng gốc. Ngoài ra để ý ám màu ở
              rìa, độ trắng lệch so với viền, và cảm ứng chết ở góc.
            </li>
            <li><strong>6. Camera:</strong> chụp và quay thử đủ các ống kính, cả trước lẫn sau; soi bụi trong kính.</li>
            <li><strong>7. Cổng sạc, loa, cả hai micro</strong> &mdash; ghi âm rồi gọi thử, vì mỗi cách chỉ kiểm tra một micro.</li>
            <li><strong>8. Dấu vào nước:</strong> soi đèn vào chân sạc tìm vết ăn mòn; màn nhấp nháy khi máy nóng cũng là dấu hiệu.</li>
            <li><strong>9. Lắp SIM của bạn</strong> và gọi thật, vào mạng thật. Bước này cũng lộ luôn máy lock đang được rao là quốc tế.</li>
            <li><strong>10. Khởi động lại máy</strong> trước mặt người bán &mdash; bắt được lỗi treo táo và máy sửa dở.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'may-dung',
      title: 'Máy dựng: thứ khó nhận ra nhất',
      body: (
        <>
          <P>
            Máy dựng được lắp từ linh kiện của nhiều máy, thường là vỏ mới với main cũ. Nhìn bề ngoài
            đẹp hơn cả máy zin, nên mắt thường gần như vô dụng. Dấu hiệu đáng tin là những thứ khó làm
            giả: IMEI lệch giữa máy và hộp, Face ID không hoạt động, mục lịch sử linh kiện báo màn
            hoặc pin không chính hãng, và tình trạng pin hiển thị bất thường.
          </P>
          <P>
            Một cách kiểm tra nhanh nữa: so ngày kích hoạt trên trang bảo hành Apple với đời máy. Máy
            &ldquo;mới 99%&rdquo; nhưng kích hoạt từ ba năm trước thì câu chuyện không khớp.
          </P>
        </>
      ),
    },
    {
      id: 'mac-ca-va-thanh-toan',
      title: 'Mặc cả và thanh toán',
      body: (
        <>
          <P>
            Mặc cả dựa trên thứ đo được, không dựa trên cảm tính: pin 82% là một khoản thay pin, màn
            đã thay là một khoản giảm, thiếu hộp và phụ kiện là một khoản nữa. Người bán tử tế chấp
            nhận lập luận kiểu này vì nó có căn cứ.
          </P>
          <P>
            Chỉ trả tiền sau khi kiểm tra xong. Chuyển khoản để lại dấu vết giao dịch, chụp lại màn
            hình IMEI, xin số điện thoại và giữ phiếu bảo hành nếu mua ở cửa hàng. Không đặt cọc trước
            khi xem máy.
          </P>
          <P>
            Có thể xem giá máy mới cùng model trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink> để biết mức giảm của máy
            cũ đã hợp lý chưa.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Mua iPhone cũ cần kiểm tra những gì?',
      a: 'iCloud đã đăng xuất và tắt Find My, IMEI trùng ở ba nơi, tình trạng pin, Face ID, lịch sử linh kiện, camera đủ ống kính, cổng sạc và hai micro, lắp SIM gọi thử, và khởi động lại máy trước mặt người bán.',
    },
    {
      q: 'Pin bao nhiêu phần trăm thì nên mua?',
      a: 'Trên 90% là tốt, 85–90% chấp nhận được, dưới 85% là sắp phải thay pin và cần trừ vào giá. Nếu máy không hiện mục tình trạng pin thì gần như chắc chắn đã thay pin không chính hãng.',
    },
    {
      q: 'Làm sao biết máy đã thay màn hình?',
      a: 'Máy đời mới báo trong Cài đặt › Cài đặt chung › Giới thiệu, mục Lịch sử linh kiện và dịch vụ. Ngoài ra nhìn ám màu ở rìa màn, độ trắng lệch so với viền máy, và thử cảm ứng ở bốn góc.',
    },
    {
      q: 'Máy dính iCloud có mở được không?',
      a: 'Không. Khóa kích hoạt gắn với tài khoản Apple của chủ cũ và không cửa hàng nào gỡ được. Chỉ chủ cũ đăng xuất mới dùng được máy, nên đây là thứ phải kiểm tra đầu tiên.',
    },
    {
      q: 'Mua ở cửa hàng hay mua của cá nhân?',
      a: 'Cửa hàng đắt hơn nhưng có bảo hành ngắn 1–6 tháng và địa chỉ để quay lại. Mua cá nhân rẻ hơn và giao dịch là xong, phù hợp khi bạn đã kiểm tra đủ và mức giảm giá thực sự đáng.',
    },
    {
      q: 'Máy 99% và likenew khác nhau không?',
      a: 'Cả hai đều là cách người bán mô tả ngoại hình, không có tiêu chuẩn chung. Hai máy cùng ghi 99% có thể chênh nhau cả năm tuổi pin, nên hãy đọc đó như mô tả vết xước và tự kiểm tra phần còn lại.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Kinh nghiệm mua iPhone cũ — 10 bước kiểm tra trước khi trả tiền | ${SITE_NAME}`,
  description:
    'Cách phát hiện máy dính iCloud, máy dựng, màn hình đã thay và pin lô khi mua iPhone cũ tại Việt Nam — mười bước kiểm tra trong mười phút, và cách mặc cả dựa trên những gì đo được.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function KinhNghiemMuaIPhoneCuPage() {
  return <SeoArticle content={CONTENT} />
}
