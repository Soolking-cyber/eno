import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { marketplaceGuidesExcept } from '@/lib/expat-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * ĐỒ CŨ CỦA NGƯỜI NƯỚC NGOÀI — the Vietnamese navigational page for "trang web thanh lý đồ cũ của
 * người nước ngoài". The searcher is a Vietnamese buyer DESCRIBING this marketplace and asking
 * Google to find it; the only competitor on the query is a muaban.net blog post with no stock
 * behind it. We are the stock, so the page's job is to be the destination, not an essay.
 *
 * ⛔ AN ORDINARY `page.tsx`, SO EVERY WORD COMPILES ON BOTH EDITIONS. Nothing here may name a visa,
 * an itinerary or PayPal — the three surfaces the licensed marketplace may not advertise. The
 * subject is secondhand furniture and appliances, which is why it can live on eno.vn at all. The
 * reason foreigners sell up is written as "hết hợp đồng thuê / về nước", never as a permit status.
 *
 * ⛔ THE HONEST-INVENTORY PARAGRAPH IN §2 IS LOAD-BEARING AND MUST NOT BE "TIDIED AWAY". Measured
 * 2026-09-23 from /api/listings: the 3.201 used furniture-appliances listings are DEALER-SUPPLIED —
 * a 40-item sample held only 3 distinct sellers. Writing "mỗi tin là một gia đình nước ngoài sắp
 * bay" would rank better and be false, and the first buyer who clicks a seller profile sees it. The
 * page therefore explains the phenomenon (why a departing foreigner's things are worth buying) AND
 * says plainly what is actually listed here, plus how to tell the two apart in thirty seconds.
 * That distinction is also the best advice on the page: a kho thanh lý has no moving-out deadline,
 * so the bargaining position is completely different.
 *
 * ⚠️ EVERY PRICE IS A MEASURED MEDIAN/QUARTILE FROM THE LIVE FEED (n=300 sampled, 2026-09-23), with
 * the sample size beside the thin ones. Do not add a number that was not measured, and do not round
 * these into "khoảng 4 triệu" — the point of the section is that it is checkable.
 *
 * ⛔ FOUR UNMEASURED CLAIMS WERE REMOVED ON 2026-09-23 AND MUST NOT COME BACK. Each read as a fact
 * and none of them was ever measured: "hợp đồng một đến hai năm" and "mới dùng một đến ba năm"
 * (invented durations), "một phần ba đến một nửa giá mới" (an invented saving — we hold no new-price
 * data at all, so the page now tells the reader to look the model up), and "còn tám mươi tin nữa"
 * (n=87 is the SAMPLE, not a live count). The air-purifier/robot-vacuum bullet also claimed those
 * were "hai món người nước ngoài hay mua rồi để lại" — attribution to expat moving sales, which the
 * seller sample refutes. The trust numbers (60 / 85 / 110 / 90 ngày) are NOT from the feed and are
 * deliberately kept: they are product mechanics, verified against src/lib/trust-math.ts (BASE 60,
 * TRUSTED_SCORE 85, EXCEPTIONAL_SCORE 110, REVIEW_PAIR_DEDUP_DAYS 90) and stated the same way on
 * /trust. The score is recomputed from source tables on events, so do not write "tính lại mỗi ngày".
 *
 * ⚠️ IN-BODY LINKS STAY IN VIETNAMESE. `/moving-sales-vietnam` was linked here from a Vietnamese
 * sentence and is an ENGLISH article; it is now `/c/moving-sale` (a category, language-neutral) plus
 * the Vietnamese sibling `/thanh-ly-do-gia-dung-cu-tphcm`. See the `related` note below — the block
 * itself still cannot honour that rule from this file.
 *
 * ⚠️ `related` USES marketplaceGuidesExcept() and that helper NEVER CROSSES LANGUAGES: it filters on
 * the guide's registered `lang`. Until this slug is wired into MARKETPLACE_GUIDES with `lang: 'vi'`
 * (done centrally, not from this file), it falls back to treating the caller as English and returns
 * the English siblings.
 */
const SLUG = 'do-cu-cua-nguoi-nuoc-ngoai'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Thanh lý đồ cũ của người nước ngoài: mua ở đâu và trả bao nhiêu là đúng',
  intro:
    'Đồ của người nước ngoài sắp rời Việt Nam nổi tiếng là mua được: dùng kỹ, còn tốt và bán gấp vì có ngày trả nhà. Bài này nói rõ vì sao nhóm đồ đó đáng mua, rồi nói thẳng một chuyện ít nơi nào chịu nói: phần lớn tin đồ gia dụng và nội thất cũ đang đăng trên eno.vn là của các nhà bán chuyên ở TP.HCM chứ không phải của chính chủ sắp bay, và cách phân biệt nằm ngay trên tin. Phần còn lại là giá thật của từng món theo chính các tin đang đăng, cách đọc điểm uy tín người bán, và cách hẹn xem rồi nhận hàng mà không mất tiền oan.',
  canonical: `/${SLUG}`,
  published: '2026-09-23',
  lang: 'vi',
  sections: [
    {
      id: 'vi-sao-do-nay-dang-mua',
      title: 'Vì sao đồ của người nước ngoài thường còn tốt mà bán rẻ',
      body: (
        <>
          <P>
            Người nước ngoài sống ở đây thường thuê nhà theo hợp đồng có thời hạn. Hết hợp đồng,
            chuyển công tác hoặc về nước, toàn bộ đồ đạc phải đi theo — mà một chiếc tủ lạnh hay bộ
            sofa thì cước vận chuyển về nước còn đắt hơn mua mới ở bên đó. Nên mỗi món chỉ có ba cửa:
            bán lại, cho, hoặc bỏ. Đó cũng là lý do nhóm đồ này có tiếng là còn tốt: người bán mua về
            để chính mình dùng trong một hợp đồng thuê ngắn chứ không phải để mua đi bán lại, và đồ
            nằm trong căn hộ kín có máy lạnh chứ không phơi ngoài mặt bằng ẩm.
          </P>
          <P>
            Thứ hai là chuyện thời gian, và nó làm việc thay bạn. Người bán có một hạn chót thật —
            ngày bàn giao nhà cho chủ — nên bộ đồ được định giá để bán hết, không phải để bán được
            giá. Càng sát ngày dọn, giá càng mềm, và người bán càng dễ gật đầu với đề nghị lấy nguyên
            lô. Đây là khác biệt lớn nhất so với mua đồ cũ ở một cửa hàng: cửa hàng không có ngày nào
            phải dọn sạch kho cả.
          </P>
          <P>
            Đổi lại, có ba thứ bạn gần như luôn phải tự lo. Tính hết vào giá trước khi trả, vì đây
            chính là chỗ cái giá rẻ bốc hơi:
          </P>
          <Ul>
            <li>
              <strong>Không bảo hành, không đổi trả.</strong> Mua xong là xong. Món nào hỏng sau một
              tuần thì đó là tiền của bạn, nên món nào không cho thử tại chỗ thì phải trả giá như thể
              nó không chạy.
            </li>
            <li>
              <strong>Không giao hàng.</strong> Tháo lắp máy lạnh, xe tải, người khiêng, thang máy hay
              cầu thang bộ — bên mua lo hết. Một cái tủ quần áo gỗ ở tầng năm không thang máy là một
              khoản tiền thật và là chỗ hay vỡ kế hoạch nhất.
            </li>
            <li>
              <strong>Nhiều khi phải lấy cả lô.</strong> Người bán cần dọn sạch phòng, không cần bán
              lẻ từng món. Đó là lúc giá tốt nhất xuất hiện — và cũng là lúc bạn rước về hai món không
              dùng đến, rồi mất thêm tiền chở chúng đi.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'tim-o-dau-tren-eno',
      title: 'Tìm ở đâu trên eno.vn — và ai thật sự đang bán',
      body: (
        <>
          <P>
            Đo ngày 23/09/2026, sàn đang có 98.754 tin hiển thị. Phần liên quan đến bài này nằm gọn
            trong ba mục. Mục{' '}
            <HereLink href="/c/furniture-appliances">đồ gia dụng và nội thất</HereLink> có 3.201 tin
            hàng cũ, và trong 100 tin lấy mẫu thì cả 100 đều ở TP.HCM — nên nếu bạn ở tỉnh khác, hãy
            coi đây là hàng phải tự vào Sài Gòn lấy hoặc thuê xe gửi về. Mục{' '}
            <HereLink href="/c/electronics">đồ điện tử</HereLink> có 3.507 tin hàng cũ, là chỗ của
            tivi, màn hình, loa và máy chơi game. Mục{' '}
            <HereLink href="/c/moving-sale">thanh lý dọn nhà</HereLink> gom riêng các đợt bán cả căn,
            còn nếu bạn chỉ quan tâm hàng gia dụng ở TP.HCM thì có bài{' '}
            <HereLink href="/thanh-ly-do-gia-dung-cu-tphcm">
              thanh lý đồ gia dụng cũ TP.HCM
            </HereLink>{' '}
            đi sâu vào đúng nhóm đó. Nếu bạn vừa thuê được nhà trống, 19.359 tin ở mục{' '}
            <HereLink href="/c/rentals">cho thuê</HereLink> đều nằm trong các quận nội thành TP.HCM,
            tức nguồn đồ và nguồn nhà đang ở cùng một thành phố với nhau.
          </P>
          <P>
            Và đây là điều không trang nào khác nói thẳng: không phải mỗi tin ở đây là một gia đình
            nước ngoài sắp bay. Trong 40 tin lấy mẫu ở mục đồ gia dụng cũ chỉ có 3 người bán khác
            nhau — nghĩa là phần lớn hàng đang do các nhà bán chuyên gom và thanh lý đồ cũ ở TP.HCM
            đăng, chứ không phải chính chủ. Chuyện đó không xấu, thậm chí có lợi: kho có sẵn hàng để
            xem một lần mấy chục món, có xe giao, có người tháo lắp, đôi khi còn bảo hành vài tháng
            cho hàng điện máy. Nhưng nó đổi hẳn thế trả giá của bạn. Người bán chuyên biết chính xác
            món đó đáng bao nhiêu và không có ngày nào phải dọn sạch nhà, nên đừng kỳ vọng mức giảm
            kiểu bán tháo — chỗ mặc cả nằm ở việc gom nhiều món, ở tiền vận chuyển, và ở thời gian
            bảo hành chứ không phải ở con số trên tin.
          </P>
          <P>
            Cách phân biệt mất ba mươi giây: bấm vào tên người bán ngay trên tin. Một tài khoản đang
            đăng vài chục đến vài trăm món, ảnh chụp cùng một phông nền kho, mô tả viết theo mẫu — đó
            là nhà bán chuyên. Một tài khoản có hai đến năm tin, ảnh chụp trong căn hộ với mỗi món một
            góc phòng khác nhau, mô tả ghi rõ ngày phải dọn — đó là chính chủ, và đó là tin đáng nhắn
            trước tiên nếu bạn muốn giá của người đang vội.
          </P>
        </>
      ),
    },
    {
      id: 'gia-thuc-te',
      title: 'Giá thật của từng món, theo chính các tin đang đăng',
      body: (
        <>
          <P>
            Số dưới đây đo ngày 23/09/2026 từ 300 tin đồ gia dụng cũ đang hiển thị trên sàn, không
            phải giá tham khảo của cửa hàng. Mức trung vị chung là 2.480.000 đ, và một nửa số tin nằm
            trong khoảng 1.050.000 đ đến 4.100.000 đ. Nói cách khác: đây không phải chỗ bán đồ vài
            trăm nghìn, mà là chỗ mua món tử tế ở tầm vài triệu. Muốn biết mình tiết kiệm được bao
            nhiêu thì tra giá máy mới đúng model rồi tự trừ, đừng tin một tỉ lệ chung chung.
          </P>
          <Ul>
            <li>
              <strong>Máy lạnh</strong> — trung vị 4.298.000 đ, phần lớn nằm trong 3.948.000 đ đến
              5.498.000 đ (24 tin). Dải này hẹp bất thường, nên một tin rẻ hơn hẳn đáng ngờ. Nhớ cộng
              tiền tháo ở nhà cũ, tiền lắp ở nhà bạn và tiền ống đồng mới nếu khoảng cách dàn nóng
              khác đi — hỏi số đó trước khi chốt giá máy.
            </li>
            <li>
              <strong>Máy giặt</strong> — 2.730.000 đ, khoảng phổ biến 1.648.000 đ đến 3.480.000 đ (10
              tin). Chênh lệch chủ yếu là cửa trên hay cửa ngang và có inverter hay không.
            </li>
            <li>
              <strong>Sofa</strong> — 2.515.000 đ, dải rộng 1.390.000 đ đến 4.510.000 đ (12 tin), vì
              một bộ nỉ hai chỗ và một bộ da chữ L là hai thứ khác nhau hoàn toàn. Đo cửa và thang máy
              trước khi trả tiền, đây là món hay không lọt nhất.
            </li>
            <li>
              <strong>Tủ quần áo</strong> — 6.200.000 đ, khoảng 3.980.000 đ đến 7.800.000 đ (13 tin).
              Món đắt nhất trong danh sách và cũng là món tiết kiệm nhiều nhất khi mua cũ, vì gỗ không
              hỏng đi khi nằm trong phòng người khác.
            </li>
            <li>
              <strong>Bàn các loại</strong> — 1.650.000 đ, khoảng 1.050.000 đ đến 3.200.000 đ (87
              tin). Đây là nhóm có nhiều tin nhất trong mẫu, nên cứ kén: không ưng tin này thì còn
              nhiều tin khác cùng tầm giá.
            </li>
            <li>
              <strong>Kệ và tủ</strong> — 1.980.000 đ, khoảng 1.180.000 đ đến 3.380.000 đ (37 tin).
            </li>
            <li>
              <strong>Máy lọc không khí</strong> 6.000.000 đ và <strong>robot hút bụi</strong>{' '}
              9.000.000 đ — mỗi nhóm chỉ có 6 tin, nên đọc như một điểm tham chiếu chứ chưa phải mặt
              bằng giá. Với cỡ mẫu đó, một tin lệch hẳn cũng đủ kéo con số đi, nên hãy so thêm với
              giá máy mới cùng model trước khi trả.
            </li>
          </Ul>
          <P>
            Dùng mấy con số này theo hai chiều. Một tin thấp hơn hẳn mức dưới của dải thì hoặc là hàng
            lỗi, hoặc là giá mồi để bạn gọi điện rồi nghe câu &ldquo;món đó bán rồi, còn món này&rdquo;
            — hỏi ngay một câu duy nhất: cho xem chạy tại chỗ được không. Ngược lại, một món cũ mà giá
            chạm mức máy mới cùng loại thì không có lý do gì để mua cũ: mở một trang bán lẻ, xem giá
            máy mới cùng model, rồi trừ đi phần bảo hành mà bạn đang từ bỏ.
          </P>
        </>
      ),
    },
    {
      id: 'doc-diem-uy-tin',
      title: 'Đọc điểm uy tín người bán trước khi đi xem',
      body: (
        <>
          <P>
            Mỗi tài khoản trên eno.vn có một điểm uy tín công khai, hiện ngay cạnh tên người bán và
            được tính lại từ dữ liệu thật: giao dịch đã hoàn tất, đánh giá của người mua và báo cáo
            vi phạm đã được xác nhận. Mọi tài khoản bắt đầu ở 60 — đó là trạng thái chưa có thành tích, không
            phải cảnh báo. Từ 85 trở lên là tài khoản đã xác minh và đã có giao dịch hoàn tất, từ 110
            trở lên là người bán có lịch sử dài và trả lời nhanh đã được đo, còn dưới 60 nghĩa là đã
            có lỗi nghiêm trọng hoặc lặp lại được xác nhận. Cách đọc thực dụng: 60 không đáng sợ, dưới
            60 thì đừng đi.
          </P>
          <P>
            Điểm này khó đánh bóng, và chỗ khó chính là chỗ đáng tin. Chỉ người mua đã hoàn tất giao
            dịch qua khung chat của sàn mới đánh giá được, mỗi người tính một lần trong 90 ngày, và
            đánh giá từ tài khoản mới tinh gần như không có trọng lượng — nên vài tài khoản ảo không
            kéo ai lên được, cũng không dìm được đối thủ. Ngược lại, một lỗi lừa đảo đã xác nhận thì
            không tự phai theo thời gian mà chỉ giảm dần sau khi người bán làm xong một số giao dịch
            sạch mới. Chi tiết đầy đủ nằm ở trang <HereLink href="/trust">cách tính uy tín</HereLink>.
          </P>
          <P>
            Ba thứ nên xem cùng lúc với điểm số, vì chúng nói thêm thứ điểm số không nói: tài khoản đã
            xác minh số điện thoại chưa, đang đăng bao nhiêu tin, và tin được đăng lại bao nhiêu lần.
            Một món &ldquo;dọn nhà gấp&rdquo; được đăng đi đăng lại suốt ba tháng thì không gấp, và
            cũng không phải đồ của ai sắp bay cả.
          </P>
        </>
      ),
    },
    {
      id: 'hen-xem-va-nhan-hang',
      title: 'Hẹn xem, thử tại chỗ và nhận hàng',
      body: (
        <>
          <P>
            Nhắn ngay trong khung chat của sàn và giữ nguyên ở đó: toàn bộ thỏa thuận về giá, ngày
            giao và ai chịu tiền xe nằm lại trong lịch sử tin nhắn, và đó cũng là thứ bộ phận hỗ trợ
            đọc được nếu có tranh chấp. Ba câu nên hỏi trước khi chạy tới nơi: địa chỉ ở quận nào và
            tầng mấy, có thang máy không, và bật máy sẵn giúp trước khi tôi tới được không.
          </P>
          <Ul>
            <li>
              <strong>Máy lạnh:</strong> yêu cầu bật trước khi bạn đến khoảng mười lăm phút. Gió ra
              phải lạnh sâu chứ không chỉ mát, dàn nóng chạy êm, và hỏi lần vệ sinh gần nhất là khi
              nào. Nhìn luôn vị trí dàn nóng: một cái máy rẻ nhưng treo ở chỗ thợ không với tới sẽ ăn
              hết phần tiết kiệm trong hai lần bảo dưỡng.
            </li>
            <li>
              <strong>Máy giặt:</strong> chạy trọn một chu trình ngắn từ đầu đến cuối. Nghe kỹ lúc
              vắt, vì đó là lúc bạc đạn mòn tự khai, và nhìn gầm máy xem có vết nước loang.
            </li>
            <li>
              <strong>Tủ lạnh:</strong> phải lạnh sẵn khi bạn tới, chứ không phải vừa cắm điện lúc bạn
              bước vào. Kẹp một tờ giấy vào gioăng cửa kéo thử quanh bốn cạnh, và ngửi bên trong — mùi
              mốc thì không bao giờ hết.
            </li>
            <li>
              <strong>Sofa và nệm:</strong> ngồi thử cả hai đầu xem có lún lệch, lật lớp lót dưới, và
              ngửi. Riêng nệm thì lời khuyên thẳng là mua mới; đó là món duy nhất trong nhà mà tiền
              tiết kiệm được không đáng.
            </li>
            <li>
              <strong>Tủ, kệ, bàn gỗ:</strong> nhấc một góc lên. Gỗ thịt nặng và mộng còn chặt; gỗ công
              nghiệp nhẹ, và một cạnh đã nở vì ẩm thì không về lại được. Đo chiều cao tủ so với trần
              và độ rộng cửa phòng trước khi chốt.
            </li>
          </Ul>
          <P>
            Chuyện tiền thì đơn giản: trả khi nhận hàng tận nơi, sau khi đã cắm điện thử lần nữa ở
            nhà mình với những món có thể thử. Không chuyển cọc giữ hàng cho người lạ, kể cả khi lý do
            nghe rất hợp lý và nhất là khi người bán giục — đó là kịch bản lừa phổ biến nhất trong
            nhóm hàng này. Nếu buộc phải cọc vì món đắt và ở xa, cọc một phần nhỏ, chuyển vào tài
            khoản trùng tên với chủ tài khoản đang bán, và giữ ảnh chụp màn hình. Các dấu hiệu còn lại
            nằm ở trang <HereLink href="/safety">an toàn giao dịch</HereLink>, và mọi tin có mùi đều
            báo cáo được ngay trên tin đó.
          </P>
        </>
      ),
    },
  ],
  related: marketplaceGuidesExcept(SLUG),
  faqs: [
    {
      q: 'Đồ thanh lý của người nước ngoài có thật sự rẻ hơn đồ cũ thường không?',
      a: 'Rẻ hơn khi bạn mua đúng của chính chủ sắp dọn đi, vì người đó có hạn chót trả nhà nên định giá để bán hết chứ không phải để bán được giá. Nhưng phần lớn tin đồ gia dụng cũ trên sàn là của các nhà bán chuyên ở TP.HCM, mà kho thì không có ngày nào phải dọn sạch — giá ở đó đã là giá thị trường. Đổi lại, mua của chính chủ thì không bảo hành, không giao hàng và nhiều khi phải lấy cả lô: cộng tiền xe, tiền tháo lắp và những món bạn không dùng vào trước khi so sánh.',
    },
    {
      q: 'Hàng trên eno.vn có đúng là của người nước ngoài không?',
      a: 'Một phần. Đo ngày 23/09/2026: mục đồ gia dụng cũ có 3.201 tin, tất cả 100 tin lấy mẫu đều ở TP.HCM, nhưng trong 40 tin lấy mẫu chỉ có 3 người bán khác nhau — tức phần lớn do các nhà bán chuyên thanh lý đồ cũ ở TP.HCM đăng chứ không phải chính chủ. Bấm vào tên người bán để biết mình đang nói chuyện với ai: vài chục tin cùng phông nền là kho thanh lý, hai đến năm tin chụp trong căn hộ là chính chủ.',
    },
    {
      q: 'Máy lạnh cũ mua khoảng bao nhiêu là hợp lý?',
      a: 'Theo 24 tin đang đăng, trung vị là 4.298.000 đ và phần lớn nằm trong khoảng 3.948.000 đ đến 5.498.000 đ. Con số đó chưa gồm tiền tháo ở nhà cũ, tiền lắp ở nhà bạn và ống đồng nếu phải thay — hỏi rõ ba khoản này trước khi chốt, vì chúng đủ sức xóa hết phần chênh lệch so với máy mới giá thấp.',
    },
    {
      q: 'Có nên chuyển khoản đặt cọc giữ hàng không?',
      a: 'Không, trừ khi món đắt và bạn ở xa. Nguyên tắc là trả khi nhận, sau khi thử lại tại nhà. Nếu buộc phải cọc thì cọc một phần nhỏ, chuyển vào tài khoản ngân hàng trùng tên với người đang bán, giữ toàn bộ thỏa thuận trong khung chat của sàn và chụp màn hình lại. Người bán giục cọc gấp là dấu hiệu nên dừng, không phải dấu hiệu hàng đắt khách.',
    },
    {
      q: 'Mua xong thì ai lo vận chuyển và tháo lắp?',
      a: 'Mặc định là bên mua, và đó là khoản hay bị quên nhất. Chốt trước ba thứ ngay trong tin nhắn: ai tháo, ai chở, và hàng đang ở tầng mấy có thang máy hay không. Nhà bán chuyên thường có sẵn xe và thợ nên báo được giá trọn gói; chính chủ thì hầu như không, nên hãy tự gọi xe trước khi hẹn ngày lấy.',
    },
  ],
}

export const revalidate = 3600

export const metadata: Metadata = {
  title: `Thanh lý đồ cũ của người nước ngoài: mua ở đâu, giá bao nhiêu | ${SITE_NAME}`,
  description:
    'Đồ gia dụng và nội thất cũ ở TP.HCM trên eno.vn: giá thật của máy lạnh, máy giặt, sofa và tủ theo chính các tin đang đăng, cách biết mình đang mua của nhà bán chuyên hay của chính chủ dọn nhà, cách đọc điểm uy tín người bán và cách nhận hàng an toàn.',
  alternates: { canonical: `/${SLUG}` },
  openGraph: {
    title: `Thanh lý đồ cũ của người nước ngoài: mua ở đâu, giá bao nhiêu | ${SITE_NAME}`,
    description:
      'Máy lạnh cũ trung vị 4.298.000 đ, tủ quần áo 6.200.000 đ, sofa 2.515.000 đ — số đo từ chính các tin đang đăng ở TP.HCM, kèm cách thử tại chỗ trước khi trả tiền.',
  },
}

export default function DoCuCuaNguoiNuocNgoaiPage() {
  return <SeoArticle content={CONTENT} />
}
