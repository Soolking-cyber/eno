import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * ĐIỆN THOẠI 5G GIÁ RẺ — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and the two articles deliberately diverge. The English page
 * (/budget-5g-phones-vietnam) is read by someone holding a handset bought abroad, so it argues about
 * n41/n78 band lists on imported model numbers, what a passport is enough for, and SIM registration.
 * A Vietnamese reader buys locally, so none of that is a question. What they ask instead: has 5G
 * reached my area yet, does my current SIM already work, does 5G eat the battery, how many years
 * will a cheap 5G chip keep getting updates, is RAM ảo real, and whether the same money is better
 * spent on a new budget 5G phone or a two-generation-old flagship. Different questions, so a machine
 * translation of either page would answer the wrong ones in both languages.
 *
 * ⚠️ KHÔNG GHI GIÁ TRONG BÀI. Giá phân khúc này thay đổi từng quý; con số viết vào đây sai sau vài
 * tuần. Giá thực tế đọc từ tin rao của sàn.
 *
 * ⚠️ KHÔNG XẾP HẠNG hay gọi tên cửa hàng nào là "uy tín nhất" — sàn có doanh thu liên kết với một số
 * nhà bán lẻ, nên một bảng xếp hạng ở đây là quảng cáo đội lốt bài viết.
 */
const SLUG = 'dien-thoai-5g-gia-re'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Điện thoại 5G giá rẻ',
  intro:
    'Chữ 5G đã rơi xuống tận phân khúc phổ thông, nhưng vùng phủ sóng thì chưa theo kịp. Bài này nói rõ 5G ở Việt Nam hiện dùng được ở đâu, SIM đang dùng có cần đổi không, bốn thông số quyết định máy giá rẻ trụ được mấy năm, và những dòng ghi trên tờ thông số chỉ để cho dài.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/budget-5g-phones-vietnam' },
  sections: [
    {
      id: 'song-5g-den-dau',
      title: 'Sóng 5G hiện tới đâu, và khi nào bạn thật sự thấy khác',
      body: (
        <>
          <P>
            5G thương mại chạy ở Việt Nam từ cuối năm 2024, sau các phiên đấu giá tần số đầu năm đó.
            Vùng phủ đi theo mật độ người dùng chứ không theo địa giới: lõi Hà Nội, TP.HCM và Đà Nẵng
            trước, rồi khu công nghiệp, sân bay, khu đại học và các phường trung tâm của những thành
            phố lớn khác. Ra khỏi vùng đó vài con phố, máy tự rơi về 4G &mdash; và 4G ở Việt Nam đang
            phủ dày, tốc độ đủ dùng, nên không ai phải vội.
          </P>
          <P>
            Điều thứ hai ít người nói: 5G tại Việt Nam nằm ở dải tần trung, khoảng 2.6 GHz và 3.5 GHz.
            Tần số càng cao thì càng đi gần và xuyên tường càng kém, nên chuyện đứng ngoài đường bắt
            5G nhưng vào trong nhà ống, chung cư cũ hay tầng trệt nhà mặt phố lại về 4G là bình thường
            chứ không phải máy hỏng.
          </P>
          <P>
            5G ăn tiền ở hai tình huống: chỗ đông người và lúc upload nhiều. Sân bay giờ cao điểm,
            sân vận động, chợ đêm cuối tuần, quán cà phê đang phục vụ bốn chục cái điện thoại khác, hay
            khi bạn đẩy một video dài lên mạng. Còn nếu một ngày của bạn là nhắn tin, bản đồ, nghe nhạc
            và lướt mạng xã hội thì rất khó phân biệt 4G với 5G.
          </P>
          <P>
            Bản đồ vùng phủ của nhà mạng có, nhưng luôn lệch thực tế theo cả hai chiều, nên hãy xem đó
            là quảng cáo hơn là dữ liệu. Cách kiểm tra đáng tin nhất là nhìn thanh trạng thái của chính
            chiếc máy đang dùng trong một tuần bình thường, ở đúng những nơi bạn hay đến. Kết luận
            thường là: đừng mua máy chỉ vì chữ 5G, hãy mua chiếc máy tốt hơn mà tiện thể có 5G.
          </P>
        </>
      ),
    },
    {
      id: 'sim-va-nha-mang',
      title: 'SIM, nhà mạng và những thứ không cần mua thêm',
      body: (
        <>
          <P>
            Phần lớn SIM 4G đang dùng đã vào được 5G mà không phải làm gì cả. Một số SIM đời cũ thì
            phải đổi sang phôi SIM mới &mdash; đổi tại quầy nhà mạng, giữ nguyên số. Nếu máy đã hỗ trợ
            5G mà thanh trạng thái vẫn chỉ hiện 4G ở nơi chắc chắn có sóng, hỏi nhà mạng về phôi SIM
            trước khi nghĩ đến chuyện đổi máy.
          </P>
          <P>
            Mỗi nhà mạng giữ một khối tần số khác nhau, nên cùng một chiếc máy có thể bắt 5G với nhà
            mạng này và không bao giờ hiện 5G với nhà mạng kia. Với máy chính hãng bán trong nước thì
            không phải lo, vì máy được cấu hình cho mạng Việt Nam. Với máy xách tay thì phải đối chiếu
            danh sách băng tần của <strong>đúng phiên bản máy</strong> &mdash; tìm số hiệu kiểu máy
            trên vỏ hộp và trong phần Giới thiệu, rồi tra <code>n41</code> và <code>n78</code> trên
            trang thông số của hãng. Chữ &ldquo;5G&rdquo; in trên hộp không phải là danh sách băng tần.
          </P>
          <Ul>
            <li>
              Máy hai SIM thường chỉ chạy 5G trên một khe tại một thời điểm. Nếu bạn dùng hai số, kiểm
              tra khe nào được ưu tiên.
            </li>
            <li>
              eSIM ở phân khúc rẻ rất thất thường, thậm chí khác nhau giữa các bản của cùng một dòng
              máy. Nếu cần eSIM thì kiểm tra trước tiên, trước cả camera:{' '}
              <HereLink href="/esim-viettel-vinaphone-mobifone">hướng dẫn eSIM theo nhà mạng</HereLink>{' '}
              có danh sách máy và thủ tục.
            </li>
            <li>
              Máy cũ đời cao nhưng ra mắt đã vài năm có thể hoàn toàn không có 5G, hoặc có 5G nhưng
              thiếu đúng băng tần đang dùng ở Việt Nam. Đây là chỗ người mua máy cũ hay hụt nhất.
            </li>
            <li>
              Bật 5G suốt ngày ở nơi sóng yếu là cách tốn pin nhanh nhất. Ở vùng rìa, để máy ưu tiên
              4G lại mượt hơn và pin trụ lâu hơn.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'thong-so-dang-tien',
      title: 'Bốn thông số quyết định máy trụ được mấy năm',
      body: (
        <>
          <P>
            Ở phân khúc này, máy nào ngày đầu cũng chạy mượt. Câu hỏi thật sự là năm thứ ba máy còn
            dùng được không, và bốn thứ dưới đây quyết định điều đó &mdash; cả bốn đều hỏi được ngay
            tại quầy.
          </P>
          <Ul>
            <li>
              <strong>Chip và cam kết cập nhật đi kèm.</strong> Hỏi tên chip cụ thể, đừng hỏi
              &ldquo;mấy nhân&rdquo;. Rồi hỏi hãng cam kết bao nhiêu phiên bản Android và bao nhiêu
              năm vá bảo mật cho đúng model đó &mdash; con số này được công bố, chênh lệch rất lớn
              giữa các hãng cùng tầm giá, và là thông số trung thực nhất về tuổi thọ. Máy hết cập nhật
              là máy phải thay.
            </li>
            <li>
              <strong>Pin, và mức 5G ngốn thêm.</strong> Sóng 5G tốn điện hơn 4G, tốn nhất ở rìa vùng
              phủ khi máy liên tục dò sóng &mdash; mà theo phần trên thì phần lớn Việt Nam đang ở đúng
              trạng thái đó. Pin dung lượng lớn là chuẩn chung của phân khúc; còn con số công suất sạc
              ghi trên hộp là mức đỉnh trong vài phút đầu, không phải mức duy trì.
            </li>
            <li>
              <strong>Độ sáng màn hình, quan trọng hơn tần số quét.</strong> Nắng ở đây gắt, màn hình
              tối là không đọc nổi khi dừng đèn đỏ giữa trưa. Tầm giá rẻ thường bắt chọn giữa LCD quét
              cao và AMOLED quét thấp hơn; đi ngoài đường thì tấm nền sáng và tương phản tốt thắng, còn
              trong nhà thì mắt quen với tần số quét nào cũng chỉ sau một ngày.
            </li>
            <li>
              <strong>Loại bộ nhớ, quan trọng hơn dung lượng.</strong> Máy rẻ bị ì sau một năm thường
              do bộ nhớ trong chứ không phải do chip. Thế hệ bộ nhớ đáng hỏi hơn con số 128 hay 256, và
              bản dung lượng thấp nhất luôn đầy nhanh hơn bạn tưởng vì ảnh và video.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'chieu-marketing',
      title: 'Những dòng trên tờ thông số chỉ để cho dài',
      body: (
        <>
          <P>
            Phân khúc phổ thông là nơi tờ thông số làm việc vất vả nhất, vì các máy cạnh tranh gần như
            giống nhau nên phải tạo ra khác biệt bằng chữ. Đây là những chỗ nên trừ đi khi so sánh.
          </P>
          <Ul>
            <li>
              <strong>RAM ảo.</strong> Ghi &ldquo;12GB (8+4)&rdquo; nghĩa là 8. Phần còn lại là bộ nhớ
              trong mượn tạm: giúp giữ ứng dụng nền tốt hơn một chút, không làm máy nhanh hơn, và ghi
              liên tục vào đúng thành phần vốn đã yếu nhất của máy rẻ.
            </li>
            <li>
              <strong>Số chấm camera thật lớn.</strong> Cảm biến 108MP ở tầm giá này vẫn gộp điểm ảnh
              xuống ảnh nhỏ hơn nhiều, và chất lượng cuối cùng phụ thuộc ống kính cùng phần mềm xử lý.
              Hai camera &ldquo;macro 2MP&rdquo; và &ldquo;xóa phông 2MP&rdquo; bên cạnh chủ yếu để
              danh sách dài ra.
            </li>
            <li>
              <strong>Nhãn &ldquo;AI&rdquo;.</strong> Ở phân khúc này hầu hết là tính năng chạy trên
              máy chủ của hãng, máy nào cài đúng ứng dụng cũng làm được, không phải do phần cứng.
            </li>
            <li>
              <strong>&ldquo;Kháng nước&rdquo; không kèm chuẩn IP.</strong> Chống bắn nước là một câu
              quảng cáo, không phải một tiêu chuẩn. Vào mùa mưa, khác biệt giữa hai thứ đó là khác biệt
              thật.
            </li>
            <li>
              <strong>Tần số quét ghi kiểu &ldquo;lên đến&rdquo;.</strong> Màn hình chỉ đạt mức cao
              nhất trong vài ứng dụng vẫn được in con số cao nhất lên hộp.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'may-moi-hay-flagship-cu',
      title: 'Máy 5G mới giá rẻ hay flagship cũ: chọn thế nào',
      body: (
        <>
          <P>
            Cùng một số tiền, bạn đứng trước hai lựa chọn khác hẳn nhau. Máy mới phân khúc phổ thông
            cho bạn pin mới, bảo hành chính hãng đầy đủ, còn nhiều năm cập nhật phía trước và chắc chắn
            có 5G đúng băng tần trong nước. Flagship đã ra mắt vài năm cho bạn màn hình, camera và chip
            ở đẳng cấp khác hẳn, đổi lại pin đã chai, thời gian cập nhật sắp hết, và như phần trên đã
            nói, có thể không bắt được 5G ở đây.
          </P>
          <P>
            Nếu ưu tiên là chụp ảnh và màn hình đẹp, flagship cũ gần như luôn thắng. Nếu ưu tiên là máy
            chạy ổn định vài năm không phải lo, máy mới thắng. So sánh chi tiết theo từng tầm giá nằm
            ở{' '}
            <HereLink href="/dien-thoai-tam-trung-dang-mua">bài về máy tầm trung đáng mua</HereLink> và{' '}
            <HereLink href="/dien-thoai-duoi-10-trieu">bài về ngân sách phổ thông</HereLink>.
          </P>
          <P>
            Chọn máy cũ thì kiểm tra theo đúng thứ tự: tình trạng pin, IMEI khớp máy và vỏ hộp, tài
            khoản của chủ cũ đã đăng xuất hoàn toàn, màn hình không ám hay hở sáng, và thử camera trước
            sau. Bảo hành ở phân khúc rẻ đáng giá hơn người ta tưởng, vì một lần sửa chiếm tỉ lệ rất
            lớn so với giá máy &mdash; máy xách tay giá rẻ thường không có bảo hành chính hãng trong
            nước, và cái giá của việc đó nằm trong{' '}
            <HereLink href="/bao-hanh-sua-chua-dien-thoai">bài về bảo hành và sửa chữa</HereLink>.
          </P>
          <P>
            Mua trả góp thì hỏi tổng số tiền phải trả đến hết kỳ chứ đừng hỏi lãi suất, vì chỉ con số
            tổng mới so sánh được giữa các nơi;{' '}
            <HereLink href="/mua-dien-thoai-tra-gop">bài về trả góp</HereLink> nói rõ các khoản phí hay
            bị bỏ sót. Còn giá thị trường theo thời gian thực của dòng máy mới nhất thì xem{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>, đọc thẳng từ tin rao
            của các nhà bán lẻ chứ không phải từ thông cáo báo chí.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Điện thoại 5G rẻ nhất hiện nay giá bao nhiêu?',
      a: 'Mức giá vào 5G đã xuống chỉ còn một phần nhỏ so với máy flagship và vẫn đang giảm theo từng quý, nên một con số viết trong bài sẽ sai sau vài tuần. Hãy xem tin rao hiện tại của đúng model bạn đang cân nhắc thay vì tin một mức giá công bố sẵn.',
    },
    {
      q: 'SIM 4G có dùng được 5G không?',
      a: 'Phần lớn SIM 4G đang dùng vào được 5G mà không phải làm gì. Một số phôi SIM đời cũ phải đổi tại quầy nhà mạng, vẫn giữ nguyên số. Nếu máy hỗ trợ 5G mà chỗ chắc chắn có sóng vẫn chỉ hiện 4G, hỏi nhà mạng về phôi SIM trước khi nghĩ tới đổi máy.',
    },
    {
      q: 'Ở Việt Nam đã phủ sóng 5G chưa, khu vực nào có?',
      a: 'Có từ cuối năm 2024 nhưng không đều. Sóng tập trung ở lõi Hà Nội, TP.HCM, Đà Nẵng, các khu công nghiệp, sân bay và phường trung tâm của các thành phố lớn. Ra ngoài vùng đó, và nhiều khi chỉ cần vào trong nhà, máy vẫn rơi về 4G.',
    },
    {
      q: 'Dùng 5G có tốn pin hơn 4G không?',
      a: 'Có, và tốn nhất ở nơi sóng yếu vì máy phải dò liên tục. Đó là lý do một chiếc máy 5G giá rẻ cần pin tốt hơn một chiếc 4G cùng tầm. Ở vùng phủ chưa tới, đặt máy ưu tiên 4G thường cho trải nghiệm mượt hơn và pin trụ lâu hơn.',
    },
    {
      q: 'Máy 5G giá rẻ dùng được mấy năm?',
      a: 'Quyết định bởi cam kết cập nhật chứ không phải cấu hình. Hỏi hãng cam kết bao nhiêu phiên bản Android và bao nhiêu năm vá bảo mật cho đúng model đó; con số này chênh nhau rất nhiều ở cùng tầm giá và là căn cứ đáng tin nhất về tuổi thọ máy.',
    },
    {
      q: 'RAM ảo có tác dụng thật không?',
      a: 'Rất ít. Đó là bộ nhớ trong mượn tạm làm RAM, giúp giữ ứng dụng nền lâu hơn một chút nhưng không làm máy nhanh hơn, và việc ghi liên tục lại đè lên bộ nhớ vốn là điểm yếu của máy rẻ. Ghi 12GB (8+4) thì RAM thật là 8.',
    },
    {
      q: 'Nên mua máy 5G mới giá rẻ hay flagship cũ 4G?',
      a: 'Muốn ảnh đẹp và màn hình tốt thì flagship cũ gần như luôn hơn. Muốn máy chạy ổn vài năm, còn bảo hành, pin mới và chắc chắn bắt được 5G trong nước thì chọn máy mới. Lưu ý flagship ra mắt đã lâu có thể không có 5G hoặc thiếu băng tần dùng ở Việt Nam.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Điện thoại 5G giá rẻ — sóng tới đâu và thông số nào đáng tiền | ${SITE_NAME}`,
  description:
    'Vùng phủ 5G thực tế tại Việt Nam, SIM 4G có dùng được 5G không, bốn thông số quyết định máy giá rẻ trụ được mấy năm, và nên chọn máy 5G mới hay flagship cũ.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function DienThoai5GGiaRePage() {
  return <SeoArticle content={CONTENT} />
}
