import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * MUA ĐIỆN THOẠI TRẢ GÓP — the Vietnamese half.
 *
 * ⛔ NO LENDER IS NAMED AND NO RATE IS QUOTED AS FACT, same rule as the English page: terms move
 * monthly and an evergreen article that states one goes stale silently, which matters more here
 * because this is the page a reader acts on with money.
 *
 * ⚠️ IT ANSWERS A DIFFERENT QUESTION FROM ITS PAIR. The English page spends its length on whether a
 * foreigner can get a plan at all; that is not the Vietnamese reader's problem. Theirs is choosing
 * between thẻ tín dụng and công ty tài chính, spotting bảo hiểm khoản vay on the contract, and
 * knowing what a missed payment does to CIC.
 */
const SLUG = 'mua-dien-thoai-tra-gop'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Mua điện thoại trả góp 0% có thật sự 0%',
  intro:
    'Gần như cửa hàng nào cũng treo biển trả góp 0%. Có nơi đúng là 0%, có nơi chi phí nằm ở phí chuyển đổi, phí hồ sơ và bảo hiểm khoản vay. Bài này phân biệt hai hình thức trả góp, giấy tờ mỗi bên cần, các khoản phí thường bị bỏ qua, và một câu hỏi duy nhất giúp so sánh mọi gói với nhau.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/phone-instalments-vietnam' },
  sections: [
    {
      id: 'hai-hinh-thuc',
      title: 'Hai hình thức khác hẳn nhau dưới cùng một tấm biển',
      body: (
        <>
          <P>
            <strong>Trả góp qua thẻ tín dụng</strong>: bạn quẹt thẻ thanh toán đủ tiền máy, rồi ngân
            hàng chia nhỏ khoản đó thành các kỳ. Lãi suất có thể đúng là 0% vì cửa hàng đã trả phần
            trợ giá cho ngân hàng. ⚠️ Thứ thường không phải 0% là <strong>phí chuyển đổi trả góp</strong>,
            tính một lần theo phần trăm giá trị đơn hàng. Gói &ldquo;0% trong 12 tháng&rdquo; kèm phí
            chuyển đổi thực chất là khoản vay thu lãi ngay từ đầu.
          </P>
          <P>
            <strong>Trả góp qua công ty tài chính</strong>: nhân viên tài chính ngồi ngay tại cửa
            hàng, duyệt hồ sơ trong vòng một giờ, dành cho người không có thẻ tín dụng. Lãi suất niêm
            yết thường 0%, còn chi phí nằm ở <strong>phí hồ sơ</strong>, <strong>bảo hiểm khoản
            vay</strong> và khoản <strong>trả trước</strong> &mdash; thường 10&ndash;40% giá máy ngay
            hôm mua.
          </P>
        </>
      ),
    },
    {
      id: 'cau-hoi-duy-nhat',
      title: 'Câu hỏi duy nhất cần hỏi',
      body: (
        <>
          <P>
            Đừng hỏi lãi suất bao nhiêu. Hãy hỏi: <strong>&ldquo;Trả hết kỳ thì tổng cộng em phải trả
            bao nhiêu?&rdquo;</strong> &mdash; gồm trả trước, tất cả các kỳ và mọi loại phí, gộp thành
            một con số. Rồi so con số đó với giá tiền mặt của đúng chiếc máy ấy. Chênh lệch chính là
            chi phí của khoản vay.
          </P>
          <P>
            Yêu cầu ghi con số đó ra giấy trước khi ký. Gói 0% mà tổng bằng đúng giá tiền mặt thì đúng
            là 0%. Gói 0% mà tổng cao hơn giá tiền mặt 8% là khoản vay 8% mang tên khác &mdash; và cả
            hai kiểu có thể cùng tồn tại trong một cửa hàng, cùng một buổi chiều.
          </P>
        </>
      ),
    },
    {
      id: 'giay-to',
      title: 'Giấy tờ cần chuẩn bị',
      body: (
        <>
          <Ul>
            <li><strong>Qua thẻ tín dụng:</strong> thẻ tín dụng do ngân hàng trong nước phát hành, còn đủ hạn mức. Thường chỉ cần vậy.</li>
            <li><strong>Qua công ty tài chính:</strong> CCCD, thường thêm một giấy tờ thứ hai (bằng lái xe, hộ khẩu) và chứng minh thu nhập hoặc nơi ở.</li>
            <li><strong>Hạn mức và tuổi:</strong> mỗi công ty có quy định riêng về độ tuổi và thu nhập tối thiểu; nhân viên tại quầy sẽ kiểm tra trước khi nhận hồ sơ.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'cac-khoan-phi',
      title: 'Các khoản phí làm gói 0% không còn là 0%',
      body: (
        <>
          <P>
            <strong>Phí chuyển đổi</strong> ở hình thức thẻ, thu một lần theo phần trăm đơn hàng.{' '}
            <strong>Phí hồ sơ</strong> ở hình thức công ty tài chính. <strong>Bảo hiểm khoản vay</strong>{' '}
            &mdash; thường được giới thiệu là bắt buộc, đôi khi không; hãy hỏi rõ và hỏi số tiền cụ
            thể. <strong>Phí tất toán trước hạn</strong> là khoản hay gây bất ngờ nhất: trả hết sớm có
            thể bị tính phí theo phần trăm dư nợ, nên trả sớm chưa chắc tiết kiệm như bạn nghĩ.
          </P>
          <P>
            ⚠️ Trễ hạn là lúc một gói rẻ trở nên đắt. Phí phạt cao, và công ty tài chính có báo cáo
            lên CIC &mdash; một kỳ trễ có thể ảnh hưởng đến các khoản vay sau này của bạn.
          </P>
        </>
      ),
    },
    {
      id: 'co-nen-tra-gop',
      title: 'Khi nào nên trả góp',
      body: (
        <>
          <P>
            Gói 0% thật, không phí, là khoản vay miễn phí &mdash; giữ tiền trong tài khoản và trả dần
            là hợp lý. Càng nhiều phí thì lập luận càng yếu: ở mức 6&ndash;8% tổng chi phí trên một
            máy flagship, bạn đang trả tiền cho việc không phải chờ, một lựa chọn chính đáng nhưng
            khác hẳn.
          </P>
          <P>
            Phương án đáng cân nhắc trước tiên là mua đứt một máy rẻ hơn. Một flagship đời trước hoặc
            một máy tầm trung tốt, trả tiền mặt, thường rẻ hơn cả phần chi phí tài chính của máy mới
            nhất &mdash; và bạn sở hữu nó hoàn toàn ngay từ ngày đầu. Giá các đời mới có trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Trả góp 0% có thật sự không mất thêm tiền không?',
      a: 'Có trường hợp đúng, nhiều trường hợp không. Lãi suất có thể bằng 0 trong khi chi phí nằm ở phí chuyển đổi, phí hồ sơ hoặc bảo hiểm khoản vay. Cách kiểm tra: hỏi tổng số tiền phải trả đến hết kỳ rồi so với giá tiền mặt — bằng nhau thì đúng là 0%.',
    },
    {
      q: 'Trả góp qua thẻ tín dụng và qua công ty tài chính khác nhau thế nào?',
      a: 'Qua thẻ, bạn đã thanh toán đủ và ngân hàng chia nhỏ khoản đó, thường không cần trả trước nhưng có thể có phí chuyển đổi. Qua công ty tài chính là một khoản vay mới, duyệt nhanh tại quầy, thường cần trả trước 10–40% và có phí hồ sơ, bảo hiểm khoản vay.',
    },
    {
      q: 'Mua trả góp cần giấy tờ gì?',
      a: 'Qua thẻ tín dụng thì chỉ cần thẻ còn hạn mức. Qua công ty tài chính cần CCCD, thường thêm một giấy tờ thứ hai như bằng lái xe, và chứng minh thu nhập hoặc nơi ở. Hồ sơ thường được duyệt trong vòng một giờ.',
    },
    {
      q: 'Phải trả trước bao nhiêu phần trăm?',
      a: 'Các gói qua công ty tài chính thường yêu cầu trả trước 10–40% giá máy. Trả trước nhiều hơn thường đổi lại kỳ trả hàng tháng thấp hơn hoặc thời hạn ngắn hơn. Trả góp qua thẻ tín dụng thường không cần trả trước.',
    },
    {
      q: 'Tất toán trước hạn có bị phạt không?',
      a: 'Thường có, tính theo phần trăm dư nợ còn lại, và khoản phí này có thể triệt tiêu phần lãi bạn định tiết kiệm. Hãy hỏi con số cụ thể trước khi ký hợp đồng chứ không phải lúc muốn tất toán.',
    },
    {
      q: 'Trễ một kỳ thì sao?',
      a: 'Phí phạt cao và thông tin được báo lên CIC, ảnh hưởng tới khả năng vay sau này. Nếu biết trước sẽ khó xoay tiền, liên hệ công ty tài chính trước ngày đến hạn luôn tốt hơn là để trễ.',
    },
    {
      q: 'Người nước ngoài mua trả góp được không?',
      a: 'Thường chỉ qua thẻ tín dụng do ngân hàng trong nước phát hành. Các gói qua công ty tài chính hầu hết yêu cầu CCCD nên hộ chiếu không đủ. Mua đứt thì chỉ cần hộ chiếu.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Mua điện thoại trả góp 0% có thật sự 0% — phí ẩn cần biết | ${SITE_NAME}`,
  description:
    'Trả góp qua thẻ tín dụng và qua công ty tài chính khác nhau thế nào, cần giấy tờ gì, phí chuyển đổi và bảo hiểm khoản vay ảnh hưởng ra sao, và câu hỏi duy nhất giúp so sánh mọi gói trả góp.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function MuaDienThoaiTraGopPage() {
  return <SeoArticle content={CONTENT} />
}
