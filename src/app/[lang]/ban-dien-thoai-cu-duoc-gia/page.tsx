import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * BÁN ĐIỆN THOẠI CŨ ĐƯỢC GIÁ — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and the pair diverges on purpose. The English half at
 * /selling-your-phone-vietnam spends its length on what a foreign seller cannot assume — that an
 * imported LL/A handset is worth less here than a VN/A one, that an English-only listing shrinks the
 * audience, that erasing a phone while still signed in to iCloud becomes an international problem
 * once they have flown home. A Vietnamese seller knows all of that already and is asking different
 * questions: is ký gửi better than bán đứt, how does a shop decide máy còn zin or đã bung, how do I
 * not get ép giá on my own listing, and how does the fake transfer-confirmation scam actually run.
 * Translating either page would answer the wrong questions in both languages.
 *
 * ⛔ KHÔNG CÓ GIÁ CỤ THỂ TRONG BÀI. Prices go stale; the live figures live on /iphone-18-vietnam,
 * which reads the marketplace's own listings. No shop is named as the best place to sell, either.
 */
const SLUG = 'ban-dien-thoai-cu-duoc-gia'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang bán lại',
  h1: 'Bán điện thoại cũ được giá',
  intro:
    'Cùng một chiếc máy, bốn kênh bán cho ra bốn con số khác hẳn nhau — và phần lớn khoảng chênh đó không đến từ tài trả giá, mà từ việc bạn chọn kênh nào, máy còn zin đến đâu, xóa tài khoản có đúng cách không, và bán vào tuần nào. Bài này đi qua đủ bốn thứ đó.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/selling-your-phone-vietnam' },
  sections: [
    {
      id: 'bon-cach-ban',
      title: 'Bốn cách bán và khoảng chênh thật sự',
      body: (
        <>
          <P>
            <strong>Thu cũ đổi mới tại chuỗi</strong> nhanh nhất và thường trả thấp nhất. Mang máy
            đến, kỹ thuật chấm tình trạng trong khoảng mười phút, giá máy cũ trừ thẳng vào máy mới mua
            ngay tại đó. Bẫy nằm ở chỗ con số trợ giá trông hấp dẫn thường gắn với giá máy mới của
            chính chuỗi đó. Hãy so <strong>tổng số tiền phải bù</strong>, đừng so con số trợ giá: trợ
            giá cao trên một máy mới bán đúng giá niêm yết hoàn toàn có thể tệ hơn trợ giá thấp trên
            một máy đang giảm.
          </P>
          <P>
            <strong>Bán đứt cho cửa hàng máy cũ</strong> lấy tiền ngay, không ràng buộc phải mua gì.
            Đổi lại là một lần kiểm tra rất kỹ và một con số ít thương lượng được, vì cửa hàng phải
            tính cả phần lãi, phần bảo hành họ cam kết với người mua sau và chi phí tân trang nếu có.
            Thường nhỉnh hơn thu cũ đổi mới và thấp hơn rõ so với bán trực tiếp.
          </P>
          <P>
            <strong>Ký gửi</strong> là lựa chọn hay bị bỏ qua: cửa hàng bán hộ và ăn hoa hồng, bạn
            được giá gần với giá bán lẻ máy cũ mà không phải gặp ai. Đổi lại là thời gian không xác
            định. Chỉ ký gửi ở nơi có địa chỉ rõ ràng và có giấy ký gửi ghi <strong>IMEI</strong>, tình
            trạng máy, mức giá sàn và thời hạn &mdash; không có giấy thì không có gì để đối chiếu khi
            máy &ldquo;đang cho khách xem&rdquo; suốt ba tuần.
          </P>
          <P>
            <strong>Bán trực tiếp cho người dùng cuối</strong> trên sàn rao vặt được giá cao nhất, vì
            bạn đang tự làm phần việc mà cửa hàng vốn được trả tiền để làm: chụp ảnh, trả lời cùng ba
            câu hỏi mấy chục lần, hẹn gặp, ngồi chờ người ta kiểm tra máy. Với máy tầm trung, khoản
            chênh nhiều khi không bõ vài buổi tối; với flagship đời gần thì gần như luôn bõ.
          </P>
        </>
      ),
    },
    {
      id: 'may-duoc-cham-diem-the-nao',
      title: 'Máy của bạn được chấm điểm theo đúng danh sách này',
      body: (
        <>
          <P>
            Bán cho cửa hàng hay bán cho người dùng thì danh sách soi máy gần như giống nhau. Biết
            trước danh sách này có giá trị hơn mọi mẹo trả giá, vì nó cho bạn biết nên sửa cái gì
            trước khi đăng tin và nên chủ động khai cái gì.
          </P>
          <Ul>
            <li>
              <strong>Tình trạng pin</strong> là con số ai cũng hỏi đầu tiên. Trên 90% là điểm cộng;
              dưới 80% máy bắt đầu hiện cảnh báo bảo dưỡng và người mua trừ thẳng tiền thay pin. Nếu
              máy đang sát mốc đó, cân nhắc{' '}
              <HereLink href="/thay-pin-iphone-o-dau">thay pin trước khi bán</HereLink> &mdash; nhưng
              chỉ pin chính hãng mới được trả tiền, pin ngoài thường làm tụt hạng máy chứ không nâng.
            </li>
            <li>
              <strong>Còn zin hay đã bung.</strong> Cài đặt › Cài đặt chung › Giới thiệu có mục lịch
              sử linh kiện và dịch vụ; màn hình hay pin thay ngoài hệ thống hiện ở đó và không xóa
              được. Khai trước trong tin đăng vẫn hơn để người mua phát hiện lúc gặp mặt &mdash; mất
              cả khách lẫn buổi hẹn.
            </li>
            <li>
              <strong>Màn hình:</strong> ám vàng, ám xanh, hở sáng viền, điểm chết, lưu ảnh. Đây là
              thứ bị soi kỹ nhất vì sửa đắt nhất, nên chủ động chụp nền trắng và nền đen đưa vào tin
              đăng.
            </li>
            <li>
              <strong>Ngoại hình:</strong> móp góc bị trừ nặng hơn xước lưng, vì móp góc là dấu hiệu
              máy từng rơi và người mua sẽ nghi cả phần bên trong. Cong máy và hở khe là hai thứ
              khiến cửa hàng hạ hẳn một bậc.
            </li>
            <li>
              <strong>VN/A hay xách tay, và bảo hành còn lại.</strong> Ghi rõ ngày kích hoạt thay vì
              &ldquo;còn bảo hành&rdquo;: người mua tra được trên trang của Apple trong nửa phút, và
              một con số tra được luôn bán tốt hơn một lời hứa.
            </li>
            <li>
              <strong>Đủ hộp, IMEI trên hộp khớp với máy.</strong> Hộp đầy đủ có giá trị thật với
              người mua tính bán lại sau này; sợi cáp kèm theo thì gần như không.
            </li>
          </Ul>
          <P>
            Những thứ gần như không ảnh hưởng: màu máy, ốp tặng kèm, cường lực đã dán. Dung lượng có
            ảnh hưởng, nhưng phần chênh giữa các mức dung lượng khi bán lại nhỏ hơn phần chênh lúc mua
            máy mới. Muốn biết mặt bằng tuần này, xem{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>, đọc trực tiếp từ tin
            rao thật chứ không phải từ thông cáo.
          </P>
        </>
      ),
    },
    {
      id: 'xoa-du-lieu-va-huy-lien-ket',
      title: 'Xóa dữ liệu và hủy liên kết trước khi giao máy',
      body: (
        <>
          <P>
            Giao dịch đổ vỡ ngay tại chỗ hẹn thường không phải vì giá, mà vì một lỗi duy nhất: máy đã
            xóa nhưng chưa đăng xuất iCloud. Người mua bật lên gặp màn hình khóa kích hoạt, và không
            ai mở được &mdash; không cửa hàng nào, không dịch vụ nào. Máy dính iCloud gần như không
            bán được, và mọi lời chào &ldquo;mở được iCloud&rdquo; đều nên hiểu là chuyện khác.
          </P>
          <P>Thứ tự quan trọng hơn từng bước. Trên iPhone:</P>
          <Ul>
            <li>Sao lưu trước, và kiểm tra bản sao lưu đã chạy xong thật.</li>
            <li>
              <strong>Chuyển eSIM sang máy mới trước tiên.</strong> Xóa eSIM khỏi máy cũ mà chưa
              chuyển thường đồng nghĩa với việc phải ra nhà mạng xin cấp lại.
            </li>
            <li>Hủy ghép Apple Watch, phải làm từ chiếc iPhone còn đang đăng nhập.</li>
            <li>
              <strong>Hủy đăng ký thiết bị trong từng app ngân hàng, ví điện tử, app chữ ký số</strong>{' '}
              &mdash; vào trong app để hủy chứ không phải chỉ gỡ app. Nhiều app gắn với cả thiết bị
              lẫn số điện thoại, đăng ký lại từ máy khác có khi phải ra quầy.
            </li>
            <li>
              Đăng xuất iCloud: Cài đặt › [tên bạn] › Đăng xuất. Đây mới là bước gỡ khóa kích hoạt.
              Sau đó mới Cài đặt › Cài đặt chung › Chuyển hoặc Đặt lại iPhone › Xóa tất cả nội dung và
              cài đặt.
            </li>
            <li>
              Cuối cùng, kiểm tra máy đã biến mất khỏi danh sách thiết bị trong tài khoản Apple của
              bạn. Còn nằm trong danh sách thì vẫn khóa lại được, và người mua biết điều đó.
            </li>
          </Ul>
          <P>
            Máy Android tương tự, thêm một bẫy: xóa tài khoản Google rồi khôi phục cài đặt gốc là
            xong phần của Google, nhưng máy Samsung còn một lớp khóa kích hoạt riêng gắn với tài khoản
            Samsung, phải tắt tách bạch. Dù máy nào, hãy xóa{' '}
            <strong>ngay trước mặt người mua</strong> và để họ tự vào đến màn hình chính bằng Wi-Fi
            trước khi tiền chuyển đi. Mất bốn phút, và đó là bằng chứng duy nhất cả hai bên cần.
          </P>
        </>
      ),
    },
    {
      id: 'gap-mat-va-nhan-tien',
      title: 'Gặp mặt và nhận tiền',
      body: (
        <>
          <P>
            Hẹn chỗ đông người, có wifi và ổ cắm: quán cà phê chuỗi, sảnh trung tâm thương mại. Người
            mua đề nghị ra cửa hàng nhờ kỹ thuật kiểm tra là chuyện bình thường, không phải xúc
            phạm: họ trả phí kiểm tra, còn bạn bán nhanh hơn vì máy đã có bên thứ ba xác nhận.
          </P>
          <P>
            Ghi lại IMEI trước khi đi và kiểm đúng con số đó ngay trước lúc giao máy lần cuối. Chiêu
            tráo máy cũ nhất thị trường là cầm máy bước ra vài bước &ldquo;ra chỗ sáng soi màn&rdquo;
            rồi đưa lại một chiếc khác cùng màu.
          </P>
          <Ul>
            <li>
              <strong>Chỉ tin số dư trong app ngân hàng của chính bạn.</strong> Ảnh chụp màn hình
              &ldquo;đã chuyển thành công&rdquo; làm giả trong ba mươi giây. Chuyển khoản trong nước
              về gần như tức thì, nên câu &ldquo;liên ngân hàng hôm nay chậm&rdquo; đúng vào lúc giao
              máy là một kịch bản quen thuộc &mdash; cứ ngồi chờ đến khi có báo có.
            </li>
            <li>
              <strong>Không ship COD</strong> máy giá trị cao cho người lạ: bom hàng thì mất công, bị
              tráo máy lúc đồng kiểm thì mất máy.
            </li>
            <li>
              Nhận cọc giữ máy cũng phải chờ báo có. Cọc xong mà đòi bạn gửi máy đi trước là dấu hiệu
              đủ rõ để dừng lại.
            </li>
            <li>
              Giữ toàn bộ trao đổi trong hệ thống tin nhắn của sàn. Khi có tranh chấp, đó là thứ duy
              nhất đối chiếu được.
            </li>
            <li>Giao hộp và giấy tờ sau cùng, khi tiền đã thực sự về tài khoản.</li>
          </Ul>
        </>
      ),
    },
    {
      id: 'ban-vao-luc-nao',
      title: 'Bán vào lúc nào thì đỡ mất giá nhất',
      body: (
        <>
          <P>
            Thứ đắt nhất trong cả quá trình không phải kỹ năng trả giá mà là cái lịch. Giá máy cũ của
            một đời máy tụt theo bậc quanh thời điểm đời kế tiếp ra mắt, và mức giảm đó lan ngược
            xuống toàn bộ các đời cũ hơn trong mấy tuần sau. Nếu đằng nào cũng định lên đời, hãy bán{' '}
            <strong>trước</strong> khi máy mới công bố, đừng đợi đến lúc hàng đã về cửa hàng.
          </P>
          <P>
            Hai chu kỳ nhỏ hơn cũng đáng biết. Nhu cầu mua máy cũ thường mạnh nhất vào mấy tuần trước
            Tết, khi thưởng cuối năm về và người ta mua máy làm quà, rồi chùng xuống rõ rệt trong
            tháng sau Tết. Mùa tựu trường cuối hè là cửa sổ thứ hai, nhẹ hơn.
          </P>
          <P>
            Mốc 80% pin là một cái bậc chứ không phải đường dốc: máy báo 81% là máy dùng tốt, cũng
            chiếc đó ở 79% là máy đang bị hệ điều hành nhắc thay pin. Pin đang ở khoảng tám mươi hai,
            tám mươi ba mà còn chần chừ vài tháng thì thực chất là đang chọn bán ở phía bên kia của
            cái bậc đó.
          </P>
          <P>
            Cuối cùng là chi phí của việc để đó. Máy không dùng vẫn mất giá đều mỗi tháng, và với
            flagship đời gần, khoảng chênh giữa bán ngay tuần bạn đổi máy và bán sau sáu tháng thường
            lớn hơn cả khoảng chênh giữa thu cũ đổi mới và bán trực tiếp. Người mua sẽ soi máy của bạn
            đúng như{' '}
            <HereLink href="/kinh-nghiem-mua-iphone-cu">bài kinh nghiệm mua iPhone cũ</HereLink> mô
            tả &mdash; đọc trước một lượt là cách chuẩn bị nhanh nhất.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Bán điện thoại cũ ở đâu được giá nhất?',
      a: 'Bán trực tiếp cho người dùng cuối trên sàn rao vặt cho giá cao nhất, sau đó là ký gửi tại cửa hàng máy cũ, rồi bán đứt cho cửa hàng, thấp nhất là thu cũ đổi mới. Đổi lại theo đúng thứ tự đó là thời gian và công sức: bán trực tiếp mất vài buổi hẹn, còn thu cũ đổi mới xong trong mười phút.',
    },
    {
      q: 'Thu cũ đổi mới hay bán ngoài lợi hơn?',
      a: 'Bán ngoài lợi hơn nếu bạn có thời gian, nhất là với máy flagship đời gần. Thu cũ đổi mới thắng ở tốc độ và sự chắc chắn. Khi so sánh, hãy so tổng số tiền phải bù để cầm máy mới về, đừng so con số trợ giá — trợ giá cao thường đi kèm giá máy mới không giảm.',
    },
    {
      q: 'Pin bao nhiêu phần trăm thì bán vẫn được giá?',
      a: 'Trên 90% là điểm cộng rõ. Từ 85% đến 90% vẫn bán bình thường. Dưới 80% máy hiện cảnh báo bảo dưỡng và người mua trừ thẳng tiền thay pin, nên khoảng rơi qua mốc đó lớn hơn hai phần trăm nghe có vẻ. Nếu định thay pin cho được giá thì phải là pin chính hãng, pin ngoài thường bị trừ ngược.',
    },
    {
      q: 'Bán iPhone cũ có cần hộp không?',
      a: 'Không bắt buộc, nhưng hộp đầy đủ và IMEI trên hộp khớp với máy làm tăng giá thật, vì giúp người mua bán lại dễ hơn về sau. Cáp sạc trong hộp thì gần như không cộng thêm gì. Mất hộp mà máy zin, IMEI khớp, ngày kích hoạt tra được thì vẫn bán tốt.',
    },
    {
      q: 'Nhận tiền trước hay xóa máy trước?',
      a: '⚠️ Thống nhất cách xác nhận tiền TRƯỚC khi xóa máy. Nếu ứng dụng ngân hàng và mã OTP của bạn nằm trên chính chiếc máy đang bán, xóa trước nghĩa là bạn không còn cách nào kiểm tra tiền đã vào hay chưa — và ảnh chụp màn hình "đã chuyển" là chiêu cũ nhất ở thị trường này. Hoặc nhận tiền mặt, hoặc mang theo máy thứ hai đã đăng ký ngân hàng, xem tiền vào rồi mới xóa.',
    },
    {
      q: 'Xóa iCloud trước hay xóa máy trước khi bán?',
      a: 'Đăng xuất iCloud trước, xóa máy sau. Cài đặt › [tên bạn] › Đăng xuất, rồi mới Cài đặt › Cài đặt chung › Chuyển hoặc Đặt lại iPhone › Xóa tất cả nội dung và cài đặt. Làm ngược lại thì máy sạch dữ liệu nhưng vẫn dính khóa kích hoạt, và không cửa hàng nào mở được.',
    },
    {
      q: 'Bán điện thoại nhận chuyển khoản sao cho an toàn?',
      a: 'Chỉ giao máy khi tiền đã báo có trong app ngân hàng của chính bạn, không nhận ảnh chụp màn hình làm bằng chứng. Chuyển khoản trong nước về gần như tức thì, nên lý do “liên ngân hàng chậm” ngay lúc giao máy là dấu hiệu cần dừng. Hẹn ở chỗ đông người và giữ trao đổi trong tin nhắn của sàn.',
    },
    {
      q: 'Nên bán điện thoại cũ vào thời điểm nào?',
      a: 'Trước khi đời máy kế tiếp ra mắt, vì giá máy cũ tụt theo bậc ngay sau đó và lan xuống các đời cũ hơn. Mấy tuần trước Tết là lúc nhu cầu mạnh nhất; tháng sau Tết là lúc chậm nhất. Và đừng để máy nằm trong ngăn kéo — mỗi tháng để đó đều mất giá.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Bán điện thoại cũ được giá — thu cũ đổi mới hay bán ngoài | ${SITE_NAME}`,
  description:
    'Bốn cách bán máy cũ và khoảng chênh thật sự, cửa hàng chấm điểm máy theo những gì, cách xóa dữ liệu và hủy liên kết trước khi giao máy, cách nhận tiền an toàn và nên bán vào lúc nào.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function BanDienThoaiCuDuocGiaPage() {
  return <SeoArticle content={CONTENT} />
}
