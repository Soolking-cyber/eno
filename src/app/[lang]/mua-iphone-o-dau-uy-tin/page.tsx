import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * MUA iPHONE Ở ĐÂU UY TÍN — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and the two articles deliberately diverge. The English page spends its
 * length on what a foreigner cannot assume — that a passport is enough, what VN/A means, how the VAT
 * refund works. A Vietnamese reader already knows all of that and is asking different questions:
 * which chain is actually cheapest after the promotion, what "máy trưng bày" and "hàng dựng" mean,
 * how to check a shop before paying a deposit, and whether the online price is the real price.
 * Machine-translating either page would answer the wrong questions in both languages.
 *
 * ⚠️ NO SHOP IS NAMED AS "UY TÍN NHẤT". The marketplace lists several of these retailers and earns
 * affiliate revenue from some, so a ranking here would be an advertisement with an editorial byline.
 */
const SLUG = 'mua-iphone-o-dau-uy-tin'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Mua iPhone ở đâu uy tín',
  intro:
    'Giá rẻ nhất trên kết quả tìm kiếm gần như không bao giờ đến từ nơi an toàn nhất để mua. Bài này phân biệt năm kiểu cửa hàng đang bán iPhone tại Việt Nam, khoản chênh lệch giá thực sự mua được gì, và cách kiểm tra một chiếc máy ngay tại quầy trước khi trả tiền.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/best-place-to-buy-iphone-vietnam' },
  sections: [
    {
      id: 'nam-kieu-cua-hang',
      title: 'Năm kiểu cửa hàng và ai hợp với kiểu nào',
      body: (
        <>
          <P>
            <strong>Đại lý ủy quyền của Apple (AAR)</strong> chỉ bán máy chính hãng VN/A, bảo hành 12
            tháng qua trung tâm ủy quyền. Giá thường bằng hoặc thấp hơn giá niêm yết một chút, xuất
            hóa đơn đỏ mặc định. Đây là lựa chọn ít rủi ro nhất và cũng ít bất ngờ nhất về giá.
          </P>
          <P>
            <strong>Chuỗi bán lẻ lớn</strong> bày cả hàng VN/A lẫn hàng nhập trên cùng một kệ. Họ giảm
            giá mạnh hơn, chạy trả góp 0%, và nhân viên thường nói thẳng máy nào là loại nào nếu được
            hỏi. Phần lớn người Việt mua ở đây, và giá niêm yết trên web thường đúng là giá phải trả.
          </P>
          <P>
            <strong>Cửa hàng chuyên hàng xách tay</strong> nhập máy từ Mỹ, Singapore, Nhật hoặc Hồng
            Kông. Giá máy mới thường rẻ nhất thị trường, đổi lại bảo hành là của chính cửa hàng,
            thường 6&ndash;12 tháng và chỉ có giá trị tại đó. Hợp lý nếu cửa hàng có địa chỉ rõ ràng
            và bạn ở gần; rủi ro nếu bạn sắp chuyển đi nơi khác.
          </P>
          <P>
            <strong>Cửa hàng máy cũ &ndash; thu cũ đổi mới</strong> bán máy đã qua sử dụng phân loại
            theo tình trạng, hay gọi là &ldquo;99%&rdquo; hoặc &ldquo;likenew&rdquo;. Nơi làm ăn tử tế
            sẽ cho kiểm tra thoải mái trước khi thanh toán và bảo hành 1&ndash;6 tháng. Đây là nhóm
            mà việc kiểm tra máy quan trọng nhất.
          </P>
          <P>
            <strong>Người bán cá nhân</strong> &mdash; chính chủ bán lại máy đang dùng, trên các sàn
            rao vặt như chính trang này. Giá thấp nhất, không bảo hành. Mọi thứ phụ thuộc vào việc gặp
            trực tiếp và kiểm tra máy cho kỹ.
          </P>
        </>
      ),
    },
    {
      id: 'tu-vung-can-biet',
      title: 'Ba từ cần hiểu trước khi đọc bất kỳ tin rao nào',
      body: (
        <>
          <P>
            <strong>Máy trưng bày</strong> là máy đã bày ở quầy cho khách trải nghiệm. Vẫn là máy mới,
            chưa qua sử dụng thực tế, nhưng đã kích hoạt hoặc sắp hết một phần thời gian bảo hành, và
            phải rẻ hơn máy nguyên seal một khoản đáng kể.
          </P>
          <P>
            <strong>Hàng dựng</strong> là máy được lắp lại từ linh kiện của nhiều máy khác nhau, đôi
            khi vỏ mới ruột cũ. Đây là thứ cần tránh, và cũng là lý do phần kiểm tra bên dưới tồn tại
            &mdash; máy dựng nhìn bề ngoài rất khó phân biệt.
          </P>
          <P>
            <strong>Máy lock</strong> là máy còn khóa mạng của nhà mạng nước ngoài, phải dùng SIM ghép
            hoặc chỉ chạy được với một nhà mạng. Giá rẻ hơn hẳn và đi kèm phiền phức lâu dài; máy
            quốc tế (<em>quốc tế</em> hoặc <em>QT</em>) thì không.
          </P>
        </>
      ),
    },
    {
      id: 'kiem-tra-tai-quay',
      title: 'Kiểm tra ngay tại quầy, trước khi trả tiền',
      body: (
        <>
          <P>
            Mọi thứ dưới đây làm được trong vài phút và cửa hàng đàng hoàng sẽ không ngăn bạn. Nếu bị
            từ chối, đó chính là câu trả lời.
          </P>
          <Ul>
            <li>
              <strong>Cài đặt › Cài đặt chung › Giới thiệu</strong>: đọc Số hiệu kiểu máy. Đuôi{' '}
              <code>VN/A</code> là máy Apple Việt Nam phân phối; <code>LL/A</code> là Mỹ,{' '}
              <code>ZA/A</code> là Singapore, <code>J/A</code> là Nhật. Cửa hàng không sửa được con số
              này.
            </li>
            <li>
              Đối chiếu <strong>IMEI</strong> trên máy, trên vỏ hộp và trên trang kiểm tra bảo hành
              của Apple. Ba nơi phải trùng nhau.
            </li>
            <li>
              <strong>Tình trạng pin</strong> (Cài đặt › Pin): máy mới phải là 100%. Máy cũ dưới 85%
              nghĩa là sắp phải thay pin, hãy tính khoản đó vào giá.
            </li>
            <li>
              Chụp thử cả camera trước và sau, bật Face ID, cắm sạc, thử loa và cả hai micro. Lỗi Face
              ID là dấu hiệu máy từng bị mở ra.
            </li>
            <li>
              Xác nhận máy đã <strong>đăng xuất iCloud</strong> hoàn toàn. Còn iCloud của người khác
              thì chiếc máy đó không dùng được, và đây là rủi ro lớn nhất khi mua máy cũ.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'gia-va-hoa-don',
      title: 'Giá niêm yết, giá thật và hóa đơn',
      body: (
        <>
          <P>
            Giá trên web của chuỗi lớn thường là giá thật. Giá rẻ bất thường so với mặt bằng cùng
            model, cùng dung lượng gần như luôn có lý do: máy trưng bày, máy đã kích hoạt, dung lượng
            thấp hơn, hoặc gói kèm phụ kiện &ldquo;tặng&rdquo; đã được cộng vào giá máy.
          </P>
          <P>
            Yêu cầu <strong>hóa đơn đỏ</strong> nếu bạn cần cho công ty hoặc muốn giữ bằng chứng mua
            bán đầy đủ &mdash; hóa đơn có mã số thuế của cửa hàng và IMEI của máy. Phiếu viết tay chỉ
            là căn cứ cho bảo hành của chính cửa hàng đó. Đừng đặt cọc giữ máy ở nơi bạn chưa từng
            đến.
          </P>
          <P>
            Giá thị trường hôm nay của dòng mới nhất có trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>, đọc trực tiếp từ tin
            rao của các nhà bán lẻ chứ không phải từ thông cáo báo chí.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Mua iPhone ở đâu rẻ nhất?',
      a: 'Cửa hàng chuyên hàng xách tay thường có giá máy mới thấp nhất, sau đó là các chuỗi lớn trong đợt khuyến mãi. Rẻ nhất vẫn là mua lại từ người bán cá nhân, nhưng không có bảo hành. Chênh lệch so với đại lý ủy quyền thường vài triệu đồng trên máy flagship đời mới.',
    },
    {
      q: 'iPhone VN/A và xách tay khác nhau thế nào?',
      a: 'VN/A là máy do Apple Việt Nam phân phối, bảo hành 12 tháng tại mọi trung tâm ủy quyền. Máy xách tay mang mã LL/A, ZA/A hoặc J/A, do cửa hàng tự bảo hành. Máy giống hệt nhau về phần cứng; khác nhau ở chỗ ai chịu trách nhiệm khi hỏng.',
    },
    {
      q: 'Làm sao biết máy có phải hàng dựng không?',
      a: 'Kiểm tra số hiệu kiểu máy và IMEI ở ba nơi phải trùng nhau, thử Face ID, xem tình trạng pin và chụp thử cả hai camera. Máy dựng thường lỗi Face ID, pin báo bất thường hoặc IMEI không khớp vỏ hộp. Mua ở nơi cho kiểm tra thoải mái trước khi trả tiền.',
    },
    {
      q: 'Máy trưng bày có nên mua không?',
      a: 'Có, nếu giá giảm tương xứng. Đó vẫn là máy mới chưa qua sử dụng thực tế, nhưng thường đã kích hoạt nên thời gian bảo hành còn lại ngắn hơn. Hỏi rõ ngày kích hoạt và tính lại giá theo phần bảo hành còn lại.',
    },
    {
      q: 'Mua trả góp 0% có mất thêm phí không?',
      a: 'Thường có: phí chuyển đổi trả góp qua thẻ tín dụng, hoặc phí hồ sơ và bảo hiểm khoản vay nếu vay qua công ty tài chính. Hãy hỏi tổng số tiền phải trả đến hết kỳ, không hỏi lãi suất — con số tổng là thứ so sánh được.',
    },
    {
      q: 'Mua iPhone cũ cần kiểm tra những gì?',
      a: 'Tình trạng pin, iCloud đã đăng xuất, IMEI khớp, Face ID hoạt động, camera và loa bình thường, màn hình không ám hay hở sáng. Nên hẹn gặp ở nơi công cộng có sóng Wi-Fi để kiểm tra đủ trước khi chuyển tiền.',
    },
    {
      q: 'Có cần hóa đơn đỏ không?',
      a: 'Cần nếu bạn thanh toán cho công ty hoặc muốn hoàn thuế VAT khi xuất cảnh. Mua cá nhân thì không bắt buộc, nhưng một cửa hàng từ chối xuất hóa đơn là một thông tin đáng lưu ý về cách họ làm ăn.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Mua iPhone ở đâu uy tín — 5 kiểu cửa hàng và cách kiểm tra máy | ${SITE_NAME}`,
  description:
    'Năm kiểu cửa hàng bán iPhone tại Việt Nam, chênh lệch giá mua được gì, cách phân biệt máy VN/A, máy trưng bày và hàng dựng, và các bước kiểm tra ngay tại quầy trước khi trả tiền.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function MuaIPhoneODauUyTinPage() {
  return <SeoArticle content={CONTENT} />
}
