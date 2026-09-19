import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * MUA SAMSUNG GALAXY DÒNG NÀO — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and the two articles deliberately answer different questions. The
 * English page spends its length on what a foreigner cannot assume: what the letter in front of the
 * number means at all, that a passport is enough, that a Samsung Vietnam warranty is a Vietnam
 * warranty and not a global one. A Vietnamese reader knows all of that on arrival and is arguing
 * about something else entirely — an older S against a newer A at the same money, whether máy Hàn is
 * worth the shutter sound, Exynos against Snapdragon on a given generation, and which month of the
 * year the real discount lands. Machine-translating either page would answer the wrong questions in
 * both languages.
 *
 * ⚠️ KHÔNG CÓ GIÁ TRONG BÀI. Giá Galaxy rớt nhanh hơn iPhone — đó chính là một mục của bài này — nên
 * mọi con số viết ra đều sai sau một quý. Giá thực đọc từ tin rao của chính sàn, qua link trong bài.
 *
 * ⛔ KHÔNG XẾP HẠNG CỬA HÀNG NÀO LÀ "UY TÍN NHẤT". Sàn có niêm yết nhiều nhà bán lẻ trong số đó và có
 * doanh thu tiếp thị liên kết từ một vài nơi, nên một bảng xếp hạng ở đây là quảng cáo đội lốt bài
 * viết. Mô tả từng KIỂU cửa hàng giỏi việc gì mới là phiên bản trung thực.
 */
const SLUG = 'mua-samsung-galaxy-dong-nao'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Mua Samsung Galaxy dòng nào',
  intro:
    'Chữ cái đứng trước con số mới là thứ quyết định chiếc máy, không phải con số. Bài này phân biệt bốn dòng S, A, M và Z, giải thích vì sao giá Samsung tại Việt Nam giảm sâu hơn giá iPhone, trả lời câu hỏi kinh điển “S đời cũ hay A đời mới”, và chỉ cách kiểm tra máy ngay tại quầy.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/samsung-galaxy-buying-guide-vietnam' },
  sections: [
    {
      id: 'bon-dong-galaxy',
      title: 'S, A, M, Z và cả FE khác nhau ở đâu',
      body: (
        <>
          <P>
            <strong>Galaxy S</strong> là dòng cao cấp: chip mạnh nhất trong năm, cụm camera tốt nhất,
            màn hình sáng nhất và cam kết cập nhật phần mềm dài nhất trong các máy Android bán tại
            Việt Nam. Bản <strong>Ultra</strong> là bản to nhất, có bút S Pen tích hợp và ống tele
            zoom xa nhất. Bản thường và bản <strong>Plus</strong> chủ yếu khác nhau ở kích thước màn
            hình và dung lượng pin, không khác nhiều về sức mạnh.
          </P>
          <P>
            <strong>Galaxy S FE</strong> là bản &ldquo;Fan Edition&rdquo;, dùng lại nhiều linh kiện
            của dòng S đời trước trong một thân máy đơn giản hơn. Đây là cách rẻ nhất để chạm vào
            trải nghiệm dòng S, và thường đáng mua hơn một máy tầm trung mới ra cùng tầm tiền.
          </P>
          <P>
            <strong>Galaxy A</strong> là dòng tầm trung, và xét về số lượng bán ra thì đây mới là thứ
            người Việt thực sự mua. Trong dòng A, con số chính là phân khúc: A0x là phổ thông, A1x và
            A2x là tầm thấp, A3x và A5x là tầm trung trên với màn hình tử tế, camera dùng được và
            vài năm vá bảo mật. Khoảng cách giữa A2x và A5x lớn hơn nhiều so với khoảng cách giữa A5x
            và một máy dòng S.
          </P>
          <P>
            <strong>Galaxy M</strong> gần như là dòng A bán qua kênh online: pin lớn hơn, giá gọn
            hơn, đổi lại ít khuyến mãi tại cửa hàng, ít quà kèm và ít chỗ để cầm máy lên thử trước
            khi mua.
          </P>
          <P>
            <strong>Galaxy Z</strong> là dòng máy gập &mdash; <strong>Z Fold</strong> mở ra như quyển
            sách, <strong>Z Flip</strong> gập đôi máy thường. Đây là một quyết định riêng với bài toán
            độ bền và chi phí sửa riêng, nói kỹ trong{' '}
            <HereLink href="/dien-thoai-gap-nen-mua-loai-nao">bài về điện thoại gập</HereLink>.
          </P>
          <P>
            Một lưu ý hay bị suy diễn sai: chip trên dòng S không giống nhau ở mọi thị trường. Có đời
            bán tại Việt Nam dùng Exynos trong khi bản ở thị trường khác dùng Snapdragon, có đời thì
            dùng chung một loại. Chuyện này thay đổi theo từng thế hệ &mdash; hãy tra đúng đời máy
            định mua thay vì suy từ đời trước.
          </P>
        </>
      ),
    },
    {
      id: 'vi-sao-giam-gia-sau',
      title: 'Vì sao giá Samsung giảm sâu hơn iPhone tại Việt Nam',
      body: (
        <>
          <P>
            Ai theo dõi cả hai hãng đều thấy cùng một hiện tượng: flagship Samsung rẻ đi rõ rệt chỉ
            sau vài tháng, còn iPhone hạ giá chậm và giữ phần lớn giá trị cho tới khi đời mới ra. Có
            bốn lý do, và không lý do nào là ngẫu nhiên.
          </P>
          <Ul>
            <li>
              <strong>Samsung lắp ráp điện thoại ngay tại Việt Nam với quy mô rất lớn.</strong> Nguồn
              hàng dồi dào, linh kiện sẵn, trung tâm bảo hành phủ tới cả tỉnh nhỏ. Điều này không làm
              giá niêm yết thấp đi &mdash; máy bán trong nước vẫn chịu VAT và đủ chi phí phân phối
              &mdash; nhưng nó xóa bỏ sự khan hiếm vốn là thứ giữ giá.
            </li>
            <li>
              <strong>Android cao cấp được định giá theo kiểu khuyến mãi.</strong> Trợ giá thu cũ đổi
              mới, quà tặng kèm, ưu đãi đặt trước và các đợt hạ giá theo lịch là một phần của cách
              bán hàng. Apple hạ giá chủ yếu qua phần lợi nhuận của nhà bán lẻ, một cái cần gạt hẹp
              hơn nhiều.
            </li>
            <li>
              <strong>Thị trường máy cũ trả giá cho iPhone cao hơn.</strong> Nhu cầu rộng hơn, số đời
              máy ít hơn, ai cũng nhận ra model chỉ bằng mắt. Galaxy cũ bán vào một thị trường mỏng
              hơn, và giá máy cũ yếu thì kéo luôn giá máy mới xuống khi cửa hàng xả hàng trước đời
              kế tiếp.
            </li>
            <li>
              <strong>Samsung bán nhiều dòng cùng lúc.</strong> Mỗi đợt A mới đẩy đợt A cũ xuống, và
              một bản FE ra giữa chu kỳ thì cắt ngay vào giá của chính dòng S mà nó mượn linh kiện.
            </li>
          </Ul>
          <P>
            Hệ quả thực tế: ba đến sáu tháng đầu sau khi ra mắt là khoảng thời gian đắt nhất để mua
            một chiếc flagship Samsung, và chiếc máy mua sau đó vẫn là đúng chiếc máy ấy. Nếu bạn
            đang so sánh hai hãng chứ không so hai model, giá phía Apple hôm nay có trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>, đọc trực tiếp từ tin
            rao của các nhà bán lẻ, còn{' '}
            <HereLink href="/nen-mua-iphone-hay-samsung">bài nên mua iPhone hay Samsung</HereLink> so
            giá bán lại và hệ thống bảo hành cạnh nhau.
          </P>
        </>
      ),
    },
    {
      id: 'chon-dong-nao-cho-ai',
      title: 'Dòng nào hợp với ai, và “S đời cũ hay A đời mới”',
      body: (
        <>
          <Ul>
            <li>
              <strong>Giữ máy bốn đến năm năm, chụp ảnh nhiều:</strong> dòng S. Lý do là thời gian được
              cập nhật, không phải bảng thông số &mdash; một chiếc máy hết được vá bảo mật mà vẫn cài
              app ngân hàng là chuyện nên tránh.
            </li>
            <li>
              <strong>Muốn gần bằng flagship với số tiền thấp hơn nhiều:</strong> bản FE, hoặc dòng S
              đời trước. Cả hai thường đáng tiền hơn một máy tầm trung mới ra cùng giá.
            </li>
            <li>
              <strong>Máy để dùng hằng ngày</strong> &mdash; ngân hàng, Zalo, bản đồ, gọi xe, chụp
              ảnh con: dòng A tầm trung trên. Đây là điểm rơi hợp lý nhất của cả dải sản phẩm và cũng
              là mức mà nhiều người tiêu quá tay đi qua.
            </li>
            <li>
              <strong>Ưu tiên pin và quen mua online:</strong> dòng M, chấp nhận việc ít được hỗ trợ
              tại cửa hàng như một phần của thỏa thuận.
            </li>
            <li>
              <strong>Định bán lại sau khoảng một năm:</strong> tính đường ra trước khi tính đường
              vào. Galaxy mất giá nhanh hơn iPhone, nên hoặc mua dòng thấp hơn, hoặc mua máy đã qua
              một đời để người chủ trước chịu phần rớt giá.{' '}
              <HereLink href="/ban-dien-thoai-cu-duoc-gia">Bài bán điện thoại cũ được giá</HereLink>{' '}
              nói rõ thứ gì thật sự làm tăng giá.
            </li>
          </Ul>
          <P>
            Còn câu hỏi hay gặp nhất: cùng một số tiền, nên lấy máy dòng S đời trước hay máy dòng A
            đời mới? Máy S đời trước thường hơn hẳn ở chip, camera và chất lượng màn hình &mdash;
            những thứ không thể nâng cấp bằng phần mềm. Máy A đời mới hơn ở thời gian còn được cập
            nhật, pin còn mới nguyên và bảo hành còn đủ. Nếu bạn đổi máy hai ba năm một lần thì chọn
            bên hiệu năng; nếu bạn dùng tới khi máy không còn nhận cập nhật thì chọn bên tuổi thọ
            phần mềm.
          </P>
        </>
      ),
    },
    {
      id: 'may-han-may-xach-tay',
      title: 'Máy Hàn, máy Mỹ và hàng xách tay',
      body: (
        <>
          <P>
            Galaxy xách tay từ Hàn Quốc hoặc Mỹ rẻ hơn máy chính hãng một khoản đáng kể, và với một
            số người đó là món hời thật. Nhưng phải biết mình đổi cái gì lấy cái gì.
          </P>
          <Ul>
            <li>
              <strong>Bảo hành.</strong> Bảo hành Samsung gắn theo IMEI và theo thị trường máy được
              phân phối, nên máy xách tay không được trung tâm bảo hành chính hãng tại Việt Nam nhận.
              Người bảo hành là chính cửa hàng đã bán, trong đúng thời gian họ cam kết và chỉ ở đó.
            </li>
            <li>
              <strong>Tiếng chụp ảnh trên máy Hàn.</strong> Máy bán tại Hàn Quốc luôn phát tiếng khi
              chụp và không tắt được bằng cài đặt &mdash; đó là quy định của thị trường đó, không
              phải lỗi máy. Nếu bạn hay chụp trong phòng họp hay nơi yên tĩnh, đây là thứ gây khó
              chịu hằng ngày chứ không phải chi tiết nhỏ.
            </li>
            <li>
              <strong>Máy khóa mạng.</strong> Máy còn khóa theo nhà mạng nước ngoài cần kiểm tra kỹ
              trước khi trả tiền; máy quốc tế thì không vướng chuyện này.
            </li>
          </Ul>
          <P>
            Cách xác minh máy thuộc thị trường nào: bấm <strong>*#1234#</strong> để xem phiên bản
            firmware, trong đó có mã vùng. Máy phân phối cho thị trường Việt Nam chạy firmware Việt
            Nam, máy Hàn hay máy Mỹ thì không. Mã này do firmware quyết định chứ không phải do tem
            trên hộp, nên nó là câu trả lời cuối cùng &mdash; hỏi miệng thì chỉ là lời hứa.
          </P>
        </>
      ),
    },
    {
      id: 'kiem-tra-va-thoi-diem-mua',
      title: 'Kiểm tra tại quầy và mua vào lúc nào',
      body: (
        <>
          <P>
            Ba thao tác dưới đây làm được ngay tại quầy trong vài phút, và cửa hàng đàng hoàng sẽ
            không ngăn bạn. Nếu bị từ chối, đó chính là câu trả lời.
          </P>
          <Ul>
            <li>
              <strong>*#06#</strong> hiện IMEI. Phải trùng với vỏ hộp và với giấy tờ của cửa hàng,
              rồi tra lại trên trang kiểm tra bảo hành của Samsung Việt Nam trước khi thanh toán.
            </li>
            <li>
              <strong>*#0*#</strong> mở menu tự kiểm tra phần cứng: các màn hình màu đơn sắc để soi
              điểm chết và hiện tượng lưu ảnh trên tấm nền OLED, lưới cảm ứng, loa, motor rung, cảm
              biến và cả hai camera. Với máy cũ, đây là hai phút hữu ích nhất bạn có.
            </li>
            <li>
              <strong>Tình trạng pin.</strong> Samsung không hiện phần trăm chai pin trong Cài đặt
              như iOS. Thông tin đó nằm trong ứng dụng <strong>Samsung Members</strong> có sẵn, mục
              chẩn đoán &mdash; mua máy cũ thì nhất định phải mở ra xem.
            </li>
          </Ul>
          <P>
            Về thời điểm: giá giảm mạnh nhất khi đời kế tiếp ra mắt và khi hàng trưng bày được xả cuối
            đợt, ngoài ra là các mùa khuyến mãi lớn trong năm. Nếu không cần máy ngay trong tháng
            này, chờ qua giai đoạn ba đến sáu tháng đầu thường lấy được đúng chiếc máy đó với giá
            thấp hơn hẳn.
          </P>
          <P>
            Về nơi mua: đại lý ủy quyền xuất hóa đơn đỏ và bảo hành chính hãng, giá ít biến động;
            chuỗi lớn giảm sâu hơn và có nhiều chương trình thu cũ đổi mới; cửa hàng xách tay rẻ nhất
            nhưng tự bảo hành; cửa hàng máy cũ cần kiểm tra kỹ; người bán cá nhân rẻ nhất và không có
            bảo hành. Phân tích đầy đủ từng kiểu có trong{' '}
            <HereLink href="/mua-iphone-o-dau-uy-tin">bài về năm kiểu cửa hàng</HereLink> &mdash;
            viết cho iPhone nhưng đúng nguyên vẹn với Samsung. Đừng đặt cọc giữ máy ở nơi bạn chưa
            từng đến.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Nên mua Samsung dòng nào?',
      a: 'Với phần lớn người dùng, dòng A tầm trung trên (A3x hoặc A5x) là mức không còn cảm giác phải hy sinh thứ gì, và cũng là nơi đa số người Việt dừng lại. Chọn dòng S nếu bạn giữ máy bốn năm năm hoặc chụp ảnh nhiều, chọn dòng M nếu pin quan trọng hơn tất cả và bạn quen mua online.',
    },
    {
      q: 'Galaxy S và Galaxy A khác nhau thế nào?',
      a: 'S là dòng cao cấp: chip mạnh nhất trong năm, camera tốt nhất, màn hình sáng nhất và thời gian cập nhật dài nhất. A là dòng tầm trung làm theo mức giá, thời gian hỗ trợ ngắn hơn và camera đơn giản hơn. Trong dòng A thì con số là phân khúc, và khoảng cách A2x lên A5x lớn hơn khoảng cách A5x lên S.',
    },
    {
      q: 'Samsung sản xuất tại Việt Nam sao giá không rẻ hơn?',
      a: 'Vì máy bán trong nước vẫn chịu VAT và đủ chi phí phân phối như mọi hàng hóa khác, nên việc lắp ráp trong nước không làm giá niêm yết thấp đi. Cái nó mang lại là nguồn hàng dồi dào, linh kiện sẵn và trung tâm bảo hành phủ rộng — và gián tiếp là tốc độ giảm giá sau đó nhanh hơn, vì không ai phải giữ giá để bảo vệ nguồn hàng nhập khẩu.',
    },
    {
      q: 'Nên mua Galaxy S đời cũ hay Galaxy A đời mới?',
      a: 'Cùng tầm tiền, S đời trước hơn ở chip, camera và màn hình — những thứ phần mềm không nâng cấp được. A đời mới hơn ở thời gian còn được cập nhật, pin mới và bảo hành còn đủ. Đổi máy hai ba năm một lần thì chọn S đời cũ; dùng tới khi hết cập nhật thì chọn A đời mới.',
    },
    {
      q: 'Có nên mua Samsung xách tay Hàn không?',
      a: 'Rẻ hơn thật, nhưng máy Hàn luôn phát tiếng khi chụp ảnh và không tắt được, đồng thời không được bảo hành tại trung tâm chính hãng ở Việt Nam vì bảo hành Samsung gắn theo IMEI và theo thị trường phân phối. Hợp lý nếu cửa hàng có địa chỉ rõ ràng và bạn ở gần; rủi ro nếu bạn sắp chuyển đi nơi khác.',
    },
    {
      q: 'Làm sao biết máy Samsung là hàng chính hãng Việt Nam?',
      a: 'Bấm *#1234# để xem firmware và mã vùng: máy phân phối cho thị trường Việt Nam chạy firmware Việt Nam, máy xách tay thì không. Đối chiếu IMEI bằng *#06# với vỏ hộp và với trang tra bảo hành của Samsung Việt Nam. Tem trên hộp không chứng minh được gì, mã firmware thì có.',
    },
    {
      q: 'Samsung mất giá nhanh hơn iPhone bao nhiêu?',
      a: 'Không có một con số cố định, nhưng xu hướng thì ổn định: Galaxy rớt giá nhanh hơn và sâu hơn, rõ nhất trong năm đầu tiên. Lý do là thị trường máy cũ ở Việt Nam sâu và thanh khoản hơn với iPhone. Nếu bạn hay đổi máy, mua Galaxy đã qua một đời sẽ hợp lý hơn nhiều so với mua máy vừa ra mắt.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Mua Samsung Galaxy dòng nào — phân biệt S, A, M và Z | ${SITE_NAME}`,
  description:
    'Dòng S, A, M, Z và bản FE khác nhau ra sao, vì sao giá Samsung tại Việt Nam giảm sâu hơn iPhone, nên chọn S đời cũ hay A đời mới, và cách kiểm tra máy chính hãng ngay tại quầy.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function MuaSamsungGalaxyDongNaoPage() {
  return <SeoArticle content={CONTENT} />
}
