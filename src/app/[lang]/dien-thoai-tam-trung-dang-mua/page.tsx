import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * ĐIỆN THOẠI TẦM TRUNG ĐÁNG MUA — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED. The English page (/best-value-phones-vietnam) spends its length on
 * what a newcomer cannot assume — which brands have official distribution here, whether a handset
 * bought abroad works on local bands, that a foreign warranty is not serviced in Vietnam. A
 * Vietnamese reader knows every one of those already and hesitates somewhere else entirely: chi phí
 * mỗi năm sử dụng rather than sticker price, thanh khoản (how fast and how well the phone resells),
 * whether a brand's update promise survives contact with reality, and whether a used previous-gen
 * flagship beats a new mid-ranger. So this article is built around resale economics and the things
 * a spec sheet does not say; the English one is built around arriving from outside.
 *
 * ⛔ KHÔNG CÓ GIÁ TRONG BÀI. Prices move monthly; live figures come from the marketplace's own
 * listings via /iphone-18-vietnam.
 *
 * ⛔ KHÔNG XẾP HẠNG CỬA HÀNG. The marketplace lists several retailers and earns affiliate revenue
 * from some of them.
 */
const SLUG = 'dien-thoai-tam-trung-dang-mua'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Điện thoại tầm trung đáng mua',
  intro:
    'Máy tầm trung ở Việt Nam không phải là flagship bị cắt bớt — đây là phân khúc các hãng cạnh tranh gắt nhất, và với phần lớn người dùng thì nó là lựa chọn đúng. Bài này nói về chỗ máy tầm trung thật sự hơn flagship, ba thông số xuống cấp nhanh nhất quyết định cảm giác dùng máy ở năm thứ ba, và khi nào flagship đời trước đáng tiền hơn cả hai.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/best-value-phones-vietnam' },
  sections: [
    {
      id: 'dang-mua-nghia-la-gi',
      title: 'Đáng mua không phải là rẻ, mà là chi phí mỗi năm sử dụng',
      body: (
        <>
          <P>
            Một chiếc máy mua rẻ, dùng hai năm rồi bán lại gần như cho không, hoàn toàn có thể đắt
            hơn một chiếc nhỉnh giá hơn nhưng giữ giá tốt và dùng được bốn năm. Cách tính sát thực tế
            là: giá mua trừ đi số tiền bán lại được, cộng một lần thay pin, chia cho số năm bạn thực
            sự dùng. Con số đó mới là giá của chiếc máy.
          </P>
          <P>
            Ở mức tầm trung hiện nay, phần &ldquo;lúc mới mua&rdquo; gần như không còn gì để chê:
            màn AMOLED lớn, tần số quét cao, sạc nhanh, pin dung lượng lớn đều là chuyện bình thường.
            Khác biệt so với flagship không nằm ở tuần đầu tiên mở hộp, mà nằm ở năm thứ ba &mdash;
            lúc máy bắt đầu giật khi mở nhiều ứng dụng, pin tụt giữa buổi chiều, và bản vá bảo mật
            cuối cùng đã về từ lâu.
          </P>
          <P>
            Vì vậy câu hỏi đúng không phải là &ldquo;máy nào cấu hình cao nhất trong tầm giá&rdquo;,
            mà là &ldquo;máy nào còn dùng ổn khi mình đã dùng nó ba năm&rdquo;. Chỉ có ba thông số
            trả lời được câu đó, và cả ba đều nằm ở chỗ ít người đọc kỹ.
          </P>
        </>
      ),
    },
    {
      id: 'ba-thong-so-xuong-cap-nhanh',
      title: 'Ba thứ xuống cấp nhanh nhất: chip, pin và thời hạn cập nhật',
      body: (
        <>
          <P>
            <strong>1. Chip.</strong> Đây là linh kiện duy nhất không nâng cấp được, không thay được
            và cũng không lách được. Điểm benchmark lúc ra mắt không nói lên điều gì về cảm giác dùng
            máy ở năm thứ ba, vì ứng dụng ngày càng nặng còn con chip thì đứng yên. Chip còn gánh cả
            modem sóng và bộ xử lý ảnh: máy bắt sóng kém dưới hầm gửi xe hay chụp tối bết nhòe thường
            là do chip, chứ không phải do camera &ldquo;bao nhiêu chấm&rdquo;. Khi hai máy cùng giá,
            phân khúc chip là con số dự báo chính xác nhất cho tuổi thọ sử dụng.
          </P>
          <P>
            <strong>2. Pin.</strong> Pin chai theo số chu kỳ sạc và theo nhiệt độ &mdash; mà nhiệt
            thì ở Việt Nam không bao giờ thiếu. Sạc nhanh liên tục, kẹp máy trên giá đỡ xe máy giữa
            trưa, vừa sạc vừa chơi game, tất cả đều rút ngắn cùng một cái đồng hồ. Apple công bố pin
            trên các đời iPhone gần đây giữ khoảng 80% dung lượng sau 1.000 chu kỳ sạc đầy, gấp đôi
            mức công bố của các đời cũ; phía Android các hãng công bố không đồng nhất nên khó so
            trực tiếp. Điểm an ủi là pin vẫn là linh kiện thay được, và chi phí thay pin nhỏ hơn
            nhiều so với đổi cả máy. Nếu định dùng bốn năm, hãy tính sẵn một lần thay pin vào chi phí
            ngay từ đầu thay vì coi máy chai pin là máy hết đời.
          </P>
          <P>
            <strong>3. Thời hạn cập nhật.</strong> Đây là thông số ít người tra nhất và lại là thứ
            thực sự kết thúc vòng đời chiếc máy: hết vá bảo mật thì dần dần ứng dụng ngân hàng và các
            dịch vụ khác cũng ngừng hỗ trợ phiên bản hệ điều hành đó. Nhóm flagship Android hiện cam
            kết khoảng bảy năm cập nhật hệ điều hành và bảo mật; máy tầm trung thường ngắn hơn, phổ
            biến quanh mức bốn phiên bản Android và năm năm vá bảo mật, và con số này khác nhau theo
            từng hãng, từng model chứ không theo tên thương hiệu. iPhone không có cam kết công bố,
            nhưng trên thực tế thường nhận cập nhật iOS lớn trong khoảng năm đến sáu năm. Hai điều
            cần nhớ: tra theo đúng model, và đồng hồ đếm từ ngày model ra mắt chứ không phải ngày bạn
            mua &mdash; mua một chiếc đã ra mắt hai năm là mất trước hai năm.
          </P>
        </>
      ),
    },
    {
      id: 'flagship-doi-truoc',
      title: 'Khi nào flagship đời trước đáng hơn tầm trung mới',
      body: (
        <>
          <P>
            Flagship lùi một đời, mua mới chính hãng lúc cửa hàng xả hàng tồn, thường là món đáng
            tiền nhất trên thị trường này: chip flagship, cảm biến camera lớn hơn, chuẩn chống nước
            đầy đủ, màn hình tốt hơn và cam kết cập nhật dài hơn &mdash; ở mức giá mà máy tầm trung
            đời mới đang bán. Thị trường Việt Nam giữ máy đời trước trên kệ lâu hơn nhiều thị trường
            khác, nên lựa chọn này gần như lúc nào cũng có.
          </P>
          <P>Phép tính chỉ có lợi nếu kiểm tra trước bốn thứ:</P>
          <Ul>
            <li>
              <strong>Thời hạn cập nhật còn lại</strong> &mdash; lấy cam kết của model trừ đi tuổi
              máy. Flagship cam kết bảy năm mà đã ra được hai năm vẫn hơn máy tầm trung cam kết bốn.
            </li>
            <li>
              <strong>Máy tồn kho mới hay máy cũ</strong> &mdash; hàng tồn kho còn nguyên bảo hành
              chính hãng và pin chưa dùng. Máy cũ thì không có cả hai, và tình trạng pin là con số
              quyết định có hời hay không.
            </li>
            <li>
              <strong>Linh kiện thay thế</strong> &mdash; model càng cũ càng khó kiếm màn hình và pin
              chính hãng, nhất là với hãng không phân phối chính thức tại Việt Nam.
            </li>
            <li>
              <strong>Phiên bản thị trường</strong> &mdash; bản quốc tế và bản nội địa của cùng một
              model có thể khác nhau về băng tần, ROM và cả ứng dụng cài sẵn.
            </li>
          </Ul>
          <P>
            Lùi từ hai đời trở lên thì không còn là mua giá tốt nữa, mà là mua máy cũ, và phải kiểm
            tra đúng như mua máy cũ. Các bước kiểm tra nằm ở{' '}
            <HereLink href="/kinh-nghiem-mua-iphone-cu">bài kinh nghiệm mua máy cũ</HereLink>, áp
            dụng được cho cả máy Android.
          </P>
        </>
      ),
    },
    {
      id: 'thanh-khoan-va-gia-ban-lai',
      title: 'Thanh khoản: phần tiền thật nằm ở giá bán lại',
      body: (
        <>
          <P>
            Hai chiếc máy mua cùng giá hôm nay có thể chênh nhau rất xa sau hai năm. iPhone và
            flagship Samsung có thị trường mua đi bán lại rộng nhất ở Việt Nam, nên rớt giá chậm hơn
            và quan trọng hơn là bán được nhanh hơn. Nhiều dòng tầm trung rớt giá mạnh ngay trong năm
            đầu, đơn giản vì hãng liên tục ra model mới ở đúng mức giá đó &mdash; máy của bạn bị so
            với hàng mới chứ không phải với chính nó lúc mua.
          </P>
          <P>
            Điều đó không có nghĩa là ai cũng phải mua iPhone. Nó chỉ dẫn tới một quy tắc đơn giản:
            nếu bạn có thói quen đổi máy sau khoảng hai năm, thanh khoản quan trọng hơn cấu hình, vì
            phần lớn tiền của bạn nằm ở khoản chênh lệch chứ không ở giá niêm yết. Còn nếu bạn dùng
            máy tới khi hỏng hẳn, thanh khoản gần như không đáng kể, và lúc đó chip với thời hạn cập
            nhật là tất cả.
          </P>
          <P>
            Giá thị trường hôm nay của dòng mới nhất có trên{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>, đọc trực tiếp từ tin
            rao đang có chứ không phải từ bảng giá niêm yết cũ.
          </P>
        </>
      ),
    },
    {
      id: 'thong-so-khong-noi',
      title: 'Những thứ bảng thông số không nói',
      body: (
        <>
          <P>
            Phần lớn khác biệt thực tế giữa hai máy cùng tầm giá không nằm ở dòng nào trên bảng thông
            số. Đây là những chỗ nên xem tay thật hoặc đọc đánh giá dài ngày thay vì so bảng:
          </P>
          <Ul>
            <li>
              <strong>Hiệu năng ổn định</strong> &mdash; chip tầm trung tụt xung sau một lúc tải
              nặng, nên chơi game hay quay video dài sẽ khác hẳn con số lúc mới bấm benchmark.
            </li>
            <li>
              <strong>Độ sáng thật ngoài nắng</strong> &mdash; con số nits quảng cáo thường là mức
              đỉnh trên một vùng nhỏ khi xem nội dung HDR, không phải độ sáng toàn màn hình. Nắng
              buổi trưa là phép thử thật.
            </li>
            <li>
              <strong>Camera là phần mềm</strong> &mdash; hai máy dùng cùng cảm biến vẫn cho ra ảnh
              khác nhau rõ rệt, nhất là chụp đêm và chụp người.
            </li>
            <li>
              <strong>Rung và loa</strong> &mdash; motor rung rẻ tiền và loa mỏng là thứ nhận ra sau
              một tuần gõ phím, và không sửa được bằng bản cập nhật nào.
            </li>
            <li>
              <strong>Chuẩn chống nước</strong> &mdash; nhiều máy tầm trung chỉ đạt mức chống bụi và
              văng nước nhẹ, không phải chịu được ngâm nước. Mùa mưa ở đây là chuyện có thật.
            </li>
            <li>
              <strong>Cập nhật trên thực tế</strong> &mdash; cam kết là số phiên bản, không phải tốc
              độ. Máy tầm trung thường nhận bản Android mới chậm hơn flagship cùng hãng vài tháng.
            </li>
          </Ul>
          <P>
            Nếu ngân sách thấp hơn nữa, phần nên ưu tiên và phần có thể bỏ qua ở nhóm giá rẻ nằm ở{' '}
            <HereLink href="/dien-thoai-5g-gia-re">bài về điện thoại 5G giá rẻ</HereLink>.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Điện thoại tầm trung dùng được mấy năm?',
      a: 'Ba đến bốn năm là mức thực tế nếu chọn đúng: chip thuộc nhóm trên của tầm trung, cam kết cập nhật còn dài, và chấp nhận thay pin một lần giữa vòng đời. Máy chọn theo cảm tính hoặc theo khuyến mãi thường bắt đầu khó chịu từ khoảng năm thứ hai, chủ yếu vì chip chứ không phải vì pin.',
    },
    {
      q: 'Nên mua flagship đời cũ hay tầm trung mới?',
      a: 'Flagship lùi một đời, mua mới chính hãng khi cửa hàng xả hàng tồn, thường đáng tiền hơn: chip mạnh hơn, camera tốt hơn, chống nước đầy đủ và cam kết cập nhật dài hơn ở cùng mức giá. Lùi từ hai đời trở lên thì đó là mua máy cũ, phải kiểm tra pin, bảo hành còn lại và linh kiện thay thế trước khi trả tiền.',
    },
    {
      q: 'Chip tầm trung có bị lag sau 2-3 năm không?',
      a: 'Có, và đó là lý do chip là thông số quan trọng nhất khi chọn máy giữ lâu. Ứng dụng ngày càng nặng trong khi chip đứng yên, nên chênh lệch một bậc phân khúc chip lúc mua sẽ thành chênh lệch rất rõ ở năm thứ ba. Chip cũng quyết định chất lượng sóng và xử lý ảnh, hai thứ không nâng cấp được bằng phần mềm.',
    },
    {
      q: 'Pin điện thoại bao lâu thì chai, có nên thay pin không?',
      a: 'Pin chai theo chu kỳ sạc và theo nhiệt, mà khí hậu ở đây làm nhanh hơn datasheet. Apple công bố pin iPhone đời gần đây giữ khoảng 80% dung lượng sau 1.000 chu kỳ sạc đầy; phía Android công bố không đồng nhất. Thay pin là việc nên làm: chi phí nhỏ hơn nhiều so với đổi máy, và một chiếc máy còn mạnh mà chai pin chưa phải là máy hết đời.',
    },
    {
      q: 'Máy tầm trung được cập nhật Android mấy năm?',
      a: 'Tùy hãng và tùy model, phổ biến quanh mức bốn phiên bản Android và năm năm vá bảo mật, trong khi nhóm flagship đầu bảng hiện cam kết khoảng bảy năm. Hãy tra đúng model trước khi mua, và nhớ rằng thời hạn tính từ ngày model ra mắt chứ không phải ngày bạn mua máy.',
    },
    {
      q: 'Máy nào giữ giá nhất khi bán lại?',
      a: 'iPhone và flagship Samsung có thị trường mua bán lại rộng nhất ở Việt Nam nên rớt giá chậm và bán nhanh hơn. Nhiều dòng tầm trung mất giá mạnh trong năm đầu vì hãng ra model mới liên tục ở cùng mức giá. Nếu bạn hay đổi máy sau hai năm, đây là yếu tố quan trọng hơn cấu hình.',
    },
    {
      q: 'Máy likenew 99% có đáng mua không?',
      a: 'Đáng, nếu kiểm tra được ba thứ: tình trạng pin, bảo hành còn lại và máy chưa bị mở ra sửa. Nhãn 99% là cách mô tả ngoại hình chứ không phải một tiêu chuẩn có kiểm định, nên giá trị của nó phụ thuộc hoàn toàn vào việc bạn được kiểm tra máy kỹ đến đâu trước khi trả tiền.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Điện thoại tầm trung đáng mua — chip, pin và thời hạn cập nhật | ${SITE_NAME}`,
  description:
    'Khi nào máy tầm trung hơn hẳn flagship, ba thông số xuống cấp nhanh nhất là chip, pin và thời hạn cập nhật, và khi nào flagship đời trước đáng tiền hơn cả hai.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function DienThoaiTamTrungDangMuaPage() {
  return <SeoArticle content={CONTENT} />
}
