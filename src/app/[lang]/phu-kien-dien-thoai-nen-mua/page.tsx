import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { phoneGuideAlternates, phoneGuidesIn } from '@/lib/phone-guides'
import { HereLink, P, SeoArticle, Ul, type ArticleContent } from '@/components/marketplace/seo-article'

/**
 * PHỤ KIỆN ĐIỆN THOẠI NÊN MUA — the Vietnamese half of the pair.
 *
 * ⛔ WRITTEN, NOT TRANSLATED, and the two articles deliberately answer different questions. The
 * English page orients a newcomer: what the climate does, whether a charger from home plugs into a
 * Vietnamese socket, what the wet season and a scooter mount cost a phone. A Vietnamese reader
 * knows all of that already and is standing at an accessory counter deciding something else —
 * full keo or keo viền, what to check before leaving after a fitting, which brand's fast charge
 * dies with someone else's brick, what a 10.000 mAh power bank really delivers, and which of the
 * things on the wall are tiền oan. Machine-translating either page would answer the wrong
 * questions in both languages.
 *
 * ⚠️ KHÔNG CÓ GIÁ TRONG BÀI. Giá phụ kiện thay đổi theo tuần; trang giá máy đọc từ tin rao thật
 * mới là chỗ để con số.
 *
 * ⚠️ KHÔNG XẾP HẠNG VÀ KHÔNG GỌI TÊN CỬA HÀNG NÀO LÀ "UY TÍN NHẤT". The marketplace lists several
 * of these retailers and earns affiliate revenue from some, so a ranking here would be an
 * advertisement with an editorial byline.
 */
const SLUG = 'phu-kien-dien-thoai-nen-mua'

const CONTENT: ArticleContent = {
  eyebrow: 'Cẩm nang mua sắm',
  h1: 'Phụ kiện điện thoại nên mua',
  intro:
    'Điện thoại chịu được khí hậu ở đây, phụ kiện thì không: ốp trong ố vàng sau vài tháng, ốp da mốc vào mùa nồm, keo dán bong, và củ sạc trôi nổi là món duy nhất trong túi bạn có rủi ro thật sự. Bài này nói về ốp lưng, cường lực, củ sạc, cáp và sạc dự phòng — chọn theo cái gì, hỏi gì khi dán ở shop, và những món chỉ là tiền oan.',
  canonical: `/${SLUG}`,
  published: '2026-09-19',
  lang: 'vi',
  alternate: { lang: 'en', href: '/phone-accessories-vietnam' },
  sections: [
    {
      id: 'op-lung-chon-chat-lieu',
      title: 'Ốp lưng: chọn theo chất liệu, đừng chọn theo chữ trên hộp',
      body: (
        <>
          <P>
            Chất liệu quyết định chiếc ốp còn nhìn được bao lâu. <strong>TPU dẻo trong</strong> rẻ
            nhất và cũng ố vàng nhanh nhất &mdash; tia UV và dầu từ tay đều làm ố, ở khí hậu này
            tính bằng tháng chứ không phải bằng năm. <strong>Ốp lai</strong> viền dẻo lưng nhựa cứng
            giữ được độ trong lâu hơn thấy rõ. <strong>Ốp silicon</strong> bám tay tốt khi tay ướt
            mồ hôi, đổi lại hút bụi vải. <strong>Ốp da</strong> đẹp nhất và tốn công nhất: mùa nồm
            ngoài Bắc hay mùa mưa trong Nam, cất chiếc ốp da lúc còn ẩm là vài ngày sau mốc đường
            chỉ.
          </P>
          <P>
            Kiểu rơi phổ biến nhất ở đây là máy trượt khỏi yên xe hoặc tuột khỏi túi quần xuống nền
            gạch, tiếp đất bằng góc. Vì vậy đệm góc và gờ cao hơn cả mặt kính lẫn cụm camera đáng
            tiền hơn mọi dòng chữ in trên hộp. Nhãn &ldquo;chuẩn quân đội MIL-STD-810&rdquo; là do
            chính nhà sản xuất tự công bố, không có bên thứ ba nào kiểm định ốp điện thoại theo
            chuẩn đó.
          </P>
          <P>Cầm ốp trên tay thì kiểm tra mấy thứ này:</P>
          <Ul>
            <li>
              Úp máy xuống mặt bàn phẳng. Kính camera không được chạm bàn &mdash; nếu chạm thì gờ
              quanh cụm camera quá thấp và ốp đó không bảo vệ được thứ đắt nhất ở mặt lưng.
            </li>
            <li>
              Nếu bạn dùng giá đỡ nam châm trên xe, hãy mua ốp có sẵn vòng nam châm. Miếng dán vòng
              sắt rời phải có lỗ ở giữa, nếu không nó nằm đè lên cuộn sạc không dây.
            </li>
            <li>
              Ốp quá dày cộng với sạc nhanh là máy nóng. Tháo ốp khi cắm sạc nhanh hoặc chơi game
              lâu &mdash; nhiệt độ cao kéo dài mới là thứ làm chai pin nhanh nhất.
            </li>
          </Ul>
        </>
      ),
    },
    {
      id: 'cuong-luc-va-dan-man',
      title: 'Cường lực: full keo hay keo viền, và hỏi gì khi dán ở shop',
      body: (
        <>
          <P>
            Con số &ldquo;độ cứng 9H&rdquo; in trên mọi hộp kính là thang độ cứng bút chì, không
            phải thang Mohs. Kính cường lực chỉ nằm khoảng 6&ndash;7 Mohs, mà cát chứa thạch anh
            đúng mức 7 &mdash; đó là lý do chiếc máy đi biển hoặc đi qua công trình về vẫn xước dăm
            dù hộp ghi gì.
          </P>
          <P>
            Khác biệt thật sự nằm ở keo. <strong>Full keo</strong> dán kín toàn bộ mặt kính nên
            không có khoảng không khí, cảm ứng đều tay và va đập thì nứt tại chỗ chứ không bung.{' '}
            <strong>Keo viền</strong> chỉ dán bốn mép, phần giữa hở, nhìn nghiêng ra ánh sáng thấy
            vệt cầu vồng, và va nhẹ vài lần là viền bong dần. Màn hình cong phải dùng keo UV, và ở
            loại này tay nghề người dán quyết định nhiều hơn thương hiệu kính.
          </P>
          <Ul>
            <li>
              Hỏi rõ <strong>full keo hay keo viền</strong> trước khi shop bóc hộp.
            </li>
            <li>
              Máy có <strong>vân tay dưới màn hình</strong>: yêu cầu loại kính ghi rõ hỗ trợ cảm
              biến vân tay, vì kính dày hoặc dán lệch làm máy nhận kém hẳn. Mở khóa thử vài lần ngay
              tại quầy.
            </li>
            <li>
              Dán xong hãy vuốt sát bốn cạnh và gõ thử <strong>hàng phím dưới cùng</strong> của bàn
              phím: lỗi cảm ứng ở viền luôn lộ ra ở đó.
            </li>
            <li>
              Hầu hết cửa hàng dán miễn phí khi mua &mdash; nhận lời, và nếu còn bụi hay bọt khí thì
              yêu cầu dán lại ngay tại chỗ.
            </li>
            <li>
              <strong>Cường lực nhám</strong> đỡ mồ hôi tay và đỡ lóa khi ra nắng, đổi lại chữ hơi
              mờ hơn. <strong>Cường lực chống nhìn trộm</strong> làm giảm độ sáng cảm nhận, ra nắng
              gắt rất khó đọc.
            </li>
          </Ul>
          <P>
            Lớp chống bám vân tay của kính giá thấp bay sau vài tháng, dấu hiệu là vuốt thấy rít
            thay vì trượt. Đây là đồ phải thay định kỳ, nên chỗ đáng chi là loại keo và tay nghề
            dán, không phải cái tên trên hộp.
          </P>
        </>
      ),
    },
    {
      id: 'cu-sac-va-cap',
      title: 'Củ sạc và cáp: mỗi hãng một chuẩn sạc nhanh',
      body: (
        <>
          <P>
            Chuẩn ghi trên củ quan trọng hơn con số oát. <strong>USB Power Delivery (PD)</strong> qua
            cổng USB-C là ngôn ngữ chung mà iPhone và phần lớn máy Android đều nói được.{' '}
            <strong>PPS</strong> là phần mở rộng mà một số dòng Android cần để đạt mức cao nhất của
            chúng. Ngoài ra vài hãng bán rất chạy ở Việt Nam dùng chuẩn sạc nhanh riêng: cắm củ khác
            thì máy vẫn sạc bình thường nhưng tụt về PD. Nếu máy bạn thuộc nhóm đó, hãy mua củ dự
            phòng cùng hãng thay vì mua củ đa năng.
          </P>
          <Ul>
            <li>
              Trên 60W thì cáp USB-C bắt buộc có <strong>chip e-marker</strong> trong đầu cắm. Cáp
              không có chip sẽ chặn tốc độ dù củ mạnh đến đâu.
            </li>
            <li>
              Phần lớn cáp giá thấp chỉ truyền dữ liệu chuẩn USB 2.0 (480 Mbps) dù sạc vẫn nhanh,
              chỉ lộ ra khi chép video hoặc xuất hình ra màn hình ngoài.
            </li>
            <li>
              Củ <strong>GaN</strong> nhỏ và mát hơn ở cùng công suất, loại nhiều cổng thay được hai
              ba củ rời. Đây là món nâng cấp đáng tiền nhất trong nhóm phụ kiện sạc.
            </li>
            <li>
              Sạc không dây chậm hơn và nóng hơn sạc cáp, mà nhiệt mới là thứ hại pin nhất ở khí hậu
              này. Xem đế sạc là tiện lợi, đừng dùng làm cách sạc chính.
            </li>
          </Ul>
          <P>
            Rủi ro của củ sạc trôi nổi không nằm ở tốc độ mà ở phần cách điện giữa điện lưới 220V và
            sợi cáp trong tay bạn. Hãy mua ở nơi đổi trả được &mdash; quầy phụ kiện trong chuỗi, hoặc
            cửa hàng có địa chỉ cố định &mdash; và giữ hóa đơn. Củ nhẹ bất thường
            so với công suất in trên vỏ là dấu hiệu đáng nghi. Hàng &ldquo;zin bóc máy&rdquo; có thể
            là hàng thật, nhưng không có cách nào chứng minh, nên chỉ mua ở chỗ bạn quay lại được.
            Ai bảo hành cái gì thì đã có riêng một bài:{' '}
            <HereLink href="/bao-hanh-sua-chua-dien-thoai">bảo hành và sửa chữa điện thoại</HereLink>
            . Pin chai thì không phụ kiện nào cứu được, phải{' '}
            <HereLink href="/thay-pin-iphone-o-dau">thay pin</HereLink>.
          </P>
        </>
      ),
    },
    {
      id: 'pin-du-phong',
      title: 'Sạc dự phòng: con số trên vỏ không phải thứ bạn nhận được',
      body: (
        <>
          <P>
            Pin lithium bên trong viên sạc dự phòng chạy ở khoảng 3,7V, còn điện ra cổng USB là 5V.
            Nên một viên ghi 10.000 mAh, quy đổi lý thuyết sang 5V chỉ còn khoảng 7.400 mAh, và sau
            hao hụt do mạch chuyển đổi và tỏa nhiệt thì thực tế thường còn khoảng 6.000&ndash;6.500
            mAh &mdash; đây là khoảng ước lượng, tùy mạch và tùy tốc độ sạc. Với chiếc điện thoại
            pin 5.000 mAh, con số đó nghĩa là khoảng 1,2&ndash;1,5 lần sạc đầy, không phải 2 lần.
          </P>
          <P>
            Nếu trên vỏ có ghi <strong>Wh</strong> thì so sánh bằng Wh: đơn vị này đã tính cả điện
            áp, nên hai viên cùng Wh là cùng năng lượng thật. Kế đến là{' '}
            <strong>công suất ra</strong>: nhiều viên dung lượng lớn nhưng cổng ra chỉ 10W, cắm vào
            máy hỗ trợ sạc nhanh vẫn sạc chậm. Muốn sạc nhanh thì viên pin phải có cổng
            USB-C ghi rõ PD kèm số oát và đi với sợi cáp đủ chuẩn.
          </P>
          <P>
            Hai điều về an toàn. Viên pin <strong>phồng vỏ</strong> &mdash; đặt xuống bàn thấy cập
            kênh &mdash; thì ngừng dùng ngay. Và đừng để sạc dự phòng trong cốp xe máy dưới nắng: đó
            là chỗ nóng nhất trong ngày của bạn. Nếu mang lên máy bay thì để trong hành lý xách tay,
            không ký gửi, và xem quy định hiện hành của hãng &mdash; nhiều hãng đã siết việc dùng
            sạc dự phòng trong khoang.
          </P>
        </>
      ),
    },
    {
      id: 'tien-oan',
      title: 'Những món chỉ là tiền oan',
      body: (
        <>
          <P>
            Miếng dán kính camera bán chạy nhất trong nhóm này và cũng là món gây hại nhiều nhất.
            Thêm một mặt kính trước ống kính là thêm phản xạ, hiện ra thành lóa và bóng ma quanh các
            điểm sáng khi chụp đêm hoặc ngược sáng &mdash; đúng phần lớn ảnh người ta chụp ở thành
            phố. Chỉ nên dùng khi cụm camera lồi hẳn và chiếc ốp không có gờ che.
          </P>
          <Ul>
            <li>
              <strong>Dán &ldquo;nano lỏng&rdquo;, &ldquo;kính lỏng 9H&rdquo;</strong>: chỉ là một
              lớp phủ mỏng. Không chống va đập, và dán xong thì không kiểm tra được gì.
            </li>
            <li>
              <strong>Ốp &ldquo;tản nhiệt&rdquo; không quạt</strong>: vài cái vây nhựa ở lưng không
              tản được lượng nhiệt đáng kể. Quạt gắn lưng thì có tác dụng thật khi chơi game dài,
              nhưng cần nguồn riêng và vô dụng cho mọi việc khác.
            </li>
            <li>
              <strong>Miếng dán chống bức xạ, chip &ldquo;tiết kiệm pin&rdquo;</strong>: không có cơ
              chế nào đứng sau.
            </li>
            <li>
              <strong>Cáp in chữ &ldquo;sạc siêu nhanh&rdquo;</strong> mà không ghi PD, PPS hay số
              oát ở bất cứ đâu: coi như cáp thường có lớp vỏ dù cho đẹp.
            </li>
            <li>
              <strong>Combo phụ kiện &ldquo;tặng kèm&rdquo; khi mua máy</strong>: ốp, kính và cáp đó
              đã tính vào giá máy. Hỏi giá máy không kèm phụ kiện rồi so.
            </li>
          </Ul>
          <P>
            Có một món hay bị xếp nhầm vào nhóm tiền oan:{' '}
            <strong>giá đỡ điện thoại trên xe máy</strong>. Nó không vô dụng, nhưng phải chọn loại
            có cao su giảm chấn. Apple đã khuyến cáo rằng rung động biên độ cao từ động cơ mô tô
            phân khối lớn có thể làm hỏng chống rung quang học và khả năng lấy nét của camera
            iPhone; xe tay ga rung ít hơn nhưng không phải không rung. Chiếc kẹp cứng ngắc bắt thẳng
            vào ghi đông là loại nên tránh.
          </P>
          <P>
            Chỗ đáng tiêu tiền thì ngắn và chán: một miếng cường lực full keo được dán tử tế, một củ
            sạc ghi rõ chuẩn, một sợi cáp tốt, một chiếc ốp có gờ và đệm góc. Giữ lại hộp và phụ
            kiện theo máy cũng là tiền: máy đủ hộp{' '}
            <HereLink href="/ban-dien-thoai-cu-duoc-gia">bán lại được giá hơn</HereLink>. Còn giá
            máy hôm nay thì xem ở{' '}
            <HereLink href="/iphone-18-vietnam">trang giá iPhone 18</HereLink>, đọc trực tiếp từ tin
            rao chứ không phải từ bảng giá niêm yết.
          </P>
        </>
      ),
    },
  ],
  faqs: [
    {
      q: 'Ốp lưng trong bị ố vàng có tẩy được không?',
      a: 'Không. Ố vàng là do tia UV và dầu từ tay làm biến đổi chính vật liệu TPU, không phải vết bẩn bám bên ngoài, nên ngâm nước tẩy chỉ làm ốp giòn và nứt sớm hơn. Cách duy nhất là thay ốp. Muốn lâu ố thì chọn ốp lai có lưng nhựa cứng, loại ghi rõ có lớp chống ố, hoặc đơn giản là dùng ốp màu.',
    },
    {
      q: 'Dán cường lực full keo hay keo viền tốt hơn?',
      a: 'Full keo tốt hơn ở gần như mọi mặt: không có khoảng không khí nên không bị vệt cầu vồng, cảm ứng đều ở viền, và khi va đập thì nứt tại chỗ chứ không bung ra. Keo viền rẻ hơn và dễ dán hơn, nhưng phần giữa hở nên bong dần sau vài lần va nhẹ. Hỏi rõ loại keo trước khi cửa hàng bóc hộp.',
    },
    {
      q: 'Dùng củ sạc của hãng khác có sạc nhanh được không?',
      a: 'Máy vẫn sạc bình thường và không hỏng gì, nhưng nếu máy bạn dùng chuẩn sạc nhanh riêng của hãng thì nó sẽ tụt về USB PD và chậm hơn hẳn mức quảng cáo. Máy chỉ nhận đúng công suất nó thương lượng được, nên củ mạnh hơn không gây hại — vấn đề là chuẩn, không phải số oát.',
    },
    {
      q: 'Sạc dự phòng 10.000mAh sạc đầy điện thoại được mấy lần?',
      a: 'Thường khoảng 1,2–1,5 lần với điện thoại pin 5.000 mAh, không phải 2 lần. Pin bên trong chạy ở 3,7V còn điện ra là 5V, nên 10.000 mAh quy đổi lý thuyết còn khoảng 7.400 mAh và thực tế còn khoảng 6.000–6.500 mAh sau hao hụt. Đây là khoảng ước lượng, tùy mạch và tốc độ sạc.',
    },
    {
      q: 'Dán miếng kính camera có làm ảnh bị mờ không?',
      a: 'Không mờ, nhưng dễ bị lóa và bóng ma quanh các điểm sáng khi chụp đêm hoặc ngược sáng, vì bạn vừa thêm một mặt kính phản xạ ngay trước ống kính. Ở thành phố nhiều đèn thì đó là phần lớn ảnh bạn chụp. Chỉ nên dán khi cụm camera lồi hẳn và chiếc ốp đang dùng không có gờ che.',
    },
    {
      q: 'Cáp sạc rẻ có làm hỏng máy không?',
      a: 'Một sợi cáp không đạt chuẩn thường chỉ làm chậm: trên 60W mà cáp không có chip e-marker thì tốc độ bị chặn dù củ mạnh. Rủi ro thật nằm ở củ sạc trôi nổi, cụ thể là phần cách điện giữa điện lưới và sợi cáp. Mua củ ở nơi đổi trả được và giữ hóa đơn quan trọng hơn là tiết kiệm tiền cáp.',
    },
    {
      q: 'Dán cường lực có ảnh hưởng vân tay dưới màn hình không?',
      a: 'Có, nếu dán loại không phù hợp. Kính quá dày hoặc dán lệch làm cảm biến vân tay dưới màn nhận kém hẳn. Chọn loại ghi rõ hỗ trợ cảm biến vân tay, và mở khóa thử vài lần ngay tại quầy trước khi rời cửa hàng — sau khi về nhà mới phát hiện thì rất khó đổi.',
    },
  ],
  related: phoneGuidesIn('vi', SLUG).map((g) => ({ href: `/${g.slug}`, label: g.label, blurb: g.blurb })),
}

export const metadata: Metadata = {
  title: `Phụ kiện điện thoại nên mua — ốp, cường lực, củ sạc và cáp | ${SITE_NAME}`,
  description:
    'Chọn ốp và cường lực thế nào cho hợp khí hậu Việt Nam, full keo khác keo viền ra sao, chuẩn sạc nhanh của mỗi hãng, dung lượng thật của sạc dự phòng, và những phụ kiện chỉ là tiền oan.',
  alternates: phoneGuideAlternates(SLUG),
}

export default function PhuKienDienThoaiNenMuaPage() {
  return <SeoArticle content={CONTENT} />
}
