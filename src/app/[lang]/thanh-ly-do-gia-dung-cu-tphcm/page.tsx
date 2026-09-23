import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuideAlternates, marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * THANH LÝ ĐỒ GIA DỤNG CŨ TP.HCM — the Vietnamese half of the secondhand-furniture pair.
 *
 * ⛔ AN ORDINARY `page.tsx`, SO EVERY WORD COMPILES ON BOTH EDITIONS AND THE EDITION RULE BINDS IT.
 * Nothing here may name a visa, an itinerary or PayPal. The subject is secondhand furniture and
 * appliances in Hồ Chí Minh City — ordinary marketplace stock — which is exactly why the licensed
 * marketplace may publish it.
 *
 * ⚠️ WHY THIS PAGE CAN WIN THE QUERY. Page one for "thanh lý đồ gia dụng cũ TPHCM" is currently all
 * BUYERS — shops whose business is acquiring stock cheaply and reselling it. Their incentive is to
 * talk the seller's expectation down, so none of them publishes a price band. Ours does, from the
 * 3.201 live HCMC listings measured 2026-09-23, and it is checkable: the reader can open the
 * category and see the same listings.
 *
 * ⚠️ THE PRICE FIGURES ARE THE MEASURED ASKING PRICES OF LIVE LISTINGS (n=300 sample, 2026-09-23) —
 * not sold prices, and the prose says so. Do not "refresh" a number here from memory or from a
 * competitor's page; re-measure /api/listings or leave it alone.
 *
 * ⚠️ THE USED STOCK IS DEALER-SUPPLIED — 3 distinct sellers in a 40-item sample. It must never be
 * described as departing residents' moving sales, which is the flattering story and is false.
 */
const SLUG = 'thanh-ly-do-gia-dung-cu-tphcm'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua bán',
  h1: 'Thanh lý đồ gia dụng cũ TP.HCM: giá thật và cách kiểm tra',
  intro:
    'Riêng ở TP.HCM, sàn này đang có 3.201 tin bán đồ gia dụng và nội thất cũ, nên việc khó không phải là tìm hàng mà là biết món đó đáng bao nhiêu và có còn chạy được không. Bài này đưa ra khoảng giá lấy từ các tin đang rao tại TP.HCM, cách kiểm tra máy lạnh, máy giặt, sofa và tủ trong vài phút, cách thanh lý gọn khi chuyển nhà, và lý do một cửa hàng thu mua sẽ không bao giờ trả bạn đúng mức giá mà chính họ rao lại.',
  canonical: `/${SLUG}`,
  published: '2026-09-23',
  lang: 'vi',
  alternate: { lang: 'en', href: '/secondhand-furniture-ho-chi-minh-city' },
  sections: [
    {
      id: 'gia-that-tung-mon',
      title: 'Giá thật của từng món, đo từ tin đang rao',
      body: (
        <>
          <P>
            Các con số dưới đây là giá rao của những tin đang hoạt động tại TP.HCM trên sàn này, đo
            ngày 23/09/2026 trên mẫu 300 tin. Đây là giá rao, không phải giá chốt &mdash; giá chốt
            thường thấp hơn một chút sau khi mặc cả. Nhưng đó là mốc tham chiếu duy nhất bạn kiểm
            chứng được bằng chính mắt mình: mở danh mục lên là thấy đúng những tin đó.
          </P>
          <Ul>
            <li>
              <strong>Toàn nhóm đồ gia dụng &amp; nội thất cũ:</strong> trung vị 2.480.000 đ. Nửa giữa
              thị trường nằm trong khoảng 1.050.000 đ &ndash; 4.100.000 đ.
            </li>
            <li>
              <strong>Máy lạnh:</strong> trung vị 4.298.000 đ, khoảng giữa 3.948.000 &ndash; 5.498.000 đ.
              Đây là dải giá hẹp nhất trong tất cả các nhóm &mdash; mức p25 chỉ cách trung vị khoảng
              350.000 đ &mdash; nghĩa là mặt bằng đã rất chuẩn hóa. Ai chào thấp hơn hẳn thì luôn có
              một lý do, và bạn nên tìm ra lý do đó trước khi trả tiền.
            </li>
            <li>
              <strong>Máy giặt:</strong> trung vị 2.730.000 đ, khoảng giữa 1.648.000 &ndash; 3.480.000 đ.
              Dải rộng vì nhóm này gộp cả cửa trên lẫn cửa ngang, máy nhỏ lẫn máy lớn. So giá trong
              cùng kiểu máy và cùng khối lượng giặt, đừng so với trung vị chung.
            </li>
            <li>
              <strong>Sofa:</strong> trung vị 2.515.000 đ, khoảng giữa 1.390.000 &ndash; 4.510.000 đ.
            </li>
            <li>
              <strong>Tủ quần áo:</strong> trung vị 6.200.000 đ, khoảng giữa 3.980.000 &ndash; 7.800.000 đ.
              Món đắt nhất trong nhà, và cũng là món mà một quyết định sai tốn kém nhất &mdash; xem phần
              đo lối đi bên dưới.
            </li>
            <li>
              <strong>Bàn, bàn làm việc:</strong> trung vị 1.650.000 đ, khoảng giữa 1.050.000 &ndash; 3.200.000 đ.
            </li>
            <li>
              <strong>Kệ, tủ nhỏ:</strong> trung vị 1.980.000 đ, khoảng giữa 1.180.000 &ndash; 3.380.000 đ.
            </li>
            <li>
              <strong>Máy lọc không khí 6.000.000 đ, robot hút bụi 9.000.000 đ.</strong> Mỗi nhóm chỉ có
              6 tin trong mẫu, nên hãy đọc như mức tham khảo chứ chưa đủ để gọi là mặt bằng giá.
            </li>
          </Ul>
          <P>
            Cách dùng ba con số này rất đơn giản. Trung vị là mức bạn nên mong đợi cho một món bình
            thường, còn chạy tốt. Dưới mốc p25 thì hoặc là món đó thực sự cần đi gấp &mdash; đáng chạy
            đi xem ngay &mdash; hoặc là có một khuyết điểm người bán chưa nói. Trên mốc p75 thì người
            bán phải giải thích được vì sao: còn phiếu bảo hành, mới mua vài tháng, hoặc hàng chưa qua
            sử dụng. &ldquo;Hàng hiệu&rdquo; không phải là một lời giải thích.
          </P>
        </>
      ),
    },
    {
      id: 'kiem-tra-truoc-khi-tra-tien',
      title: 'Kiểm tra trước khi trả tiền, theo từng món',
      body: (
        <>
          <P>
            Nguyên tắc chung: yêu cầu được xem món hàng đang chạy, tại chỗ nó đang nằm, cắm vào ổ điện
            thật. Người bán không cho cắm điện thử là đã trả lời bạn rồi. Và hãy chốt ai tháo, ai chở,
            lên tầng mấy, có thang máy không &mdash; chốt trước khi chốt giá, vì đó là khoản hay làm
            hỏng một món hời.
          </P>
          <Ul>
            <li>
              <strong>Máy lạnh.</strong> Bật ít nhất 15 phút rồi đưa tay vào cửa gió: gió phải lạnh rõ
              rệt so với nhiệt độ phòng. Chỉ mát nhẹ thì gần như chắc chắn thiếu gas hoặc dàn lạnh quá
              bẩn. Ra xem cục nóng: rung mạnh, kêu lộc cộc hoặc chân đế han gỉ đều là tiền sửa. Hỏi rõ
              máy mấy ngựa và đối chiếu với diện tích phòng &mdash; thợ thường tính 1 HP cho phòng dưới
              khoảng 15 m², mua thiếu công suất thì máy chạy suốt ngày mà không đủ lạnh. Cuối cùng,
              tiền tháo lắp, vệ sinh, nạp gas và ống đồng mới là một khoản RIÊNG, không nằm trong
              giá rao: hỏi báo giá trước, vì nó có thể xóa sạch phần chênh lệch mà bạn tưởng mình
              đã tiết kiệm được.
            </li>
            <li>
              <strong>Máy giặt.</strong> Chạy trọn một chu trình ngắn từ đầu đến cuối, đừng chỉ bật
              nguồn. Đứng nghe lúc vắt &mdash; đó là lúc bạc đạn mòn lên tiếng, và với máy cửa ngang cũ
              thì tiền thay bạc đạn gần bằng giá trị còn lại của máy. Xem gầm máy có vệt nước, xoay
              lồng bằng tay xem có rơ, kiểm tra gioăng cửa cao su có rách hay mốc đen. Hỏi thẳng bo
              mạch đã thay chưa.
            </li>
            <li>
              <strong>Sofa.</strong> Ngồi mạnh xuống cả hai góc và chính giữa: khung kêu răng rắc là
              mộng đã lỏng. Lật lên soi khung gỗ tìm mối mọt và vệt ẩm. Phân biệt da thật với simili
              &mdash; simili cũ bong thành mảng và không có cách sửa nào rẻ. Mút đã xẹp thì bọc lại gần
              bằng tiền mua một cái khác trong khoảng 1.390.000 &ndash; 4.510.000 đ, nên hãy tính đó là
              lý do để trả giá, chứ đừng tính là việc sẽ làm sau.
            </li>
            <li>
              <strong>Tủ quần áo, kệ, tủ bếp.</strong> Đo ba thứ TRƯỚC khi đi xem: chiều cao trần nhà,
              chiều rộng lối cầu thang và cửa thang máy. Tủ liền khối cao 2,4 m không qua được chiếu
              nghỉ cầu thang, và đó là lúc người ta mất luôn 6.200.000 đ. Hỏi tủ có tháo rời được không.
              Tại chỗ: soi chân tủ và lưng tủ tìm vết phồng &mdash; gỗ công nghiệp gặp ẩm là phồng và
              không bao giờ trở lại; thử toàn bộ bản lề và ray trượt.
            </li>
            <li>
              <strong>Máy lọc không khí và robot hút bụi.</strong> Câu hỏi quyết định không phải là máy
              có chạy không, mà là còn mua được lõi lọc, chổi và pin thay thế cho model đó không. Một
              con robot 9.000.000 đ mà hãng đã ngừng bán pin thì vài tháng nữa giá trị thật của nó bằng
              không. Bắt người bán đọc đúng mã model và tự tra trước khi chuyển tiền.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'thanh-ly-khi-chuyen-nha',
      title: 'Thanh lý khi chuyển nhà: làm theo thứ tự này',
      body: (
        <>
          <P>
            Sai lầm phổ biến nhất là bắt đầu quá muộn. Đến khi còn hai ngày là trả nhà thì bạn không
            còn bán, bạn đang nhờ người ta chở đi giúp &mdash; và giá phản ánh đúng điều đó. Bắt đầu
            trước ba đến bốn tuần thì bạn mới có quyền từ chối một lời trả giá thấp.
          </P>
          <Ul>
            <li>
              <strong>Tách lô, đừng bán xô.</strong> Cả căn bán một cục thì chỉ có cửa hàng thu mua
              mua, vì chỉ họ mới có kho. Tách từng món thì người dùng cuối mua, và họ trả cao hơn hẳn
              vì họ mua để dùng chứ không mua để bán lại.
            </li>
            <li>
              <strong>Định giá bằng tin đang rao, không bằng giá bạn đã mua.</strong> Tra các tin cùng
              loại, lấy trung vị làm mốc. Món còn tốt, đủ phụ kiện thì rao quanh trung vị. Cần đi trong
              một tuần thì rao dưới mốc p25 và nói thẳng lý do trong mô tả &mdash; giá thấp kèm lý do
              rõ ràng bán nhanh hơn giá thấp không giải thích, vì người mua luôn tự nghĩ ra lý do tệ
              hơn sự thật.
            </li>
            <li>
              <strong>Chụp cả khuyết điểm.</strong> Chụp ban ngày, dọn nền, và chụp luôn vết xước.
              Người mua phát hiện lỗi tại chỗ sẽ ép giá; người mua đã thấy lỗi đó trong ảnh thì đến là
              để lấy hàng.
            </li>
            <li>
              <strong>Viết đủ những thứ người mua sẽ hỏi:</strong> kích thước dài &times; rộng &times;
              cao, năm mua, còn bảo hành không, tháo rời được không, nhà ở tầng mấy và có thang máy
              không. Thiếu kích thước là lý do số một khiến một tin đồ nội thất không ai nhắn.
            </li>
            <li>
              <strong>Ghi hạn chót thật.</strong> &ldquo;Cần dọn trước ngày 30&rdquo; là một áp lực
              thời gian có thật và người mua hiểu ngay. Đừng bịa hạn chót: bạn sẽ phải giữ lời.
            </li>
            <li>
              <strong>Nhận tiền trước khi hàng rời nhà.</strong> Chuyển khoản xong mới cho khiêng.
              Chụp ảnh món hàng lúc bàn giao. Không giữ đồ cho ai bằng lời hứa miệng.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'ban-xo-hay-tu-dang',
      title: 'Bán xô cho cửa hàng thu mua, hay tự đăng bán?',
      body: (
        <>
          <P>
            Hầu hết kết quả bạn thấy khi tìm &ldquo;thanh lý đồ gia dụng cũ TPHCM&rdquo; là trang của
            các cửa hàng thu mua. Cần nói rõ họ đứng ở phía nào: họ là NGƯỜI MUA. Việc kinh doanh của
            họ là mua vào thấp và bán ra ở đúng dải giá ghi trong bài này. Chênh lệch giữa hai con số
            đó là lợi nhuận của họ, và nó phải đủ lớn để bù tiền xe, kho bãi, vệ sinh, sửa chữa và
            thời gian nằm kho. Không có gì sai trái ở đây &mdash; nhưng nó có nghĩa là con số họ trả
            bạn không bao giờ là con số họ rao lại.
          </P>
          <P>
            Khi bán xô cả lô, bạn còn trả giá cho một thứ nữa: phần đồ bỏ đi. Họ báo một giá cho cả
            căn, gồm cả cái tủ lạnh còn chạy tốt lẫn ba cái ghế nhựa gãy chân, và mức giá đó bị kéo
            xuống bởi những món họ biết sẽ phải vứt. Nói cách khác, món tốt của bạn đang gánh phí xử
            lý rác cho món hỏng của bạn.
          </P>
          <P>
            Nhưng tự đăng bán không phải lúc nào cũng thắng, và một bài viết trung thực phải nói cả
            phần này. Gọi thu mua là đúng khi: bạn còn dưới 48 giờ, không có ai ở nhà để dẫn khách xem
            trong tuần, hoặc món hàng cồng kềnh mà giá bán lẻ thấp hơn tiền thuê xe chở. Cách dung hòa
            mà những người chuyển nhà nhiều lần hay dùng: tự rao năm món đắt nhất &mdash; tủ quần áo,
            máy lạnh, máy giặt, sofa, tủ lạnh &mdash; vì chỉ riêng chúng đã chiếm phần lớn giá trị, rồi
            gọi cửa hàng thu mua đến hốt phần còn lại trong một chuyến.
          </P>
        </>
      ),
    },
    {
      id: 'nguon-hang-o-dau',
      title: 'Nguồn hàng đang nằm ở đâu, và đó là giá gì',
      body: (
        <>
          <P>
            Trên sàn này hiện có 3.201 tin đồ gia dụng và nội thất cũ, trong tổng số 98.754 tin đang
            hoạt động. Toàn bộ 100 tin trong mẫu kiểm tra đều ở TP.HCM, nên với người ở thành phố này
            thì gần như mọi tin bạn thấy đều là hàng lấy được trong ngày. Điểm khởi đầu là danh mục{' '}
            <HereLink href="/c/furniture-appliances">đồ gia dụng &amp; nội thất</HereLink>; đồ điện tử
            cũ như TV, laptop, màn hình nằm ở nhóm riêng với 3.507 tin, và nếu bạn đang chuyển nhà thì{' '}
            <HereLink href="/c/rentals">mục cho thuê</HereLink> có 19.359 tin, tất cả đều ở TP.HCM.
          </P>
          <P>
            Một điều nên biết về nguồn hàng, vì nó thay đổi cách bạn mặc cả: phần lớn hàng cũ đang rao
            đến từ người bán chuyên &mdash; trong mẫu 40 tin chỉ có 3 người bán khác nhau. Nghĩa là
            mức giá bạn thấy là GIÁ BÁN LẺ của người trong nghề, không phải giá của một gia đình cần
            dọn nhà gấp. Vừa là tin xấu, vừa là tin tốt: ít có món hời bất ngờ, nhưng đổi lại
            dải giá rất ổn định và dùng làm mốc tham chiếu thì đáng tin. Khi chính bạn rao một món cần
            đi trong tuần, bạn đang cạnh tranh với những người không vội &mdash; đó là lợi thế của bạn,
            và cách khai thác nó là rao dưới mốc p25 rồi nói rõ vì sao.
          </P>
          <P>
            Mỗi người bán đều có điểm uy tín công khai, nên một tài khoản chưa có lịch sử nào sẽ hiện
            ra đúng như vậy trước khi bạn chạy xe qua nửa thành phố. Muốn tự bán, hãy{' '}
            <HereLink href="/post">đăng tin</HereLink> kèm kích thước và ảnh chụp cả khuyết điểm; tin
            nào đủ thông tin thì phần mặc cả diễn ra qua tin nhắn chứ không diễn ra ở cửa nhà bạn.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept(SLUG),
  faqs: [
    {
      q: 'Thanh lý đồ gia dụng cũ ở TP.HCM được giá bao nhiêu?',
      a: 'Đo trên các tin đang rao tại TP.HCM (mẫu 300 tin, 23/09/2026): trung vị toàn nhóm là 2.480.000 đ, nửa giữa thị trường nằm trong khoảng 1.050.000 đ đến 4.100.000 đ. Đây là giá rao chứ không phải giá chốt, nên hãy dùng làm mốc rồi trừ đi phần mặc cả.',
    },
    {
      q: 'Máy lạnh cũ giá bao nhiêu là hợp lý?',
      a: 'Trung vị 4.298.000 đ, khoảng giữa 3.948.000 đến 5.498.000 đ — dải giá hẹp nhất trong các nhóm, nên một máy rẻ hơn hẳn luôn có lý do cần hỏi cho ra. Nhớ cộng thêm tiền tháo lắp, vệ sinh, nạp gas và ống đồng mới, vì đó là khoản riêng và đủ sức xóa hết phần tiết kiệm.',
    },
    {
      q: 'Nên bán cho cửa hàng thu mua hay tự đăng tin?',
      a: 'Cửa hàng thu mua là người mua: họ mua vào để bán lại ở đúng dải giá thị trường, nên giá họ trả luôn thấp hơn giá họ rao, và khi bán xô thì món tốt của bạn còn gánh luôn phần đồ bỏ đi. Tự rao được giá cao hơn nhưng cần ba đến bốn tuần. Cách dung hòa: tự bán năm món đắt nhất, gọi thu mua hốt phần còn lại.',
    },
    {
      q: 'Mua máy giặt cũ cần kiểm tra gì?',
      a: 'Chạy trọn một chu trình ngắn và đứng nghe lúc vắt, vì đó là lúc bạc đạn mòn lên tiếng — với máy cửa ngang cũ, tiền thay bạc đạn gần bằng giá trị còn lại của máy. Xem thêm vệt nước dưới gầm, độ rơ của lồng khi xoay tay, gioăng cửa cao su có mốc hoặc rách không, và hỏi bo mạch đã thay chưa.',
    },
    {
      q: 'Mua tủ quần áo cũ có rủi ro gì?',
      a: 'Rủi ro lớn nhất không phải chất lượng mà là kích thước: đo chiều cao trần, lối cầu thang và cửa thang máy trước khi đi xem, và hỏi tủ có tháo rời được không — một cái tủ trung vị 6.200.000 đ không qua được chiếu nghỉ cầu thang là mất trắng. Tại chỗ thì soi chân và lưng tủ tìm vết phồng do ẩm, rồi thử hết bản lề và ray trượt.',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Thanh lý đồ gia dụng cũ TP.HCM: giá thật và cách kiểm tra | ${SITE_NAME}`,
  description:
    'Khoảng giá thật của máy lạnh, máy giặt, sofa, tủ quần áo cũ tại TP.HCM đo từ tin đang rao; cách kiểm tra trước khi trả tiền; và vì sao cửa hàng thu mua không bao giờ trả bạn mức giá họ rao lại.',
  alternates: marketplaceGuideAlternates(SLUG),
  openGraph: {
    title: `Thanh lý đồ gia dụng cũ TP.HCM: giá thật và cách kiểm tra | ${SITE_NAME}`,
    description:
      'Trung vị 2.480.000 đ cho đồ gia dụng cũ tại TP.HCM — giá từng món, cách kiểm tra máy lạnh và máy giặt trong vài phút, và cách thanh lý khi chuyển nhà mà không bán hớ.',
  },
}

export default function ThanhLyDoGiaDungCuTphcmPage() {
  return <SeoArticle content={CONTENT} />
}
