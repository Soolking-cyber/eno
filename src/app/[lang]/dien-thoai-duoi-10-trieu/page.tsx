import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * ĐIỆN THOẠI DƯỚI 10 TRIỆU — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and it answers a different reader. The English page
 * (/phones-under-10-million-vietnam) spends its length on what a foreigner cannot assume: that the
 * mid-range brands sold here are unfamiliar but mainstream, that an imported unit can miss a band or
 * ship a China-market software build, that eSIM and NFC are not guaranteed at this price, and that a
 * passport is enough to buy outright. A Vietnamese reader knows all of that already. This page argues
 * the question they actually type instead — máy mới tầm trung hay flagship cũ — and spends a whole
 * section on the marketing numbers that mislead in this segment (chấm camera, RAM mở rộng, số W sạc
 * nhanh, 120Hz trên tấm nền LCD) plus the local inspection that decides a used purchase. Machine
 * translation of either page would answer the wrong questions in both languages.
 *
 * ⛔ KHÔNG GHI GIÁ CỤ THỂ trong bài: giá cũ đi rất nhanh rồi bị trích dẫn mãi. Con số duy nhất là
 * ngân sách 10 triệu, tức chính chủ đề; phần giá thật trỏ sang /iphone-18-vietnam đọc tin rao trực
 * tiếp. Cũng không xếp hạng hay gọi tên cửa hàng nào là "uy tín nhất" — sàn có liên kết doanh thu với
 * một số nhà bán lẻ, nên một bảng xếp hạng ở đây là quảng cáo đội lốt bài viết.
 */
const SLUG = 'dien-thoai-duoi-10-trieu'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Điện thoại dưới 10 triệu: mua máy mới hay máy cũ',
  intro:
    'Đây là tầm giá đông người mua nhất và cũng là tầm giá phải cân nhắc nhiều nhất, vì cùng số tiền đó bạn đứng trước hai loại máy khác hẳn nhau: một chiếc Android tầm trung mới nguyên seal, bảo hành đầy đủ, pin mới; hoặc một chiếc flagship đời trước đã qua tay người khác. Bài này nói rõ mỗi bên cho gì, cắt gì, hợp với ai, và những thông số nghe kêu nhưng không có nhiều giá trị thực tế ở phân khúc này.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/phones-under-10-million-vietnam' },
  sections: [
    {
      id: 'may-moi-duoi-10-trieu',
      title: 'Máy mới dưới 10 triệu cho bạn những gì',
      body: (
        <>
          <P>
            Ở tầm này, máy mới nghĩa là Android tầm trung: Xiaomi cùng Redmi và POCO, Oppo, Vivo,
            Realme, Honor, hoặc Galaxy A của Samsung. Không có iPhone đời mới và cũng không có Galaxy S
            đời mới ở đây. Điểm mạnh lớn nhất của nhóm này không nằm ở thông số mà ở sự yên tâm: máy
            nguyên seal, bảo hành chính hãng 12 tháng đổi tại mọi trung tâm, pin còn nguyên vòng đời,
            không phải kiểm tra gì trước khi trả tiền.
          </P>
          <P>
            Những thứ phân khúc này làm tốt thật sự cũng chính là phần bạn chạm vào cả ngày. Pin trâu,
            vì chip tầm trung ăn ít điện và máy đủ dày để nhét viên pin lớn. Sạc nhanh, nhiều khi còn
            nhanh hơn máy cao cấp. Màn hình lớn, sáng, tần số quét cao. Camera chính chụp ban ngày rất
            khá. Với việc dùng bản đồ, nhắn tin, app ngân hàng, gọi xe và lướt mạng xã hội, khoảng cách
            với flagship nhỏ hơn nhiều so với khoảng cách về giá.
          </P>
          <P>Đổi lại, những thứ bị cắt ở tầm giá này gần như luôn giống nhau:</P>
          <Ul>
            <li>
              <strong>Mọi camera trừ camera chính.</strong> Góc siêu rộng yếu, cảm biến macro chỉ để
              ghi thêm một dòng vào bảng thông số, và không có tele dùng được. Hãy đánh giá máy tầm này
              bằng đúng camera chính.
            </li>
            <li>
              <strong>Chụp đêm và quay video.</strong> Đây là khoảng cách rõ nhất. Ảnh thiếu sáng nhòe
              và chậm, chống rung cùng dải tương phản khi quay thua flagship cũ cùng tầm tiền thấy rõ.
            </li>
            <li>
              <strong>Chống nước.</strong> Đa số chỉ ở mức chống bụi và chống văng nước, đủ cho một cơn
              mưa dọc đường chứ không phải mức ngâm nước như máy cao cấp.
            </li>
            <li>
              <strong>Thời gian hỗ trợ phần mềm.</strong> Số năm cập nhật hệ điều hành và vá bảo mật ở
              tầm trung ngắn hơn flagship và khác nhau khá nhiều giữa các hãng. Hỏi thẳng con số này
              nếu bạn định dùng máy lâu và cài app ngân hàng lên đó.
            </li>
            <li>
              <strong>Những phần ít ai nhắc.</strong> Loa đơn, mô-tơ rung rè, bộ nhớ trong tốc độ thấp
              &mdash; cái cuối biểu hiện ra ngoài thành mở app chậm hơn mức mà con số RAM gợi ý.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'may-cu-cung-tam-tien',
      title: 'Cùng số tiền đó, máy cũ mua được gì',
      body: (
        <>
          <P>
            Vẫn ngân sách ấy, thị trường máy cũ đưa cho bạn một chiếc flagship của hai đến bốn năm
            trước: iPhone đời cũ, Galaxy S đời cũ, đôi khi là Pixel. Mua máy cũ ở Việt Nam là chuyện
            bình thường, có cả hệ thống cửa hàng phân loại, test và bảo hành theo tháng, bên cạnh người
            bán cá nhân trên các sàn rao vặt như chính trang này.
          </P>
          <P>
            Thứ giữ giá trị tốt nhất theo thời gian lại đúng là thứ làm nên cảm giác máy cao cấp. Màn
            hình: tấm nền OLED của flagship ba năm trước vẫn hơn hẳn màn tầm trung mới về độ tương phản
            và độ sáng ngoài nắng. Chip: vẫn mạnh hơn mọi máy mới cùng tầm tiền, và còn kéo tốt các app
            nặng thêm vài năm nữa. Camera chính cùng khả năng xử lý ảnh thiếu sáng: đây là khác biệt
            lớn nhất, không phải hơn một chút mà hơn hẳn một bậc. Thêm loa kép, khung kim loại kính,
            chuẩn kháng nước thật và mô-tơ rung cho cảm giác chắc tay.
          </P>
          <P>
            Thứ không giữ được là pin, luôn luôn. Hãy mặc định một chiếc flagship cũ sẽ phải thay pin
            sớm và cộng luôn khoản đó vào giá mua, thay vì coi đó là rủi ro bất ngờ. Bảo hành hãng
            thường đã hết, cái còn lại là bảo hành của cửa hàng, tính bằng tháng. Và quỹ thời gian cập
            nhật phần mềm của máy đã bị tiêu mất một phần.
          </P>
          <P>
            Một lưu ý về từ ngữ giúp bạn đỡ mất tiền: các mức &ldquo;99%&rdquo; hay
            &ldquo;likenew&rdquo; mô tả ngoại hình, không mô tả bên trong. Máy đẹp long lanh vẫn có thể
            là hàng dựng. Bốn thứ thực sự hay gặp là màn hình đã thay, máy dựng từ linh kiện nhiều máy,
            máy lock còn khóa mạng, và tài khoản cũ chưa đăng xuất &mdash; còn iCloud hoặc tài khoản
            Google của người khác thì chiếc máy đó thành cục chặn giấy, và đây là kiểu mất tiền phổ
            biến nhất khi mua máy cũ.
          </P>
        </>
      ),
    },
    {
      id: 'chon-ben-nao',
      title: 'Bạn thuộc kiểu nào thì chọn bên nào',
      body: (
        <>
          <P>
            Không bên nào thắng tuyệt đối. Nói gọn: máy mới thắng ở sự chắc chắn, máy cũ thắng ở năng
            lực. Chọn theo thứ bạn đang thiếu, chứ đừng chọn theo bảng thông số.
          </P>
          <Ul>
            <li>
              <strong>Muốn mua xong là yên chuyện:</strong> máy mới. Pin nguyên vòng đời, bảo hành đổi
              được ở mọi nơi, không phải kiểm tra gì cả.
            </li>
            <li>
              <strong>Chụp ảnh nhiều, nhất là trong nhà và buổi tối:</strong> flagship cũ, hơn hẳn. Đây
              là khác biệt lớn nhất giữa hai lựa chọn.
            </li>
            <li>
              <strong>Định dùng ba đến bốn năm:</strong> máy mới. Cái bạn mua là quỹ cập nhật phần mềm
              và tuổi pin, đúng hai thứ mà máy cũ đã tiêu bớt.
            </li>
            <li>
              <strong>Hay đổi máy một đến hai năm một lần:</strong> iPhone cũ giữ giá tốt hơn Android
              tầm trung khá nhiều &mdash; máy tầm trung mất giá mạnh ngay khi hãng ra đời kế tiếp.
            </li>
            <li>
              <strong>Máy hay rơi, hay để túi quần khi chạy xe:</strong> máy mới. Linh kiện máy tầm
              trung đang bán chạy thì rẻ và ở đâu cũng có; màn hình một chiếc flagship đã ngừng sản
              xuất thì không.
            </li>
            <li>
              <strong>Mua cho bố mẹ hoặc làm máy phụ:</strong> máy mới, ưu tiên pin lớn và bảo hành rõ
              ràng hơn là camera hay chip.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'thong-so-de-danh-lua',
      title: 'Những thông số nghe kêu nhưng ít giá trị ở tầm này',
      body: (
        <>
          <P>
            Phân khúc dưới 10 triệu là nơi cuộc đua thông số diễn ra gắt nhất, vì đó là thứ dễ in lên
            biển quảng cáo nhất. Vài con số nên đọc lại cho đúng:
          </P>
          <Ul>
            <li>
              <strong>Số chấm camera.</strong> 108MP hay 200MP không nói lên chất lượng ảnh. Kích thước
              cảm biến, khẩu độ và phần xử lý mới quyết định, và ở tầm này ảnh chụp ra gần như luôn
              được gộp điểm ảnh xuống mức thấp hơn nhiều. Xem ảnh chụp thật, đừng xem con số.
            </li>
            <li>
              <strong>RAM mở rộng.</strong> Phần &ldquo;+8GB&rdquo; là bộ nhớ trong được mượn làm RAM
              ảo. Nó chậm hơn RAM thật nhiều lần và không thay thế được RAM thật.
            </li>
            <li>
              <strong>Số W sạc nhanh.</strong> Con số trên hộp là công suất đỉnh chỉ đạt trong vài phút
              đầu, với đúng củ sạc và dây đi kèm. Hỏi thời gian sạc đầy thực tế, đó mới là thứ so sánh
              được.
            </li>
            <li>
              <strong>120Hz trên tấm nền LCD.</strong> Mượt hơn thật, nhưng độ tương phản và khả năng
              nhìn ngoài nắng vẫn kém một tấm AMOLED 90Hz. Hỏi loại tấm nền trước khi hỏi tần số quét.
            </li>
            <li>
              <strong>Bộ nhớ trong.</strong> Chuẩn bộ nhớ ảnh hưởng đến tốc độ mở app và chép dữ liệu
              rõ hơn nhiều so với vài GB RAM chênh lệch, nhưng gần như không bao giờ được quảng cáo.
            </li>
            <li>
              <strong>Chống nước &ldquo;có&rdquo;.</strong> Có chuẩn kháng nước không đồng nghĩa với
              ngâm được. Hỏi đúng mức chuẩn, và nhớ là rơi nước hầu như không được bảo hành.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'mua-o-dau-kiem-tra-gi',
      title: 'Mua ở đâu và kiểm tra những gì',
      body: (
        <>
          <P>
            Mỗi kiểu nơi bán mạnh một thứ khác nhau. Chuỗi lớn cho bạn giá niêm yết đúng, chính sách
            đổi trả vài ngày đầu và bảo hành chính hãng. Cửa hàng chuyên máy cũ có test, có phân loại
            và bảo hành vài tháng. Người bán cá nhân trên sàn rao vặt rẻ nhất và không kèm gì ngoài
            chiếc máy. Nếu mua trả góp, hãy hỏi tổng số tiền phải trả đến hết kỳ chứ đừng hỏi mỗi con
            số phần trăm &mdash; tổng tiền là thứ duy nhất so sánh được giữa các gói.
          </P>
          <P>
            Với máy cũ, phần kiểm tra chính là phần quan trọng nhất của giao dịch, và một nơi không cho
            bạn kiểm tra thì đã tự trả lời rồi. Hẹn ở nơi công cộng có Wi-Fi, mang theo sạc, và dành
            đủ mười phút:
          </P>
          <Ul>
            <li>
              Đối chiếu <strong>IMEI</strong> trên máy, trên vỏ hộp và trên trang tra cứu bảo hành của
              hãng. Ba nơi phải trùng nhau.
            </li>
            <li>
              <strong>Tình trạng pin</strong>: iPhone có mục phần trăm dung lượng tối đa trong Cài đặt
              › Pin. Android phần lớn không hiện con số đó, nên hãy hỏi máy sản xuất năm nào, đã thay
              pin lần nào chưa, và để ý mức pin tụt trong lúc bạn ngồi test.
            </li>
            <li>
              Xác nhận máy đã <strong>đăng xuất iCloud hoặc tài khoản Google</strong> hoàn toàn, và tự
              tay khôi phục cài đặt gốc trước khi trả tiền nếu người bán đồng ý.
            </li>
            <li>
              Hỏi rõ <strong>máy quốc tế hay máy lock</strong>, và thử lắp SIM của bạn vào để xem sóng
              và dữ liệu di động chạy bình thường.
            </li>
            <li>
              Chụp thử tất cả camera, thử vân tay hoặc nhận diện khuôn mặt, cắm sạc, thử loa và mic, và
              mở một ảnh nền trắng rồi một ảnh nền đen để soi màn hình có ám màu, hở sáng hay điểm chết
              &mdash; dấu hiệu màn đã bị thay.
            </li>
            <li>
              Giữ <strong>phiếu bảo hành có ghi IMEI</strong>, hoặc hóa đơn nếu mua ở cửa hàng. Bảo
              hành nói miệng không tính.
            </li>
          </Ul>
          <P>
            Mức giá thật của thị trường tuần này có trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone</HereLink>, đọc thẳng từ tin rao chứ
            không phải từ bảng giá niêm yết. Phần kiểm tra máy cũ chi tiết hơn nằm ở{' '}
            <HereLink href="/kinh-nghiem-mua-iphone-cu">bài kinh nghiệm mua iPhone cũ</HereLink>, và
            các bước đó áp dụng được cho cả máy Android.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Dưới 10 triệu nên mua điện thoại gì?',
      a: 'Có hai hướng, không có một câu trả lời duy nhất. Máy mới ở tầm này là Android tầm trung của Xiaomi, Oppo, Vivo, Realme, Honor hoặc Galaxy A: pin trâu, sạc nhanh, bảo hành 12 tháng, camera chính chụp ngày tốt. Máy cũ cùng tiền là flagship hai đến bốn năm trước: màn hình, chip và chụp đêm hơn hẳn, đổi lại pin đã chai và bảo hành ngắn.',
    },
    {
      q: 'Nên mua máy mới tầm trung hay iPhone cũ trong tầm 10 triệu?',
      a: 'Nếu bạn chụp ảnh nhiều, chơi game nặng hoặc muốn cảm giác máy cao cấp thì iPhone cũ đáng hơn, và nó cũng giữ giá tốt hơn khi bán lại. Nếu bạn muốn dùng ba bốn năm, ngại kiểm tra máy hoặc cần bảo hành đổi được ở mọi nơi thì máy mới hợp hơn. Nhớ cộng tiền thay pin vào giá máy cũ trước khi so sánh.',
    },
    {
      q: 'Máy 99% hay likenew là máy như thế nào?',
      a: 'Đó là cách mô tả ngoại hình gần như không tì vết, hoàn toàn không nói gì về linh kiện bên trong. Một chiếc máy 99% vẫn có thể đã thay màn, thay pin hoặc là hàng dựng. Hãy kiểm tra IMEI ở ba nơi, soi màn hình bằng nền trắng và nền đen, thử Face ID hoặc vân tay, và mua ở nơi cho test thoải mái.',
    },
    {
      q: 'Điện thoại tầm trung dùng được mấy năm?',
      a: 'Phần cứng thường vẫn chạy được sau ba đến bốn năm, nhưng giới hạn thật nằm ở pin và ở số năm cập nhật phần mềm của hãng, vốn ngắn hơn flagship và khác nhau giữa các hãng. Hỏi cụ thể số năm cập nhật hệ điều hành và vá bảo mật trước khi mua nếu bạn định dùng lâu và cài app ngân hàng.',
    },
    {
      q: 'Mua điện thoại trả góp dưới 10 triệu có phát sinh phí gì không?',
      a: 'Thường có, và nó nằm ngoài con số phần trăm được quảng cáo: phí chuyển đổi trả góp nếu trả qua thẻ tín dụng, hoặc phí hồ sơ và bảo hiểm khoản vay nếu vay qua công ty tài chính. Cách so sánh duy nhất đáng tin là hỏi tổng số tiền phải trả đến hết kỳ rồi đặt cạnh giá mua đứt.',
    },
    {
      q: 'Mua máy cũ ở cửa hàng hay mua của người bán cá nhân?',
      a: 'Cửa hàng đắt hơn nhưng có bảo hành vài tháng, có chỗ để quay lại và thường đã test sẵn. Người bán cá nhân rẻ hơn và bạn có thể hỏi thẳng lịch sử dùng máy, nhưng không có bảo hành nào cả. Nếu bạn tự kiểm tra được máy thì mua của chính chủ rẻ hơn thấy rõ; nếu không, phần chênh lệch ở cửa hàng chính là tiền mua sự yên tâm.',
    },
    {
      q: 'Có nên mua máy xách tay dưới 10 triệu không?',
      a: 'Được, nếu cửa hàng có địa chỉ rõ ràng và bạn ở gần, vì bảo hành khi đó là của chính cửa hàng chứ không phải của hãng. Hỏi rõ máy dành cho thị trường nào: một số máy nội địa chạy bản phần mềm khác, thiếu dịch vụ Google hoặc thiếu băng tần, và đó là thứ khó sửa sau khi đã mua.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Điện thoại dưới 10 triệu nên mua máy mới hay máy cũ | ${SITE_NAME}`,
  description:
    'Dưới 10 triệu, máy mới tầm trung cho gì và cắt gì, cùng số tiền mua máy cũ được flagship đời nào, những thông số dễ đánh lừa ở phân khúc này, và checklist kiểm tra trước khi trả tiền.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function DienThoaiDuoi10TrieuPage() {
  return <SeoArticle content={CONTENT} />
}
